import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { canonicalResultOf, projectCard, projectLine, replayCanonical } from '../src/canonical.ts';
import { Ledger } from '../src/ledger.ts';
import type { LedgerEntry } from '../src/ledger.ts';
import { runCell } from '../src/cellrunner.ts';
import { freeze } from '../src/frozens.ts';
import type { AlignmentDraft } from '../src/frozens.ts';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'saddle-canonical-'));
}

const draft: AlignmentDraft = {
  id: 'canon-probe',
  model: 'haiku-5',
  useCase: 'probe',
  prompt: 'You are a probe.',
  inputFilters: [],
  outputFilters: [],
  params: { temperature: 0.5 },
  directiveChunks: ['go'],
};

test('typed derivation maps every field of a rich v4 entry', async () => {
  const dir = tmpDir();
  const frozen = freeze(dir, draft);
  let c = 0;
  const adapter = {
    name: 'rich',
    async call() {
      c++;
      return { raw: '{"ok":true}', latencyMs: 9, outcome: { timedOut: true, exitCode: 0 } };
    },
  };
  const ledger = new Ledger(path.join(dir, 'l.jsonl'));
  const res = await runCell({
    frozenDir: dir,
    alignmentId: frozen.alignmentId,
    cellId: 'qc',
    runId: 'r1',
    input: { n: 1 },
    buildUserPrompt: () => 'go',
    parseCredit: (raw) => ({ credit: JSON.parse(raw), verdict: 'worked' }),
    ledger,
    adapter,
  });
  const canon = canonicalResultOf(res.final);
  assert.equal(canon.verdictKind, 'worked');
  assert.deepEqual(canon.outcome, { timedOut: true, exitCode: 0 });
  assert.equal(canon.attempt, 1);
  assert.ok(typeof canon.latencyMs === 'number' && canon.latencyMs >= 0, 'latencyMs stamped');
  assert.ok(canon.usage && canon.usage.totalTokens > 0);
  assert.equal(canon.error, undefined);
  assert.equal(canon.cellId, 'qc');
  assert.equal(canon.runId, 'r1');
  // what runCell computed and what the seam derives are the same shape
  assert.deepEqual(res.canonical, canon);
});

test('legacy entry classification; entry not mutated', () => {
  const entry: LedgerEntry = {
    seq: 1,
    ts: '2026-01-01T00:00:00.000Z',
    cellId: 'qc',
    runId: 'r1',
    alignmentId: 'aaaaaaaaaaaaaaaa',
    debit: '{}',
    credit: '{"error":"adapter error: boom"}',
    verdict: 'failed',
    escalated: false,
    prevHash: '',
    hash: '',
  };
  const before = JSON.parse(JSON.stringify(entry));
  const canon = canonicalResultOf(entry);
  assert.equal(canon.verdictKind, 'execution-error');
  assert.equal(canon.error, 'adapter error: boom');
  assert.equal(canon.usage, undefined);
  assert.deepEqual(entry, before, 'entry must not be mutated');
});

test('purity: same input → same output; no clock shape in views', () => {
  const entry: LedgerEntry = {
    seq: 12,
    ts: '2026-01-01T00:00:00.000Z',
    cellId: 'qc',
    runId: 'r1',
    alignmentId: 'aaaaaaaaaaaaaaaa',
    debit: '{}',
    credit: '{"ok":true,"latencyMs":9,"attempts":1}',
    verdict: 'worked',
    verdictKind: 'worked',
    escalated: false,
    prevHash: '',
    hash: '',
  };
  const c1 = canonicalResultOf(entry);
  const c2 = canonicalResultOf(entry);
  assert.deepEqual(projectCard(c1), projectCard(c2));
  assert.equal(projectLine(c1), projectLine(c2));
  // content-only views: no ISO timestamp shape in the card/line
  const blob = JSON.stringify(projectCard(c1)) + projectLine(c1);
  assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(blob), 'views must carry no clock');
});

test('replay identity, zero re-execution', async () => {
  const dir = tmpDir();
  const frozen = freeze(dir, draft);
  let calls = 0;
  const adapter = {
    name: 'counting',
    async call() {
      calls++;
      return { raw: '{"ok":true}', latencyMs: 5, outcome: { timedOut: true, exitCode: 0 } };
    },
  };
  const ledger = new Ledger(path.join(dir, 'l.jsonl'));
  const res = await runCell({
    frozenDir: dir,
    alignmentId: frozen.alignmentId,
    cellId: 'qc',
    runId: 'r1',
    input: {},
    buildUserPrompt: () => 'go',
    parseCredit: (raw) => ({ credit: JSON.parse(raw), verdict: 'worked' }),
    ledger,
    adapter,
  });
  assert.equal(calls, 1);

  const replayed: unknown[] = [];
  for await (const canon of replayCanonical(ledger)) replayed.push(canon);
  assert.equal(calls, 1, 'replay must not re-execute the adapter');
  const lastReplayed = replayed[replayed.length - 1];
  assert.ok(lastReplayed);
  assert.deepEqual(lastReplayed, canonicalResultOf(res.final));
  assert.deepEqual(lastReplayed, res.canonical);
});

test('unparseable credit never throws', () => {
  const entry: LedgerEntry = {
    seq: 1,
    ts: '2026-01-01T00:00:00.000Z',
    cellId: 'qc',
    runId: 'r1',
    alignmentId: 'aaaaaaaaaaaaaaaa',
    debit: '{}',
    credit: 'not json{',
    verdict: 'failed',
    escalated: false,
    prevHash: '',
    hash: '',
  };
  const canon = canonicalResultOf(entry);
  assert.equal(canon.credit, null);
  assert.equal(canon.verdictKind, 'judgment-fail'); // unreadable credit carries no error signature
  const card = projectCard(canon);
  assert.ok(card.headline.includes('judgment-fail'));
});

test('flags order: verdictKind then outcome facts in fixed order', () => {
  const entry: LedgerEntry = {
    seq: 1,
    ts: '2026-01-01T00:00:00.000Z',
    cellId: 'qc',
    runId: 'r1',
    alignmentId: 'aaaaaaaaaaaaaaaa',
    debit: '{}',
    credit: '{}',
    verdict: 'failed',
    verdictKind: 'execution-error',
    escalated: false,
    outcome: { signal: 15, timedOut: true },
    prevHash: '',
    hash: '',
  };
  const card = projectCard(canonicalResultOf(entry));
  assert.deepEqual(card.flags, ['execution-error', 'timedOut', 'signal']);
});
