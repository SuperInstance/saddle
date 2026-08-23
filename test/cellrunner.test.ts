import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { Ledger } from '../src/ledger.ts';
import { runCell, type CellAdapter } from '../src/cellrunner.ts';
import { freeze, type AlignmentDraft, type FrozenState } from '../src/frozens.ts';

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
    async call(input) {
      return {
        raw: '{"pass": true, "reason": "test"}',
        latencyMs: 42,
      };
    },
  };
}

function makeThrowAdapter(): CellAdapter {
  return {
    name: 'test-throw',
    async call(_input) {
      throw new Error('Network error: connection timeout');
    },
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

    assert.equal(result.entries.length, 2);
    assert.equal(result.entries[0].verdict, 'failed');
    assert.equal(result.entries[0].escalated, false);
    assert.ok(result.entries[0].note?.startsWith('attempt 1:'));

    assert.equal(result.entries[1].verdict, 'worked');
    assert.equal(result.entries[1].escalated, false);
    assert.equal(result.entries[1].retryOf, result.entries[0].seq);
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

    assert.equal(result.entries.length, 2);
    assert.equal(result.entries[0].verdict, 'failed');
    assert.equal(result.entries[0].escalated, false);

    assert.equal(result.entries[1].verdict, 'failed');
    assert.equal(result.entries[1].escalated, true);
    assert.ok(result.entries[1].note?.startsWith('gave up:'));
    assert.equal(result.entries[1].retryOf, result.entries[0].seq);
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
