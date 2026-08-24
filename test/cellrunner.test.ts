import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import * as assert from 'node:assert';
import { runCell, estimateUsage, type CellAdapter } from '../src/cellrunner.ts';
import { Ledger, type Verdict } from '../src/ledger.ts';
import { resolveVerdictKind } from '../src/ledger.ts';
import { freeze, type FrozenState } from '../src/frozens.ts';

// Test fixtures
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join('/tmp', 'saddle-cellrunner-'));
}

function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

// Mock adapter: controlled behavior for testing
function makeMockAdapter(behavior: 'success' | 'transport-error' | 'parse-error'): CellAdapter {
  return {
    name: 'mock-adapter',
    async call(input) {
      if (behavior === 'transport-error') {
        throw new Error('network timeout');
      }
      if (behavior === 'parse-error') {
        return { raw: 'garbage output', latencyMs: 10 };
      }
      return {
        raw: JSON.stringify({ pass: true, reason: 'looks good' }),
        latencyMs: 42,
      };
    },
  };
}

// Test alignment draft
const testDraft = {
  id: 'test-judge',
  model: 'gpt-4',
  useCase: 'test-cell',
  prompt: 'You are a test judge.',
  inputFilters: [],
  outputFilters: [],
  params: { temperature: 0.5, maxTokens: 100 },
  directiveChunks: ['chunk1', 'chunk2'],
};

test('cellrunner: happy path — one entry, success verdict, debit has full context', async () => {
  const tmpDir = makeTmpDir();
  try {
    const frozenDir = path.join(tmpDir, 'frozens');
    const ledgerPath = path.join(tmpDir, 'ledger.jsonl');

    // Freeze the test alignment.
    const frozen = freeze(frozenDir, testDraft);

    const ledger = new Ledger(ledgerPath);
    const testInput = { lineId: 'L001', text: 'hello world' };

    const result = await runCell({
      frozenDir,
      alignmentId: frozen.alignmentId,
      cellId: 'test/judge',
      runId: 'run-001',
      input: testInput,
      buildUserPrompt: (input) => `Judge this: ${JSON.stringify(input)}`,
      parseCredit: (raw) => {
        const parsed = JSON.parse(raw);
        const verdict: Verdict = parsed.pass ? 'worked' : 'failed';
        return { credit: parsed, verdict };
      },
      ledger,
      adapter: makeMockAdapter('success'),
    });

    assert.strictEqual(result.entries.length, 1, 'should have 1 entry');
    assert.strictEqual(result.final.verdict, 'worked', 'verdict should be worked');
    assert.strictEqual(result.final.escalated, false, 'should not be escalated');
    assert.strictEqual(result.final.note, undefined, 'should have no note');

    // Verify debit structure.
    const debit = JSON.parse(result.final.debit);
    assert.deepStrictEqual(debit.prompt.system, frozen.prompt, 'debit has system prompt');
    assert.ok(debit.prompt.user.includes('hello world'), 'debit has user prompt');
    assert.deepStrictEqual(debit.input, testInput, 'debit has domain input');
    assert.strictEqual(debit.model, frozen.model, 'debit has model');
    assert.deepStrictEqual(debit.params, frozen.params, 'debit has params');
    assert.strictEqual(debit.adapter, 'mock-adapter', 'debit has adapter name');

    // Verify credit.
    const credit = JSON.parse(result.final.credit);
    assert.strictEqual(credit.pass, true, 'credit has pass');

    // Verify chain integrity.
    const verify = await ledger.verify();
    assert.strictEqual(verify.ok, true, 'hash chain should verify');
  } finally {
    cleanup(tmpDir);
  }
});

test('cellrunner: retry on parse error — two entries with retryOf linkage', async () => {
  const tmpDir = makeTmpDir();
  try {
    const frozenDir = path.join(tmpDir, 'frozens');
    const ledgerPath = path.join(tmpDir, 'ledger.jsonl');

    const frozen = freeze(frozenDir, testDraft);
    const ledger = new Ledger(ledgerPath);

    // First adapter fails to parse, second succeeds.
    let attemptCount = 0;
    const adapter: CellAdapter = {
      name: 'retry-test-adapter',
      async call(input) {
        attemptCount++;
        if (attemptCount === 1) {
          return { raw: 'garbage', latencyMs: 10 };
        }
        return { raw: JSON.stringify({ pass: true, reason: 'ok' }), latencyMs: 15 };
      },
    };

    const result = await runCell({
      frozenDir,
      alignmentId: frozen.alignmentId,
      cellId: 'test/judge',
      runId: 'run-001',
      input: { text: 'test' },
      buildUserPrompt: () => 'test',
      parseCredit: (raw) => {
        const parsed = JSON.parse(raw); // throws on 'garbage'
        return { credit: parsed, verdict: parsed.pass ? 'worked' : 'failed' };
      },
      ledger,
      adapter,
      maxAttempts: 2,
    });

    assert.strictEqual(result.entries.length, 2, 'should have 2 entries (attempt + retry)');

    // First entry: failed parse, not escalated.
    const first = result.entries[0]!;
    assert.strictEqual(first.verdict, 'failed', 'first attempt should be failed');
    assert.strictEqual(first.escalated, false, 'first attempt should not escalate');
    assert.ok(first.note?.includes('attempt 1:'), 'first note should indicate attempt 1');
    assert.strictEqual(first.retryOf, undefined, 'first entry should have no retryOf');

    // Second entry: success, retryOf points to first.
    const second = result.entries[1]!;
    assert.strictEqual(second.verdict, 'worked', 'second attempt should succeed');
    assert.strictEqual(second.escalated, false, 'second attempt should not escalate');
    assert.strictEqual(second.retryOf, first.seq, 'second should point to first via retryOf');
    assert.strictEqual(second.note, undefined, 'second should have no note');

    // Verify chain.
    const verify = await ledger.verify();
    assert.strictEqual(verify.ok, true, 'hash chain should verify');
  } finally {
    cleanup(tmpDir);
  }
});

test('cellrunner: both attempts fail — escalated=true, gave-up note', async () => {
  const tmpDir = makeTmpDir();
  try {
    const frozenDir = path.join(tmpDir, 'frozens');
    const ledgerPath = path.join(tmpDir, 'ledger.jsonl');

    const frozen = freeze(frozenDir, testDraft);
    const ledger = new Ledger(ledgerPath);

    const adapter: CellAdapter = {
      name: 'fail-adapter',
      async call() {
        throw new Error('network timeout');
      },
    };

    const result = await runCell({
      frozenDir,
      alignmentId: frozen.alignmentId,
      cellId: 'test/judge',
      runId: 'run-001',
      input: { text: 'test' },
      buildUserPrompt: () => 'test',
      parseCredit: () => ({ credit: {}, verdict: 'worked' }),
      ledger,
      adapter,
      maxAttempts: 2,
    });

    assert.strictEqual(result.entries.length, 2, 'should have 2 failed entries');

    // First entry: failed, not escalated.
    const first = result.entries[0]!;
    assert.strictEqual(first.verdict, 'failed');
    assert.strictEqual(first.escalated, false);
    assert.ok(first.note?.includes('attempt 1:'));
    assert.ok(first.note?.includes('network timeout'));

    // Second entry: failed, escalated=true.
    const second = result.entries[1]!;
    assert.strictEqual(second.verdict, 'failed');
    assert.strictEqual(second.escalated, true, 'final attempt should escalate');
    assert.ok(second.note?.startsWith('gave up:'), 'final note should start with "gave up:"');
    assert.ok(second.note?.includes('attempt 2:'));
    assert.strictEqual(second.retryOf, first.seq);

    // Verify chain.
    const verify = await ledger.verify();
    assert.strictEqual(verify.ok, true, 'hash chain should verify');
  } finally {
    cleanup(tmpDir);
  }
});

test('cellrunner: tampered frozen state throws before ledger append', async () => {
  const tmpDir = makeTmpDir();
  try {
    const frozenDir = path.join(tmpDir, 'frozens');
    const ledgerPath = path.join(tmpDir, 'ledger.jsonl');

    const frozen = freeze(frozenDir, testDraft);
    const ledger = new Ledger(ledgerPath);

    // Tamper with the frozen file.
    const frozenFile = path.join(frozenDir, `${frozen.alignmentId}.json`);
    const tampered = { ...frozen, prompt: 'HACKED' };
    fs.chmodSync(frozenFile, 0o644); // a dishonest clerk needs write permission first
    fs.writeFileSync(frozenFile, JSON.stringify(tampered) + '\n');

    const adapter = makeMockAdapter('success');

    // Should throw during thaw, before any ledger entry is appended.
    await assert.rejects(
      async () => {
        await runCell({
          frozenDir,
          alignmentId: frozen.alignmentId,
          cellId: 'test/judge',
          runId: 'run-001',
          input: { text: 'test' },
          buildUserPrompt: () => 'test',
          parseCredit: () => ({ credit: {}, verdict: 'worked' }),
          ledger,
          adapter,
        });
      },
      (err) => {
        assert.ok(
          err instanceof Error && err.message.includes('failed verification'),
          'should throw on hash mismatch'
        );
        return true;
      }
    );

    // Verify no ledger entry was appended.
    const count = await ledger.count();
    assert.strictEqual(count, 0, 'no entry should be appended on thaw failure');
  } finally {
    cleanup(tmpDir);
  }
});

test('cellrunner: adapter transport error is caught and retried', async () => {
  const tmpDir = makeTmpDir();
  try {
    const frozenDir = path.join(tmpDir, 'frozens');
    const ledgerPath = path.join(tmpDir, 'ledger.jsonl');

    const frozen = freeze(frozenDir, testDraft);
    const ledger = new Ledger(ledgerPath);

    let attemptCount = 0;
    const adapter: CellAdapter = {
      name: 'flaky-adapter',
      async call() {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error('connection reset');
        }
        return { raw: JSON.stringify({ ok: true }), latencyMs: 20 };
      },
    };

    const result = await runCell({
      frozenDir,
      alignmentId: frozen.alignmentId,
      cellId: 'test/judge',
      runId: 'run-001',
      input: { text: 'test' },
      buildUserPrompt: () => 'test',
      parseCredit: (raw) => {
        const parsed = JSON.parse(raw);
        return { credit: parsed, verdict: 'worked' };
      },
      ledger,
      adapter,
      maxAttempts: 2,
    });

    assert.strictEqual(result.entries.length, 2, 'should have 2 entries');
    assert.strictEqual(result.final.verdict, 'worked', 'should succeed on second attempt');
    assert.strictEqual(result.final.escalated, false);
  } finally {
    cleanup(tmpDir);
  }
});

// ---------------------------------------------------------------------------
// v3: verdict semantics split (field-trial-1 gap 1) + token accounting (gap 3)
// ---------------------------------------------------------------------------

test('cellrunner v3: a parseable-but-failing credit is a FINAL judgment — one entry, never retried, never escalated', async () => {
  const tmpDir = makeTmpDir();
  try {
    const frozenDir = path.join(tmpDir, 'frozens');
    const frozen = freeze(frozenDir, testDraft);
    const ledger = new Ledger(path.join(tmpDir, 'ledger.jsonl'));

    let calls = 0;
    const adapter: CellAdapter = {
      name: 'mock',
      async call() {
        calls++;
        return { raw: JSON.stringify({ pass: false, reason: 'out of voice' }), latencyMs: 5 };
      },
    };

    const result = await runCell({
      frozenDir, alignmentId: frozen.alignmentId, cellId: 'qc', runId: 'run-1',
      input: { line: 'hello' },
      buildUserPrompt: () => 'judge this',
      parseCredit: (raw) => {
        const parsed = JSON.parse(raw);
        return { credit: parsed, verdict: (parsed.pass ? 'worked' : 'failed') as Verdict };
      },
      ledger, adapter, maxAttempts: 3,
    });

    assert.strictEqual(calls, 1, 'a QC-fail judgment is final — the adapter is called exactly once');
    assert.strictEqual(result.entries.length, 1, 'exactly ONE entry consumed');
    assert.strictEqual(result.final.verdict, 'failed', 'legacy verdict stays failed');
    assert.strictEqual(result.final.verdictKind, 'judgment-fail');
    assert.strictEqual(result.final.escalated, false, 'a completed judgment NEVER escalates');

    // the judgment credit carries latency + attempts + usage stamps
    const credit = JSON.parse(result.final.credit);
    assert.strictEqual(credit.pass, false);
    assert.strictEqual(credit.reason, 'out of voice');
    assert.equal(typeof credit.latencyMs, 'number');
    assert.strictEqual(credit.attempts, 1);
    assert.ok(credit.usage && typeof credit.usage.totalTokens === 'number');

    assert.ok(await ledger.verify().then((v) => v.ok));
  } finally {
    cleanup(tmpDir);
  }
});

test('cellrunner v3: an unparseable credit is an execution-error — retried, then escalated', async () => {
  const tmpDir = makeTmpDir();
  try {
    const frozenDir = path.join(tmpDir, 'frozens');
    const frozen = freeze(frozenDir, testDraft);
    const ledger = new Ledger(path.join(tmpDir, 'ledger.jsonl'));

    const adapter: CellAdapter = {
      name: 'mock',
      async call() { return { raw: 'garbage', latencyMs: 5 }; },
    };

    const result = await runCell({
      frozenDir, alignmentId: frozen.alignmentId, cellId: 'qc', runId: 'run-1',
      input: {}, buildUserPrompt: () => 'judge this',
      parseCredit: (raw) => { JSON.parse(raw); return { credit: {}, verdict: 'worked' }; },
      ledger, adapter, maxAttempts: 2,
    });

    assert.strictEqual(result.entries.length, 2);
    assert.strictEqual(result.entries[0]!.verdictKind, 'execution-error');
    assert.strictEqual(result.entries[0]!.escalated, false);
    assert.strictEqual(result.entries[1]!.verdictKind, 'escalated', 'exhausted attempts give up');
    assert.strictEqual(result.entries[1]!.escalated, true);
    assert.strictEqual(result.entries[1]!.verdict, 'failed');
    assert.match(result.entries[1]!.note ?? '', /^gave up:/);

    // error credits carry usage too (estimated from prompt + raw)
    const credit = JSON.parse(result.entries[1]!.credit);
    assert.ok(credit.error, 'error credit carries the error');
    assert.ok(credit.usage && credit.usage.estimated === true);
    assert.ok(credit.usage.completionTokens > 0, 'raw output exists, so completion tokens are counted');
  } finally {
    cleanup(tmpDir);
  }
});

test('cellrunner v3: a transport error is an execution-error — retried, then escalated', async () => {
  const tmpDir = makeTmpDir();
  try {
    const frozenDir = path.join(tmpDir, 'frozens');
    const frozen = freeze(frozenDir, testDraft);
    const ledger = new Ledger(path.join(tmpDir, 'ledger.jsonl'));

    const adapter: CellAdapter = {
      name: 'mock',
      async call() { throw new Error('network timeout'); },
    };

    const result = await runCell({
      frozenDir, alignmentId: frozen.alignmentId, cellId: 'qc', runId: 'run-1',
      input: {}, buildUserPrompt: () => 'judge this',
      parseCredit: () => ({ credit: {}, verdict: 'worked' }),
      ledger, adapter, maxAttempts: 2,
    });

    assert.strictEqual(result.entries.length, 2);
    assert.strictEqual(result.entries[0]!.verdictKind, 'execution-error');
    assert.strictEqual(result.entries[1]!.verdictKind, 'escalated');
    assert.strictEqual(result.entries[1]!.escalated, true);

    // transport error: no raw output → prompt-side estimate only, completion 0
    const credit = JSON.parse(result.entries[1]!.credit);
    assert.ok(credit.error);
    assert.strictEqual(credit.usage.estimated, true);
    assert.strictEqual(credit.usage.completionTokens, 0);
    assert.ok(credit.usage.promptTokens > 0);
  } finally {
    cleanup(tmpDir);
  }
});

test('cellrunner v3: adapter-reported usage beats the estimate (estimated: false)', async () => {
  const tmpDir = makeTmpDir();
  try {
    const frozenDir = path.join(tmpDir, 'frozens');
    const frozen = freeze(frozenDir, testDraft);
    const ledger = new Ledger(path.join(tmpDir, 'ledger.jsonl'));

    const adapter: CellAdapter = {
      name: 'mock',
      async call() {
        return {
          raw: JSON.stringify({ pass: true }),
          latencyMs: 7,
          usage: { promptTokens: 111, completionTokens: 22, totalTokens: 133, estimated: true },
        };
      },
    };

    const result = await runCell({
      frozenDir, alignmentId: frozen.alignmentId, cellId: 'qc', runId: 'run-1',
      input: {}, buildUserPrompt: () => 'judge this',
      parseCredit: (raw) => ({ credit: JSON.parse(raw), verdict: 'worked' }),
      ledger, adapter,
    });

    const credit = JSON.parse(result.final.credit);
    assert.deepStrictEqual(credit.usage, { promptTokens: 111, completionTokens: 22, totalTokens: 133, estimated: false });
  } finally {
    cleanup(tmpDir);
  }
});

test('cellrunner v3: no adapter usage → chars/4 estimate stamped on every credit', async () => {
  const tmpDir = makeTmpDir();
  try {
    const frozenDir = path.join(tmpDir, 'frozens');
    const frozen = freeze(frozenDir, testDraft);
    const ledger = new Ledger(path.join(tmpDir, 'ledger.jsonl'));

    const raw = JSON.stringify({ pass: true });
    const adapter: CellAdapter = { name: 'mock', async call() { return { raw, latencyMs: 7 }; } };

    const result = await runCell({
      frozenDir, alignmentId: frozen.alignmentId, cellId: 'qc', runId: 'run-1',
      input: {}, buildUserPrompt: (input) => `judge ${JSON.stringify(input)}`,
      parseCredit: (r) => ({ credit: JSON.parse(r), verdict: 'worked' }),
      ledger, adapter,
    });

    const debit = JSON.parse(result.final.debit);
    const credit = JSON.parse(result.final.credit);
    assert.deepStrictEqual(
      credit.usage,
      estimateUsage(debit.prompt, raw),
      'the credit carries exactly the chars/4 estimate over the real prompt+raw'
    );
    assert.strictEqual(credit.usage.estimated, true);
  } finally {
    cleanup(tmpDir);
  }
});

test('cellrunner v3: ledger mixes legacy and verdictKind entries and still verifies', async () => {
  const tmpDir = makeTmpDir();
  try {
    const frozenDir = path.join(tmpDir, 'frozens');
    const frozen = freeze(frozenDir, testDraft);
    const ledger = new Ledger(path.join(tmpDir, 'ledger.jsonl'));

    // a legacy-shape entry (no verdictKind) followed by a v3 run
    ledger.append({ cellId: 'qc', runId: 'old', alignmentId: frozen.alignmentId, debit: {}, credit: { pass: true }, verdict: 'worked', escalated: false });

    const adapter: CellAdapter = { name: 'mock', async call() { return { raw: JSON.stringify({ pass: false }), latencyMs: 3 }; } };
    const result = await runCell({
      frozenDir, alignmentId: frozen.alignmentId, cellId: 'qc', runId: 'new',
      input: {}, buildUserPrompt: () => 'judge this',
      parseCredit: (raw) => ({ credit: JSON.parse(raw), verdict: 'failed' }),
      ledger, adapter,
    });

    assert.strictEqual(resolveVerdictKind(result.final), 'judgment-fail');
    const v = await ledger.verify();
    assert.strictEqual(v.ok, true, 'mixed legacy + v3 entries hash-verify end to end');
    assert.strictEqual(v.checked, 2);
  } finally {
    cleanup(tmpDir);
  }
});

test('estimateUsage: chars/4 per side, ceiled, summed', () => {
  const prompt = { system: 'a'.repeat(100), user: 'b'.repeat(50) };
  const u = estimateUsage(prompt, 'c'.repeat(61));
  assert.deepStrictEqual(u, {
    promptTokens: Math.ceil(150 / 4),
    completionTokens: Math.ceil(61 / 4),
    totalTokens: Math.ceil(150 / 4) + Math.ceil(61 / 4),
    estimated: true,
  });
  // empty raw → completion side 0 (the transport-error estimate)
  assert.equal(estimateUsage(prompt, '').completionTokens, 0);
  assert.equal(estimateUsage(prompt, '').promptTokens, 38);
});

// ---------------------------------------------------------------------------
// v4: orthogonal outcome facts (SEAM-REPORT §1.4) — flat on the credit and
// the entry, never folded into the error string, never flipping the kind
// ---------------------------------------------------------------------------

test('cellrunner v4: flat outcome facts ride the credit and the entry, not the error string', async () => {
  const tmpDir = makeTmpDir();
  try {
    const frozenDir = path.join(tmpDir, 'frozens');
    const frozen = freeze(frozenDir, testDraft);
    const ledger = new Ledger(path.join(tmpDir, 'ledger.jsonl'));

    // adapter reports the §1.4 signature case: timed out AND exited 0
    const adapter: CellAdapter = {
      name: 'subprocess-mock',
      async call() {
        return {
          raw: JSON.stringify({ pass: false, reason: 'out of voice' }),
          latencyMs: 9,
          outcome: { timedOut: true, exitCode: 0 },
        };
      },
    };

    const result = await runCell({
      frozenDir, alignmentId: frozen.alignmentId, cellId: 'qc', runId: 'run-1',
      input: {}, buildUserPrompt: () => 'judge this',
      parseCredit: (raw) => {
        const parsed = JSON.parse(raw);
        return { credit: parsed, verdict: (parsed.pass ? 'worked' : 'failed') as Verdict };
      },
      ledger, adapter, maxAttempts: 3,
    });

    // facts never flip the kind: a completed parse with timedOut=true is
    // STILL a completed judgment — parsed kind, NOT downgraded
    assert.strictEqual(result.entries.length, 1);
    assert.strictEqual(result.final.verdictKind, 'judgment-fail');

    const credit = JSON.parse(result.final.credit);
    assert.strictEqual(credit.pass, false);
    assert.strictEqual(credit.timedOut, true, 'timedOut rides flat on the credit');
    assert.strictEqual(credit.exitCode, 0, 'exitCode rides flat on the credit');
    assert.ok(!('outcome' in credit), 'no nested outcome blob on the credit');
    assert.deepStrictEqual(result.final.outcome, { timedOut: true, exitCode: 0 });

    assert.ok(await ledger.verify().then((v) => v.ok));
  } finally {
    cleanup(tmpDir);
  }
});

test('cellrunner v4: adapter-throw carries facts flat', async () => {
  const tmpDir = makeTmpDir();
  try {
    const frozenDir = path.join(tmpDir, 'frozens');
    const frozen = freeze(frozenDir, testDraft);
    const ledger = new Ledger(path.join(tmpDir, 'ledger.jsonl'));

    const adapter: CellAdapter = {
      name: 'kill-mock',
      async call() {
        const err = new Error('child killed') as Error & { outcome?: unknown };
        err.outcome = { signal: 15 };
        throw err;
      },
    };

    const result = await runCell({
      frozenDir, alignmentId: frozen.alignmentId, cellId: 'qc', runId: 'run-1',
      input: {}, buildUserPrompt: () => 'judge this',
      parseCredit: (raw) => ({ credit: JSON.parse(raw), verdict: 'worked' as Verdict }),
      ledger, adapter, maxAttempts: 2,
    });

    assert.strictEqual(result.entries.length, 2);
    for (const e of result.entries) {
      const credit = JSON.parse(e.credit);
      assert.ok(credit.error, 'error string still present');
      assert.strictEqual(credit.signal, 15, 'signal is a flat sibling of the error string');
      assert.deepStrictEqual(e.outcome, { signal: 15 });
    }
    assert.ok(await ledger.verify().then((v) => v.ok));
  } finally {
    cleanup(tmpDir);
  }
});

test('cellrunner v4: facts-free adapters behave exactly as before', async () => {
  const tmpDir = makeTmpDir();
  try {
    const frozenDir = path.join(tmpDir, 'frozens');
    const frozen = freeze(frozenDir, testDraft);
    const ledger = new Ledger(path.join(tmpDir, 'ledger.jsonl'));

    const adapter = makeMockAdapter('success');
    const result = await runCell({
      frozenDir, alignmentId: frozen.alignmentId, cellId: 'qc', runId: 'run-1',
      input: {}, buildUserPrompt: () => 'judge this',
      parseCredit: (raw) => ({ credit: JSON.parse(raw), verdict: 'worked' as Verdict }),
      ledger, adapter,
    });

    assert.strictEqual(result.final.verdictKind, 'worked');
    assert.ok(!('outcome' in result.final), 'no outcome key on the entry');
    const credit = JSON.parse(result.final.credit);
    assert.ok(!('outcome' in credit), 'no outcome key on the credit');
    assert.ok(!('timedOut' in credit) && !('signal' in credit) && !('exitCode' in credit));
    assert.ok(await ledger.verify().then((v) => v.ok));
  } finally {
    cleanup(tmpDir);
  }
});
