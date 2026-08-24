import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { EffectScope } from '../src/effect.ts';
import { thawScoped, freeze, thaw } from '../src/frozens.ts';
import type { AlignmentDraft } from '../src/frozens.ts';
import { Ledger } from '../src/ledger.ts';
import { runCell, RunTornError } from '../src/cellrunner.ts';
import { runNightCycle } from '../src/nightcycle.ts';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'saddle-effect-'));
}

const draft: AlignmentDraft = {
  id: 'effect-probe',
  model: 'haiku-5',
  useCase: 'probe',
  prompt: 'You are a probe.',
  inputFilters: [],
  outputFilters: [],
  params: { temperature: 0.5 },
  directiveChunks: ['go'],
};

test('Cordis semantics: activation runs immediately; fn RETURNS the disposer', async () => {
  const order: string[] = [];
  const s = new EffectScope();
  // friction #4: the RETURNED function is the disposer — fn itself runs NOW.
  s.register(() => {
    order.push('activated');
    return () => {
      order.push('disposed');
    };
  });
  // activation MUST be visible BEFORE any dispose (a store-fn-and-run-later
  // mock fails exactly here — it would leave 'activated' absent).
  assert.deepEqual(order, ['activated']);
  await s.dispose();
  assert.deepEqual(order, ['activated', 'disposed']);
});

test('the wrong mock shape cannot slip through: non-function return throws', () => {
  const s = new EffectScope();
  assert.throws(
    () => s.register((() => {}) as unknown as () => () => void),
    /effect activation must return a disposer function/
  );
});

test('LIFO unwind', async () => {
  const order: string[] = [];
  const s = new EffectScope();
  s.onDispose(() => {
    order.push('a');
  });
  s.onDispose(() => {
    order.push('b');
  });
  s.onDispose(() => {
    order.push('c');
  });
  await s.dispose();
  assert.deepEqual(order, ['c', 'b', 'a']);
});

test('activate-throw unwinds prior registrations and marks disposed', async () => {
  let aRan = false;
  const s = new EffectScope();
  s.register(() => {
    return () => {
      aRan = true;
    };
  });
  assert.throws(
    () =>
      s.register(() => {
        throw new Error('activate boom');
      }),
    /activate boom/
  );
  assert.equal(aRan, true, 'prior registration disposer must run on failed activation');
  assert.equal(s.disposed, true);
});

test('a throwing disposer does not block the rest; first error rethrown after all', async () => {
  const ran: string[] = [];
  const s = new EffectScope();
  s.onDispose(() => {
    throw new Error('boom');
  });
  s.onDispose(() => {
    ran.push('second');
  });
  await assert.rejects(() => s.dispose(), /boom/);
  assert.deepEqual(ran, ['second'], 'later disposers still run');
});

test('double dispose no-op; register-after-dispose throws', async () => {
  const s = new EffectScope();
  let n = 0;
  s.onDispose(() => {
    n++;
  });
  await s.dispose();
  await s.dispose(); // idempotent
  assert.equal(n, 1);
  assert.throws(() => s.onDispose(() => {}), /disposed scope/);
});

test('thawScoped caches per scope and releases on unwind', async () => {
  const dir = tmpDir();
  const frozen = freeze(dir, draft);
  const s = new EffectScope();
  const a = thawScoped(s, dir, frozen.alignmentId);
  const b = thawScoped(s, dir, frozen.alignmentId);
  assert.equal(a, b, 'same object reference within one scope (cache hit)');
  await s.dispose();
  // after unwind, a fresh scope gets a fresh verified state
  const s2 = new EffectScope();
  const c = thawScoped(s2, dir, frozen.alignmentId);
  assert.deepEqual(c, a);
  assert.notEqual(c, a, 'cache dropped after scope unwind');
  assert.equal(s2.size, 1);
});

test('runCell torn mid-run throws RunTornError, no post-disposal append', async () => {
  const dir = tmpDir();
  const frozen = freeze(dir, draft);
  const ledger = new Ledger(path.join(dir, 'l.jsonl'));
  let calls = 0;
  const scope = new EffectScope();
  const adapter = {
    name: 'disposing',
    async call() {
      calls++;
      if (calls === 1) {
        // simulate unload on first attempt: dispose the scope, then return
        // unparseable output so the run would otherwise retry
        await scope.dispose();
        return { raw: 'not json', latencyMs: 1 };
      }
      return { raw: '{"ok":true}', latencyMs: 1 };
    },
  };
  await assert.rejects(
    () =>
      runCell({
        frozenDir: dir,
        alignmentId: frozen.alignmentId,
        cellId: 'c',
        runId: 'r1',
        input: {},
        buildUserPrompt: () => 'go',
        parseCredit: (raw) => ({ credit: JSON.parse(raw), verdict: 'worked' }),
        ledger,
        adapter,
        maxAttempts: 3,
        scope,
      }),
    RunTornError
  );
  assert.equal(calls, 1, 'attempt 2 must not run after the scope is torn');
  assert.equal(await ledger.count(), 1, 'exactly one entry appended before the tear');
});

test('adapter.dispose called on scope unwind (kill-on-unload); not without scope', async () => {
  const dir = tmpDir();
  const frozen = freeze(dir, draft);
  let disposed = 0;
  const adapter = {
    name: 'subproc',
    async call() {
      return { raw: '{"ok":true}', latencyMs: 1 };
    },
    dispose() {
      disposed++;
    },
  };
  const scope = new EffectScope();
  const ledger = new Ledger(path.join(dir, 'l.jsonl'));
  await runCell({
    frozenDir: dir,
    alignmentId: frozen.alignmentId,
    cellId: 'c',
    runId: 'r1',
    input: {},
    buildUserPrompt: () => 'go',
    parseCredit: (raw) => ({ credit: JSON.parse(raw), verdict: 'worked' }),
    ledger,
    adapter,
    scope,
  });
  assert.equal(disposed, 0, 'not disposed during a normal run');
  await scope.dispose();
  assert.equal(disposed, 1, 'adapter dispose registered against the scope');

  // without scope: runCell never calls adapter.dispose
  let disposed2 = 0;
  const adapter2 = {
    name: 'subproc2',
    async call() {
      return { raw: '{"ok":true}', latencyMs: 1 };
    },
    dispose() {
      disposed2++;
    },
  };
  const ledger2 = new Ledger(path.join(dir, 'l2.jsonl'));
  await runCell({
    frozenDir: dir,
    alignmentId: frozen.alignmentId,
    cellId: 'c',
    runId: 'r2',
    input: {},
    buildUserPrompt: () => 'go',
    parseCredit: (raw) => ({ credit: JSON.parse(raw), verdict: 'worked' }),
    ledger: ledger2,
    adapter: adapter2,
  });
  assert.equal(disposed2, 0);
});

test('nightcycle scoped lookups agree with the raw path', async () => {
  const dir = tmpDir();
  const frozen = freeze(dir, { ...draft, earnedKeepMetric: 'task-approval' });
  const ledger = new Ledger(path.join(dir, 'l.jsonl'));
  const okAdapter = {
    name: 'ok',
    async call() {
      return { raw: '{"ok":true}', latencyMs: 1 };
    },
  };
  await runCell({
    frozenDir: dir,
    alignmentId: frozen.alignmentId,
    cellId: 'c',
    runId: 'r1',
    input: {},
    buildUserPrompt: () => 'go',
    parseCredit: (raw) => ({ credit: JSON.parse(raw), verdict: 'worked' }),
    ledger,
    adapter: okAdapter,
  });

  const scope = new EffectScope();
  const a = await runNightCycle(ledger.filePath, { frozenDir: dir, scope });
  assert.equal(a.alignments[0]?.earnedKeepMetric, 'task-approval');
  const b = await runNightCycle(ledger.filePath, { frozenDir: dir, scope }); // cache hit path
  assert.equal(b.alignments[0]?.earnedKeepMetric, 'task-approval');
  assert.equal(b.entries, a.entries);
  await scope.dispose();
  const c = await runNightCycle(ledger.filePath, { frozenDir: dir }); // raw path
  assert.equal(c.alignments[0]?.earnedKeepMetric, 'task-approval');
  assert.equal(c.entries, a.entries);
});
