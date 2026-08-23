import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Ledger, type LedgerEntry } from '../../src/ledger.ts';
import { freeze, thaw, type AlignmentDraft, type FrozenState } from '../../src/frozens.ts';
import type { RunCellResult } from '../../src/cellrunner.ts';
import { parseCredit, buildLineUserPrompt, isRunDone, selectTodoLines, runIdForLine, buildStats, percentile } from './run.ts';
import { REPO_ROOT, resolveRepoPath } from './extract-lines.ts';
import { buildFindingsReport, toJudgment, getRecommendation } from './findings.ts';
import { extractLines } from './walk.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeTestTmpDir(): string {
  return fs.mkdtempSync(path.join(tmpdir(), 'ft1-test-'));
}

function makeTestFrozen(dir: string, directiveChunks?: string[]): FrozenState {
  const draft: AlignmentDraft = {
    id: 'test-judge',
    model: 'test-model',
    useCase: 'testing',
    prompt: 'Judge this line',
    inputFilters: [],
    outputFilters: [],
    params: { temperature: 0.1, thinking: 'disabled' },
    directiveChunks: directiveChunks ?? ['chunk1', 'chunk2', 'chunk3'],
  };
  return freeze(dir, draft);
}

/** Run a test body with a frozen alignment in a temp dir that is cleaned up after. */
async function withFrozen<T>(chunks: string[] | undefined, fn: (frozen: FrozenState) => T | Promise<T>): Promise<void> {
  const tmpDir = makeTestTmpDir();
  try {
    await fn(makeTestFrozen(path.join(tmpDir, 'frozens'), chunks));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
}

test('parseCredit: valid JSON', () => {
  return withFrozen(undefined, (frozen) => {
    const raw = '{"pass": true, "scores": {"kid_safe": 9, "in_voice": 8, "fresh": 7}, "worst": "kid_safe", "reason": "good"}';
    const result = parseCredit(raw, frozen);
    assert.equal(result.verdict, 'worked');
    const credit = result.credit as any;
    assert.ok(credit.pass === true);
    assert.equal(credit.scores.kid_safe, 9);
  });
});

test('parseCredit: fenced JSON', () => {
  return withFrozen(undefined, (frozen) => {
    const raw = '```json\n{"pass": true, "scores": {"kid_safe": 9, "in_voice": 8, "fresh": 7}, "worst": "fresh", "reason": "ok"}\n```';
    const result = parseCredit(raw, frozen);
    assert.equal(result.verdict, 'worked');
  });
});

test('parseCredit: garbage throws', () => {
  return withFrozen(undefined, (frozen) => {
    assert.throws(() => parseCredit('no json here', frozen));
    assert.throws(() => parseCredit('{incomplete', frozen));
  });
});

test('parseCredit: out of range throws', () => {
  return withFrozen(undefined, (frozen) => {
    assert.throws(() =>
      parseCredit('{"pass": true, "scores": {"kid_safe": 11, "in_voice": 8, "fresh": 7}, "worst": "kid_safe", "reason": "bad"}', frozen)
    );
  });
});

test('parseCredit: verdict mapping honors thresholds', () => {
  return withFrozen(undefined, (frozen) => {
    const raw1 = '{"pass": true, "scores": {"kid_safe": 8, "in_voice": 6, "fresh": 5}, "worst": "fresh", "reason": "ok"}';
    assert.equal(parseCredit(raw1, frozen).verdict, 'worked');

    const raw2 = '{"pass": true, "scores": {"kid_safe": 7, "in_voice": 6, "fresh": 5}, "worst": "kid_safe", "reason": "low"}';
    assert.equal(parseCredit(raw2, frozen).verdict, 'failed');

    const raw3 = '{"pass": true, "scores": {"kid_safe": 8, "in_voice": 5, "fresh": 5}, "worst": "in_voice", "reason": "low"}';
    assert.equal(parseCredit(raw3, frozen).verdict, 'failed');
  });
});

test('judge-alignment: freeze/thaw roundtrip', () => {
  const tmpDir = makeTestTmpDir();
  try {
    const frozenDir = path.join(tmpDir, 'frozens');
    const draft: AlignmentDraft = {
      id: 'test-judge',
      model: 'test-model',
      useCase: 'testing',
      prompt: 'Judge this line',
      inputFilters: [],
      outputFilters: [],
      params: { temperature: 0.1, thinking: 'disabled' },
      directiveChunks: ['chunk1', 'chunk2', 'chunk3'],
    };

    const frozen1 = freeze(frozenDir, draft);
    assert.ok(frozen1.alignmentId);
    assert.equal(frozen1.model, 'test-model');

    // Re-freeze identical content — should be no-op with same alignmentId
    const frozen2 = freeze(frozenDir, draft);
    assert.equal(frozen1.alignmentId, frozen2.alignmentId);

    // Thaw and verify
    const thawed = thaw(frozenDir, frozen1.alignmentId);
    assert.equal(thawed.prompt, draft.prompt);
    assert.deepEqual(thawed.params, draft.params);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('buildUserPrompt: the FROZEN directive chunk drives the prompt, not the module constant (foreman bug 6)', () => {
  const tmpDir = makeTestTmpDir();
  try {
    const frozen = makeTestFrozen(path.join(tmpDir, 'frozens'), ['a', 'b', 'FROZEN JUDGE DIRECTIVE']);
    const prompt = buildLineUserPrompt({ persona: 'rivet', line: 'beep boop' }, frozen);

    assert.ok(prompt.startsWith('FROZEN JUDGE DIRECTIVE'));
    assert.ok(prompt.includes('--- LINE ---'));
    assert.ok(prompt.includes('"line":"beep boop"'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('buildUserPrompt: throws when the frozen state lacks a judge directive chunk', () => {
  const tmpDir = makeTestTmpDir();
  try {
    const frozen = makeTestFrozen(path.join(tmpDir, 'frozens'), ['only-one-chunk']);
    assert.throws(() => buildLineUserPrompt({ line: 'x' }, frozen), /directiveChunks\[2\]/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('extract-lines: walk BANTER', () => {
  const banter = {
    pool1: ['hello', 'world'],
    pool2: [{ line: 'goodbye', tier: 2 }],
  };

  const lines = extractLines(banter, {}, [], [], {}, {});
  assert.equal(lines.length, 3);
  assert.ok(lines.some((l) => l.text === 'hello' && l.bank === 'banter.pool1'));
  assert.ok(lines.some((l) => l.text === 'goodbye' && l.tier === 2));
});

test('extract-lines: dedupe by text', () => {
  const banter1 = { pool1: ['hello', 'world'] };
  const banter2 = { pool2: ['hello', 'unique'] };

  const lines = extractLines({ ...banter1, ...banter2 }, {}, [], [], {}, {});
  const helloLines = lines.filter((l) => l.text === 'hello');
  assert.equal(helloLines.length, 1);
  assert.ok(helloLines[0]!.bank === 'banter.pool1');
});

test('extract-lines: TIER_UP_LINES tiers', () => {
  const tierUp = {
    coworker: ['tier1-line'],
    friend: ['tier2-line'],
  };

  const lines = extractLines({}, tierUp, [], [], {}, {});
  assert.ok(lines.some((l) => l.text === 'tier1-line' && l.tier === 1));
  assert.ok(lines.some((l) => l.text === 'tier2-line' && l.tier === 2));
});

test('extract-lines: OBSERVATIONS evaluation', () => {
  const observations = [
    (state: any) => (state.counters.crashes > 0 ? 'crashed!' : null),
    (state: any) => `blocks: ${state.counters.blocksMined}`,
  ];

  const lines = extractLines({}, {}, observations, [], {}, {});
  assert.ok(lines.some((l) => l.text === 'crashed!' && l.evaluatedWith === 'mock-state'));
  assert.ok(lines.some((l) => l.text === 'blocks: 0'));
});

test('extract-lines: PERSONAS walk', () => {
  const personas = {
    rivet: {
      banter: { laugh: ['ha!', 'hehe'] },
      tierUpLines: { buddy: ['you rock'] },
      ambient: [{ line: 'beep boop' }],
      canned: ['stock line'],
      roundness: {
        greeting: { line: 'hey there' },
        nested: { deep: { line: 'found me' } },
      },
    },
  };

  const lines = extractLines({}, {}, [], [], personas, {});
  assert.ok(lines.some((l) => l.bank.includes('persona.rivet.banter')));
  assert.ok(lines.some((l) => l.text === 'beep boop'));
  assert.ok(lines.some((l) => l.text === 'hey there' && l.bank === 'persona.rivet.roundness.greeting'));
  assert.ok(lines.some((l) => l.text === 'found me' && l.bank === 'persona.rivet.roundness.nested.deep'));
});

test('extract-lines: sequential ID generation', () => {
  const banter = { pool: ['a', 'b', 'c'] };
  const lines = extractLines(banter, {}, [], [], {}, {});
  assert.equal(lines[0]!.id, 'L0001');
  assert.equal(lines[1]!.id, 'L0002');
  assert.equal(lines[2]!.id, 'L0003');
});

test('extract-lines: party OBJECTIONS string banks extracted, no textless records (foreman bug 7)', () => {
  // OBJECTIONS is Record<persona, string[]> — the old walker read entry.line off
  // strings, emitting one garbage textless record and deduping the rest away on
  // undefined. Strings must be extracted; textless records must never exist.
  const party = {
    crosstalk: { bolt: [{ on: 'crash', line: 'corner two again' }] },
    objections: { bolt: ['Track first.', 'Bench later.'], juno: ['Point of order!'] },
  };
  const lines = extractLines({}, {}, [], [], {}, party);
  const objections = lines.filter((l) => l.bank.startsWith('party.objections'));
  assert.equal(objections.length, 3);
  assert.ok(objections.every((l) => typeof l.text === 'string' && l.text.length > 0));
  assert.ok(lines.some((l) => l.text === 'corner two again' && l.gate === 'crash'));
  assert.ok(lines.every((l) => typeof l.text === 'string')); // the textless guard
});

test('extract-lines: CLI paths resolve inside the repo root — no stray files above it (foreman bug 5)', () => {
  // This script lives at <repo>/field/field-trial-1/ — repo root is two levels up.
  assert.equal(REPO_ROOT, path.resolve(__dirname, '../..'));

  // Default --src resolves to the sibling Scrapcraft checkout from any cwd.
  const defaultSrc = resolveRepoPath('../Scrapcraft/src/companion');
  assert.equal(defaultSrc, path.resolve(REPO_ROOT, '../Scrapcraft/src/companion'));

  // Relative --out paths resolve INSIDE the repo (the old code wrote one level above it).
  const out = resolveRepoPath('field/field-trial-1/data/lines.json');
  assert.ok(out.startsWith(REPO_ROOT + path.sep), `out path escaped the repo: ${out}`);
  assert.equal(path.relative(REPO_ROOT, out), path.join('field', 'field-trial-1', 'data', 'lines.json'));

  // Absolute paths pass through untouched.
  assert.equal(resolveRepoPath('/abs/path'), '/abs/path');
});

// ---------------------------------------------------------------------------
// Resume logic (foreman bug 3)
// ---------------------------------------------------------------------------

/** Append a synthetic entry with a JSON-encoded credit, like the real ledger does. */
function fakeEntry(ledger: Ledger, runId: string, credit: unknown, verdict: 'worked' | 'failed', escalated: boolean): void {
  ledger.append({
    cellId: 'ft1/banter-qc-judge',
    runId,
    alignmentId: 'align-test',
    debit: { prompt: { system: 's', user: 'directive\n\n--- LINE ---\n{}' }, model: 'm', params: {}, adapter: 'a' },
    credit,
    verdict,
    escalated,
  });
}

test('resume: QC-failed judgment is DONE — never re-judged on rerun (foreman bug 3)', async () => {
  const tmpDir = makeTestTmpDir();
  try {
    const ledger = new Ledger(path.join(tmpDir, 'ledger.jsonl'));

    // Line A: valid judgment that FAILED quality (scores, no error, not escalated).
    fakeEntry(ledger, 'ft1-A', { pass: false, scores: { kid_safe: 7, in_voice: 8, fresh: 8 }, attempts: 1 }, 'failed', false);
    // Line B: gave up after all attempts (error credit, escalated) — data, leave it.
    fakeEntry(ledger, 'ft1-B', { error: 'no JSON object found' }, 'failed', true);
    // Line C: error credit, NOT escalated — process crashed mid-retry → redo.
    fakeEntry(ledger, 'ft1-C', { error: 'invalid JSON' }, 'failed', false);
    // Line D: never attempted.

    const lastEntries = new Map<string, LedgerEntry>();
    for await (const entry of ledger.stream()) {
      lastEntries.set(entry.runId, entry);
    }

    const lines = [
      { id: 'A', persona: 'rivet', bank: 'b', text: 'a' },
      { id: 'B', persona: 'rivet', bank: 'b', text: 'b' },
      { id: 'C', persona: 'rivet', bank: 'b', text: 'c' },
      { id: 'D', persona: 'rivet', bank: 'b', text: 'd' },
    ];

    assert.equal(isRunDone(lastEntries.get('ft1-A')!), true); // the exact foreman bug: QC-fail ≠ redo
    assert.equal(isRunDone(lastEntries.get('ft1-B')!), true);
    assert.equal(isRunDone(lastEntries.get('ft1-C')!), false);
    assert.deepEqual(
      selectTodoLines(lines, lastEntries).map((l) => l.id),
      ['C', 'D']
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('resume: retries supersede — a judgment after an error credit marks the run done', async () => {
  const tmpDir = makeTestTmpDir();
  try {
    const ledger = new Ledger(path.join(tmpDir, 'ledger.jsonl'));
    fakeEntry(ledger, 'ft1-A', { error: 'no JSON object found' }, 'failed', false); // attempt 1, crashed?
    fakeEntry(ledger, 'ft1-A', { pass: true, scores: { kid_safe: 9, in_voice: 8, fresh: 8 }, attempts: 2 }, 'worked', false);

    const lastEntries = new Map<string, LedgerEntry>();
    for await (const entry of ledger.stream()) {
      lastEntries.set(entry.runId, entry);
    }

    assert.equal(isRunDone(lastEntries.get('ft1-A')!), true);
    assert.deepEqual(selectTodoLines([{ id: 'A', persona: 'rivet', bank: 'b', text: 'a' }], lastEntries), []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('resume: malformed credit JSON is treated as not-done (defensive parse)', async () => {
  const tmpDir = makeTestTmpDir();
  try {
    const ledger = new Ledger(path.join(tmpDir, 'ledger.jsonl'));
    const entry = ledger.append({
      cellId: 'c',
      runId: 'ft1-X',
      alignmentId: 'a',
      debit: {},
      credit: undefined, // ledger stores the JSON string "null"
      verdict: 'failed',
      escalated: false,
    });
    assert.equal(isRunDone(entry), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('resume: runIdForLine prefixes line ids', () => {
  assert.equal(runIdForLine({ id: 'L0042', persona: 'rivet', bank: 'b', text: 'x' }), 'ft1-L0042');
});

// ---------------------------------------------------------------------------
// Stats accounting (foreman bug 4)
// ---------------------------------------------------------------------------

function resultOf(entries: Array<{ credit: unknown; verdict: 'worked' | 'failed'; escalated: boolean }>): RunCellResult {
  const built: LedgerEntry[] = entries.map((e, i) => ({
    seq: i + 1,
    ts: new Date().toISOString(),
    cellId: 'c',
    runId: 'r',
    alignmentId: 'a',
    debit: '{}',
    credit: JSON.stringify(e.credit),
    verdict: e.verdict,
    escalated: e.escalated,
    prevHash: '',
    hash: '',
  }));
  return { entries: built, final: built[built.length - 1]! };
}

test('stats: attempts count real ledger entries; latency read from judgment credits only (foreman bug 4)', () => {
  return withFrozen(undefined, (frozen) => {
    const results = [
      // line 1: parse error, then a passing judgment (latencyMs 100)
      resultOf([
        { credit: { error: 'no JSON' }, verdict: 'failed', escalated: false },
        { credit: { pass: true, scores: {}, latencyMs: 100, attempts: 2 }, verdict: 'worked', escalated: false },
      ]),
      // line 2: gave up (error credit — must NOT contribute latency)
      resultOf([{ credit: { error: 'timeout' }, verdict: 'failed', escalated: true }]),
      // line 3: QC-failed judgment (latencyMs 200)
      resultOf([{ credit: { pass: false, scores: {}, latencyMs: 200, attempts: 1 }, verdict: 'failed', escalated: false }]),
    ];

    const stats = buildStats(results, 3, frozen);

    assert.equal(stats.judged, 3);
    assert.equal(stats.passed, 1);
    assert.equal(stats.failed, 2);
    assert.equal(stats.escalated, 1);
    // TRUE attempt count: 2 + 1 + 1 ledger entries, not judged + failed.
    assert.equal(stats.attempts, 4);
    // Latency stats come from judgment credits only ([100, 200]).
    assert.equal(stats.latencyMs.p50, 100);
    assert.equal(stats.latencyMs.p95, 200);
    assert.equal(stats.latencyMs.mean, 150);
    assert.equal(stats.model, 'test-model');
    assert.equal(stats.alignmentId, frozen.alignmentId);
  });
});

test('stats: percentile is nearest-rank (p50 of two values is the lower one)', () => {
  const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(percentile(sorted, 50), 50);
  assert.equal(percentile(sorted, 95), 100);
  assert.equal(percentile([100, 200], 50), 100);
  assert.equal(percentile([100, 200], 95), 200);
  assert.equal(percentile([42], 50), 42);
  assert.equal(percentile([], 95), 0);
});

// ---------------------------------------------------------------------------
// Findings report
// ---------------------------------------------------------------------------

function judgmentEntry(
  runId: string,
  credit: unknown,
  verdict: 'worked' | 'failed',
  escalated: boolean,
  lineData: Record<string, unknown> = { persona: 'rivet', bank: 'banter.pool1', line: 'a line' }
): LedgerEntry {
  return {
    seq: 0,
    ts: new Date().toISOString(),
    cellId: 'c',
    runId,
    alignmentId: 'a',
    debit: JSON.stringify({ prompt: { system: 's', user: 'directive\n\n--- LINE ---\n' + JSON.stringify(lineData) } }),
    credit: JSON.stringify(credit),
    verdict,
    escalated,
    prevHash: '',
    hash: '',
  };
}

test('findings: escalated ≠ QC-failed; retry supersession; judge failures counted separately', () => {
  const lastEntries = new Map<string, LedgerEntry>([
    // runA: error credit (attempt 1) then a passing judgment — superseded, counts as judged pass.
    ['runA', judgmentEntry('runA', { pass: true, scores: { kid_safe: 9, in_voice: 8, fresh: 7 }, worst: 'fresh', reason: 'good' }, 'worked', false)],
    // runB: QC-failed JUDGMENT — judged fail, NOT an escalation.
    ['runB', judgmentEntry('runB', { pass: false, scores: { kid_safe: 4, in_voice: 7, fresh: 6 }, worst: 'kid_safe', reason: 'unsafe' }, 'failed', false, { persona: 'rivet', bank: 'banter.pool2', line: 'risky line' })],
    // runC: gave up — error credit, escalated.
    ['runC', judgmentEntry('runC', { error: 'no JSON object found' }, 'failed', true)],
  ]);

  const report = buildFindingsReport(lastEntries, { ok: true, checked: 3 }, 10);

  assert.ok(report.includes('| Lines Judged | 2 |'));
  assert.ok(report.includes('| Passed | 1 |'));
  assert.ok(report.includes('| Failed | 1 |'));
  assert.ok(report.includes('| Judge Failures | 1 |'));
  // The old report printed `judged - passed` here (=1), which silently mislabeled
  // QC-fails as escalations. The real give-up count is 1 here too — so assert the
  // distinct-cause case below as well.
  assert.ok(report.includes('| Escalations (gave up) | 1 |'));

  // Worst ordering: runB (total 17) before runA (total 24).
  const runBAt = report.indexOf('### runB');
  const runAAt = report.indexOf('### runA');
  assert.ok(runBAt !== -1 && runAAt !== -1 && runBAt < runAAt);

  // runB's kid_safe=4 → REWRITE.
  assert.ok(report.includes('**Action:** `REWRITE`'));
});

test('findings: escalations count is the give-up count, not judged-minus-passed', () => {
  const lastEntries = new Map<string, LedgerEntry>([
    // Two QC-failed JUDGMENTS (not escalated) + zero give-ups: old code reported "2".
    ['runA', judgmentEntry('runA', { pass: false, scores: { kid_safe: 7, in_voice: 8, fresh: 8 }, worst: 'kid_safe', reason: 'low' }, 'failed', false)],
    ['runB', judgmentEntry('runB', { pass: false, scores: { kid_safe: 7, in_voice: 8, fresh: 7 }, worst: 'fresh', reason: 'stale' }, 'failed', false)],
  ]);

  const report = buildFindingsReport(lastEntries, { ok: true, checked: 2 }, 10);
  assert.ok(report.includes('| Lines Judged | 2 |'));
  assert.ok(report.includes('| Failed | 2 |'));
  assert.ok(report.includes('| Escalations (gave up) | 0 |'));
});

test('findings: broken chain is reported without "undefined"', () => {
  const report = buildFindingsReport(new Map(), { ok: false, checked: 2, badSeq: 7, reason: 'hash mismatch' }, 5);
  assert.ok(report.includes('broken at seq 7: hash mismatch'));
  assert.ok(!report.includes('undefined'));
});

test('findings: toJudgment maps line metadata and guards malformed debits', () => {
  const entry = judgmentEntry(
    'runX',
    { pass: true, scores: { kid_safe: 9, in_voice: 8, fresh: 8 }, worst: 'fresh', reason: 'fine' },
    'worked',
    false,
    { persona: 'bolt', bank: 'banter.laugh', tier: 2, trait: 'curious', line: 'nice one' }
  );
  const j = toJudgment(entry);
  assert.ok(j);
  assert.equal(j.persona, 'bolt');
  assert.equal(j.bank, 'banter.laugh');
  assert.equal(j.tier, 2);
  assert.equal(j.trait, 'curious');
  assert.equal(j.text, 'nice one');

  // Malformed debit (no prompt) degrades to unknowns instead of throwing.
  const bare = { ...entry, debit: JSON.stringify({ test: true }) };
  const j2 = toJudgment(bare);
  assert.ok(j2);
  assert.equal(j2.persona, 'unknown');
  assert.equal(j2.text, '(unparseable)');
});

test('findings: recommendation mapping', () => {
  const mk = (kid_safe: number, in_voice: number, fresh: number) => {
    const j = toJudgment(
      judgmentEntry('r', { pass: false, scores: { kid_safe, in_voice, fresh }, worst: 'kid_safe', reason: 'x' }, 'failed', false)
    );
    assert.ok(j);
    return j;
  };
  assert.equal(getRecommendation(mk(4, 9, 9)), 'REWRITE'); // any criterion ≤ 4
  assert.equal(getRecommendation(mk(9, 4, 9)), 'REWRITE');
  assert.equal(getRecommendation(mk(9, 9, 4)), 'REWRITE');
  assert.equal(getRecommendation(mk(5, 9, 9)), 'RETIRE'); // kid_safe ≤ 6
  assert.equal(getRecommendation(mk(7, 7, 5)), 'PUNCH UP'); // fresh ≤ 5
  assert.equal(getRecommendation(mk(7, 7, 6)), 'REVIEW'); // else
});

test('findings: ledger roundtrip feeds the report (end-to-end, no network)', async () => {
  const tmpDir = makeTestTmpDir();
  try {
    const ledgerPath = path.join(tmpDir, 'ledger.jsonl');
    const ledger = new Ledger(ledgerPath);

    fakeEntry(ledger, 'run-1', { pass: true, scores: { kid_safe: 9, in_voice: 8, fresh: 7 }, worst: 'fresh', reason: 'good', latencyMs: 120, attempts: 1 }, 'worked', false);
    fakeEntry(ledger, 'run-2', { pass: false, scores: { kid_safe: 5, in_voice: 7, fresh: 6 }, worst: 'kid_safe', reason: 'unsafe' }, 'failed', false);
    fakeEntry(ledger, 'run-3', { error: 'timeout' }, 'failed', true);

    // Verify chain
    const verify = await ledger.verify();
    assert.equal(verify.ok, true);

    const lastEntries = new Map<string, LedgerEntry>();
    for await (const entry of ledger.stream()) {
      lastEntries.set(entry.runId, entry);
    }

    const report = buildFindingsReport(lastEntries, verify, 15);
    assert.ok(report.includes('| Lines Judged | 2 |'));
    assert.ok(report.includes('| Escalations (gave up) | 1 |'));
    assert.ok(report.includes('✅ hash chain verified'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});
