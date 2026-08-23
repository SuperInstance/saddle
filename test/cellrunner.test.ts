import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { Ledger } from '../src/ledger.ts';
import { runCell, isJudgmentCredit, type CellAdapter } from '../src/cellrunner.ts';
import { freeze, type AlignmentDraft } from '../src/frozens.ts';

function makeTestTmpDir(): string {
  return fs.mkdtempSync(path.join(tmpdir(), 'cellrunner-test-'));
}

function makeTestDraft(): AlignmentDraft {
  return {
    id: 'test-alignment',
    model: 'test-model',
    useCase: 'testing',
    prompt: 'You are a test judge.',
    inputFilters: [],
    outputFilters: [],
    params: { temperature: 0.1 },
    directiveChunks: ['chunk1', 'chunk2', 'chunk3'],
  };
}

function makeSuccessAdapter(): CellAdapter {
  return {
    name: 'test-success',
    async call(_input) {
      return {
        raw: '{"pass": true, "reason": "test"}',
        latencyMs: 42,
      };
    },
  };
}

function makeCountingAdapter(rawByCall: string[]): CellAdapter & { calls: number } {
  const adapter = {
    name: 'test-counting',
    calls: 0,
    async call(_input: unknown) {
      const raw = rawByCall[Math.min(adapter.calls, rawByCall.length - 1)] ?? '';
      adapter.calls++;
      return { raw, latencyMs: 10 };
    },
  };
  return adapter;
}

function makeThrowAdapter(): CellAdapter {
  return {
    name: 'test-throw',
    async call(_input) {
      throw new Error('Network error: connection timeout');
    },
  };
}

/** Standard option bag with overridable pieces, to keep the tests below terse. */
function baseOptions(overrides: {
  ledger: Ledger;
  frozenDir: string;
  alignmentId: string;
  adapter: CellAdapter;
  parseCredit: (raw: string) => { credit: unknown; verdict: 'worked' | 'failed' };
  runId: string;
  maxAttempts?: number;
}) {
  return {
    frozenDir: overrides.frozenDir,
    alignmentId: overrides.alignmentId,
    cellId: 'test-cell',
    runId: overrides.runId,
    input: { line: 'test' },
    buildUserPrompt: (input: unknown) => `Judge: ${JSON.stringify(input)}`,
    parseCredit: (raw: string) => overrides.parseCredit(raw),
    ledger: overrides.ledger,
    adapter: overrides.adapter,
    ...(overrides.maxAttempts !== undefined ? { maxAttempts: overrides.maxAttempts } : {}),
  };
}

test('cellrunner: happy path — 1 entry, verdict worked', async () => {
  const tmpDir = makeTestTmpDir();
  try {
    const frozenDir = path.join(tmpDir, 'frozens');
    const ledgerPath = path.join(tmpDir, 'ledger.jsonl');

    const draft = makeTestDraft();
    const frozen = freeze(frozenDir, draft);
    const ledger = new Ledger(ledgerPath);

    const result = await runCell({
      frozenDir,
      alignmentId: frozen.alignmentId,
      cellId: 'test-cell',
      runId: 'run-001',
      input: { line: 'hello world' },
      buildUserPrompt: (input) => `Judge this: ${JSON.stringify(input)}`,
      parseCredit: (raw) => ({
        credit: { pass: true, reason: 'test' },
        verdict: 'worked',
      }),
      ledger,
      adapter: makeSuccessAdapter(),
    });

    assert.equal(result.entries.length, 1);
    assert.equal(result.final.verdict, 'worked');
    assert.equal(result.final.escalated, false);
    assert.equal(result.final.note, undefined);

    const debit = JSON.parse(result.final.debit);
    assert.ok(debit.prompt.system);
    assert.ok(debit.prompt.user.includes('hello world'));
    assert.equal(debit.model, 'test-model');
    assert.equal(debit.params.temperature, 0.1);
    assert.equal(debit.adapter, 'test-success');

    const verify = await ledger.verify();
    assert.equal(verify.ok, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('cellrunner: parseCredit throw triggers retry, then success', async () => {
  const tmpDir = makeTestTmpDir();
  try {
    const frozenDir = path.join(tmpDir, 'frozens');
    const ledgerPath = path.join(tmpDir, 'ledger.jsonl');

    const draft = makeTestDraft();
    const frozen = freeze(frozenDir, draft);
    const ledger = new Ledger(ledgerPath);

    let attempts = 0;

    const result = await runCell({
      frozenDir,
      alignmentId: frozen.alignmentId,
      cellId: 'test-cell',
      runId: 'run-002',
      input: { line: 'test' },
      buildUserPrompt: (input) => `Judge: ${JSON.stringify(input)}`,
      parseCredit: (raw) => {
        attempts++;
        if (attempts === 1) {
          throw new Error('Invalid JSON in response');
        }
        return { credit: { pass: true }, verdict: 'worked' };
      },
      ledger,
      adapter: makeSuccessAdapter(),
      maxAttempts: 2,
    });

    const [first, second] = result.entries;
    assert.ok(first);
    assert.ok(second);
    assert.equal(result.entries.length, 2);
    assert.equal(first.verdict, 'failed');
    assert.equal(first.escalated, false);
    assert.ok(first.note?.startsWith('attempt 1:'));

    assert.equal(second.verdict, 'worked');
    assert.equal(second.escalated, false);
    assert.equal(second.retryOf, first.seq);
    assert.equal(result.final.verdict, 'worked');

    const verify = await ledger.verify();
    assert.equal(verify.ok, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('cellrunner: both attempts fail, final escalated=true', async () => {
  const tmpDir = makeTestTmpDir();
  try {
    const frozenDir = path.join(tmpDir, 'frozens');
    const ledgerPath = path.join(tmpDir, 'ledger.jsonl');

    const draft = makeTestDraft();
    const frozen = freeze(frozenDir, draft);
    const ledger = new Ledger(ledgerPath);

    const result = await runCell({
      frozenDir,
      alignmentId: frozen.alignmentId,
      cellId: 'test-cell',
      runId: 'run-003',
      input: { line: 'test' },
      buildUserPrompt: (input) => `Judge: ${JSON.stringify(input)}`,
      parseCredit: (raw) => {
        throw new Error('Always fails');
      },
      ledger,
      adapter: makeSuccessAdapter(),
      maxAttempts: 2,
    });

    const [first, second] = result.entries;
    assert.ok(first);
    assert.ok(second);
    assert.equal(result.entries.length, 2);
    assert.equal(first.verdict, 'failed');
    assert.equal(first.escalated, false);

    assert.equal(second.verdict, 'failed');
    assert.equal(second.escalated, true);
    assert.ok(second.note?.startsWith('gave up:'));
    assert.equal(second.retryOf, first.seq);
    assert.equal(result.final.escalated, true);

    const verify = await ledger.verify();
    assert.equal(verify.ok, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('cellrunner: adapter transport throw caught', async () => {
  const tmpDir = makeTestTmpDir();
  try {
    const frozenDir = path.join(tmpDir, 'frozens');
    const ledgerPath = path.join(tmpDir, 'ledger.jsonl');

    const draft = makeTestDraft();
    const frozen = freeze(frozenDir, draft);
    const ledger = new Ledger(ledgerPath);

    const result = await runCell({
      frozenDir,
      alignmentId: frozen.alignmentId,
      cellId: 'test-cell',
      runId: 'run-004',
      input: { line: 'test' },
      buildUserPrompt: (input) => `Judge: ${JSON.stringify(input)}`,
      parseCredit: (raw) => ({
        credit: { pass: true },
        verdict: 'worked',
      }),
      ledger,
      adapter: makeThrowAdapter(),
      maxAttempts: 1,
    });

    assert.equal(result.entries.length, 1);
    assert.equal(result.final.verdict, 'failed');
    assert.equal(result.final.escalated, true);
    assert.ok(result.final.note?.includes('Network error'));

    const credit = JSON.parse(result.final.credit);
    assert.ok(credit.error);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('cellrunner: tampered frozen state throws, no ledger entry', async () => {
  const tmpDir = makeTestTmpDir();
  try {
    const frozenDir = path.join(tmpDir, 'frozens');
    const ledgerPath = path.join(tmpDir, 'ledger.jsonl');

    const draft = makeTestDraft();
    const frozen = freeze(frozenDir, draft);
    const ledger = new Ledger(ledgerPath);

    // Tamper with the frozen state file
    const frozenFile = path.join(frozenDir, `${frozen.alignmentId}.json`);
    fs.chmodSync(frozenFile, 0o644); // Make it writable
    const content = JSON.parse(fs.readFileSync(frozenFile, 'utf8'));
    content.prompt = 'Tampered prompt';
    fs.writeFileSync(frozenFile, JSON.stringify(content));

    // Should throw during thaw, before any ledger entry is appended
    let threw = false;
    try {
      await runCell({
        frozenDir,
        alignmentId: frozen.alignmentId,
        cellId: 'test-cell',
        runId: 'run-005',
        input: { line: 'test' },
        buildUserPrompt: (input) => `Judge: ${JSON.stringify(input)}`,
        parseCredit: (raw) => ({
          credit: { pass: true },
          verdict: 'worked',
        }),
        ledger,
        adapter: makeSuccessAdapter(),
      });
    } catch (err) {
      threw = true;
      assert.ok(String(err).includes('verification'));
    }

    assert.equal(threw, true);

    // Verify no ledger entry was appended
    const count = await ledger.count();
    assert.equal(count, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('cellrunner: QC-failed judgment is final — no retry, no escalation (foreman bug 1+2)', async () => {
  const tmpDir = makeTestTmpDir();
  try {
    const frozenDir = path.join(tmpDir, 'frozens');
    const ledgerPath = path.join(tmpDir, 'ledger.jsonl');

    const draft = makeTestDraft();
    const frozen = freeze(frozenDir, draft);
    const ledger = new Ledger(ledgerPath);
    const adapter = makeCountingAdapter(['{"pass": false}']);

    const result = await runCell(
      baseOptions({
        frozenDir,
        alignmentId: frozen.alignmentId,
        ledger,
        adapter,
        runId: 'run-qc-fail',
        maxAttempts: 3,
        parseCredit: () => ({
          credit: { pass: false, scores: { kid_safe: 7, in_voice: 8, fresh: 7 } },
          verdict: 'failed',
        }),
      })
    );

    // A valid judgment is final regardless of pass/fail: exactly one attempt.
    assert.equal(adapter.calls, 1);
    assert.equal(result.entries.length, 1);
    assert.equal(result.final.verdict, 'failed');
    assert.equal(result.final.escalated, false);
    assert.equal(result.final.note, undefined);

    // The credit is a judgment credit: scores, no `error`, latency + attempts stamped.
    const credit = JSON.parse(result.final.credit);
    assert.equal(isJudgmentCredit(credit), true);
    assert.equal(credit.pass, false);
    assert.deepEqual(credit.scores, { kid_safe: 7, in_voice: 8, fresh: 7 });
    assert.equal('error' in credit, false);
    assert.equal(typeof credit.latencyMs, 'number');
    assert.ok(credit.latencyMs >= 0);
    assert.equal(credit.attempts, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('cellrunner: parse error then QC-failed judgment — stops at the judgment, no third attempt', async () => {
  const tmpDir = makeTestTmpDir();
  try {
    const frozenDir = path.join(tmpDir, 'frozens');
    const ledgerPath = path.join(tmpDir, 'ledger.jsonl');

    const draft = makeTestDraft();
    const frozen = freeze(frozenDir, draft);
    const ledger = new Ledger(ledgerPath);
    const adapter = makeCountingAdapter(['garbage', '{"pass": false}']);

    let calls = 0;
    const result = await runCell(
      baseOptions({
        frozenDir,
        alignmentId: frozen.alignmentId,
        ledger,
        adapter,
        runId: 'run-retry-then-judgment',
        maxAttempts: 3,
        parseCredit: (raw) => {
          calls++;
          if (calls === 1) throw new Error('no JSON object found');
          return { credit: { pass: false, scores: { kid_safe: 9, in_voice: 5, fresh: 6 } }, verdict: 'failed' };
        },
      })
    );

    // Attempt 1 unparseable → retry. Attempt 2 is a valid (failed) judgment → stop.
    assert.equal(adapter.calls, 2);
    assert.equal(result.entries.length, 2);
    assert.equal(result.final.verdict, 'failed');
    assert.equal(result.final.escalated, false);

    const firstCredit = JSON.parse(result.entries[0]!.credit);
    assert.equal('error' in firstCredit, true);
    assert.equal(firstCredit.error, 'no JSON object found');

    const finalCredit = JSON.parse(result.final.credit);
    assert.equal(isJudgmentCredit(finalCredit), true);
    assert.equal(finalCredit.attempts, 2);
    assert.equal(typeof finalCredit.latencyMs, 'number');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('cellrunner: worked judgment also stamps latencyMs/attempts on the credit', async () => {
  const tmpDir = makeTestTmpDir();
  try {
    const frozenDir = path.join(tmpDir, 'frozens');
    const ledgerPath = path.join(tmpDir, 'ledger.jsonl');

    const draft = makeTestDraft();
    const frozen = freeze(frozenDir, draft);
    const ledger = new Ledger(ledgerPath);

    const result = await runCell(
      baseOptions({
        frozenDir,
        alignmentId: frozen.alignmentId,
        ledger,
        adapter: makeSuccessAdapter(),
        runId: 'run-worked-latency',
        parseCredit: () => ({ credit: { pass: true, scores: {} }, verdict: 'worked' }),
      })
    );

    const credit = JSON.parse(result.final.credit);
    assert.equal(credit.pass, true);
    assert.equal(typeof credit.latencyMs, 'number');
    assert.ok(credit.latencyMs >= 0);
    assert.equal(credit.attempts, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('cellrunner: isJudgmentCredit distinguishes judgments from attempt errors', () => {
  assert.equal(isJudgmentCredit({ pass: false, scores: {} }), true);
  assert.equal(isJudgmentCredit({ pass: true }), true);
  assert.equal(isJudgmentCredit({ error: 'timeout' }), false);
  assert.equal(isJudgmentCredit(null), false);
  assert.equal(isJudgmentCredit('string credit'), false);
});
