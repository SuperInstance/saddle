import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { GrantLedger, GrantLoosenedError } from '../src/grants.ts';
import { freeze } from '../src/frozens.ts';
import { Ledger } from '../src/ledger.ts';
import { runCell } from '../src/cellrunner.ts';
import type { AlignmentDraft } from '../src/frozens.ts';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'saddle-grants-'));
}

const baseDraft: AlignmentDraft = {
  id: 'grants-probe',
  model: 'haiku-5',
  useCase: 'policy probe',
  prompt: 'You are a probe.',
  inputFilters: [],
  outputFilters: [],
  params: { temperature: 0.5 },
  directiveChunks: ['go'],
};

const okAdapter = {
  name: 'ok',
  async call() {
    return { raw: '{"ok":true}', latencyMs: 1 };
  },
};

function parseCredit(raw: string): { credit: unknown; verdict: 'worked' | 'failed' } {
  return { credit: JSON.parse(raw), verdict: 'worked' };
}

test('GrantLedger tightens and refuses loosening', () => {
  const g = new GrantLedger(['net:fetch', 'fs:read', 'fs:write']);
  assert.deepEqual(g.effective, ['fs:read', 'fs:write', 'net:fetch']);
  g.tightenFor(['net:fetch']);
  assert.deepEqual(g.snapshot(), ['net:fetch']);
  assert.throws(
    () => g.tightenFor(['fs:read']),
    (err: unknown) => {
      assert.ok(err instanceof GrantLoosenedError);
      assert.equal(err.direction, 'tighten-only');
      assert.deepEqual(err.missing, ['fs:read']);
      assert.deepEqual(err.held, ['net:fetch']);
      return true;
    }
  );
  // refused call leaves the effective set unchanged
  assert.deepEqual(g.snapshot(), ['net:fetch']);
});

test('undefined passes through; empty tightens to empty', () => {
  const g = new GrantLedger(['a', 'b']);
  g.tightenFor(undefined); // no-op
  assert.deepEqual(g.snapshot(), ['a', 'b']);
  g.tightenFor([]); // pure cell — needs nothing
  assert.deepEqual(g.snapshot(), []);
  assert.throws(() => g.tightenFor(['anything']), GrantLoosenedError);
});

test('order changes failure point; intersection is what survives', () => {
  const g = new GrantLedger(['a', 'b']);
  g.tightenFor(['a']);
  g.tightenFor(['a']); // idempotent
  assert.deepEqual(g.snapshot(), ['a']);

  const g2 = new GrantLedger(['a', 'b']);
  g2.tightenFor(['a']);
  assert.throws(() => g2.tightenFor(['b']), GrantLoosenedError);
});

test('runCell enforces at frozens load, before any ledger append', async () => {
  const dir = tmpDir();
  const ledgerPath = path.join(dir, 'ledger.jsonl');
  const ledger = new Ledger(ledgerPath);
  const withGrant = freeze(dir, { ...baseDraft, grants: ['net:fetch'] });

  // grant held → runs, entry appended
  const ok = await runCell({
    frozenDir: dir,
    alignmentId: withGrant.alignmentId,
    cellId: 'c',
    runId: 'r1',
    input: {},
    buildUserPrompt: () => 'go',
    parseCredit,
    ledger,
    adapter: okAdapter,
    grants: new GrantLedger(['net:fetch']),
  });
  assert.equal(ok.final.verdictKind, 'worked');
  assert.equal(await ledger.count(), 1);

  // grant not held → throws, ledger unchanged, adapter never called
  let calls = 0;
  const countingAdapter = {
    name: 'counting',
    async call() {
      calls++;
      return { raw: '{"ok":true}', latencyMs: 1 };
    },
  };
  const ledger2 = new Ledger(path.join(dir, 'ledger2.jsonl'));
  await assert.rejects(
    () =>
      runCell({
        frozenDir: dir,
        alignmentId: withGrant.alignmentId,
        cellId: 'c',
        runId: 'r2',
        input: {},
        buildUserPrompt: () => 'go',
        parseCredit,
        ledger: ledger2,
        adapter: countingAdapter,
        grants: new GrantLedger(['fs:read']),
      }),
    GrantLoosenedError
  );
  assert.equal(await ledger2.count(), 0);
  assert.equal(calls, 0);
});

test('pre-v4 frozens (no grants) run unchanged with and without a GrantLedger', async () => {
  const dir = tmpDir();
  const noGrant = freeze(dir, baseDraft);
  // content-addressing intact: freezing the same no-grants draft twice → same id
  assert.equal(freeze(dir, { ...baseDraft }).alignmentId, noGrant.alignmentId);

  const ledger = new Ledger(path.join(dir, 'l.jsonl'));
  const withLedger = await runCell({
    frozenDir: dir,
    alignmentId: noGrant.alignmentId,
    cellId: 'c',
    runId: 'r1',
    input: {},
    buildUserPrompt: () => 'go',
    parseCredit,
    ledger,
    adapter: okAdapter,
    grants: new GrantLedger(['anything']),
  });
  assert.equal(withLedger.final.verdictKind, 'worked');

  const ledger2 = new Ledger(path.join(dir, 'l2.jsonl'));
  const withoutLedger = await runCell({
    frozenDir: dir,
    alignmentId: noGrant.alignmentId,
    cellId: 'c',
    runId: 'r2',
    input: {},
    buildUserPrompt: () => 'go',
    parseCredit,
    ledger: ledger2,
    adapter: okAdapter,
  });
  assert.equal(withoutLedger.final.verdictKind, 'worked');
});

test('empty grants cell under a full ledger', async () => {
  const dir = tmpDir();
  const pure = freeze(dir, { ...baseDraft, grants: [] });
  const ledger = new Ledger(path.join(dir, 'l.jsonl'));
  const res = await runCell({
    frozenDir: dir,
    alignmentId: pure.alignmentId,
    cellId: 'c',
    runId: 'r1',
    input: {},
    buildUserPrompt: () => 'go',
    parseCredit,
    ledger,
    adapter: okAdapter,
    grants: new GrantLedger(['fs:read']),
  });
  assert.equal(res.final.verdictKind, 'worked');
});
