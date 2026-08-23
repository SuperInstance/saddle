import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  domainSimilarityScore,
  rankCandidates,
  selectPeerDemonstrations,
  evaluateGraduation,
  validateKennelJob,
} from '../src/kennel-program.ts';
import type {
  CandidateSelection,
  DomainProfile,
  GraduationCriteria,
  KennelTrainingJob,
  RewardSchedule,
} from '../src/kennel-program.ts';
import { Ledger } from '../src/ledger.ts';

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const ranch = (tags: string[]): DomainProfile => ({ domainId: 'ranch.support-triage', tags, temporal: true });

const cand = (candidateId: string, domainTags: string[], declaredScore = 0.5): CandidateSelection => ({
  candidateId,
  domainTags,
  domainSimilarity: declaredScore,
});

const criteria: GraduationCriteria = {
  nudgeRateCeiling: 0.2,
  windowSize: 5,
  minAttempts: 10,
  consecutiveWindows: 2,
  thinningOrder: ['output-filters', 'rewards'],
};

const samples = (...nudged: boolean[]): Array<{ attempt: number; nudged: boolean }> =>
  nudged.map((n, i) => ({ attempt: i + 1, nudged: n }));

/**
 * Kennel ledger fixture (seq order matters — newest last):
 *   BAD  1 worked / 5 failed → final keepRatio 1/6, excluded by the bar
 *   PUP  3 worked → under the 5-entry puppy-class floor, excluded
 *   TOP  6 worked / 2 failed → final keepRatio exactly 0.75, demonstrates
 * TOP worked seqs: 5, 6, 7, 8 (yard-a), 16 (yard-a), 17 (yard-b).
 */
function buildKennelLedger(): { file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saddle-kennel-'));
  const file = path.join(dir, 'ledger.jsonl');
  const ledger = new Ledger(file);
  const add = (alignmentId: string, cellId: string, verdict: 'worked' | 'failed') =>
    ledger.append({ cellId, runId: 'r', alignmentId, debit: {}, credit: {}, verdict, escalated: false });

  add('BAD', 'cell.yard-a', 'worked'); // a worked entry whose alignment's final ratio dooms it
  for (let i = 0; i < 3; i++) add('PUP', 'cell.yard-b', 'worked');
  for (let i = 0; i < 4; i++) add('TOP', 'cell.yard-a', 'worked');
  add('TOP', 'cell.yard-a', 'failed');
  add('TOP', 'cell.yard-b', 'failed');
  for (let i = 0; i < 5; i++) add('BAD', 'cell.yard-b', 'failed');
  add('TOP', 'cell.yard-a', 'worked'); // seq 16
  add('TOP', 'cell.yard-b', 'worked'); // seq 17
  return { file };
}

function validJob(): KennelTrainingJob {
  return {
    jobId: 'kennel.job-1',
    createdAt: '2026-08-23T00:00:00.000Z',
    ranch: { domainId: 'ranch.support-triage', tags: ['support', 'triage', 'email'], temporal: true },
    candidate: {
      candidateId: 'dog.rita',
      lineageId: 'herding.line',
      domainTags: ['support', 'TRIAGE'],
      domainSimilarity: 0.5,
      dispositionNotes: 'arrives already wanting to please',
    },
    curriculum: {
      phases: [
        {
          phaseId: 'basics',
          order: 1,
          focus: 'hold',
          whistles: [{ id: 'w1', cue: 'sit', expects: 'a steady hold' }],
          rewards: [{ id: 'r1', on: 'verdict == worked', treat: 'affirmation: good hold', schedule: 'continuous', weight: 1 }],
          nudgeBudget: 10,
          exitCriteria: { minKeepRatio: 0.75, minAttempts: 5 },
        },
        {
          phaseId: 'distance',
          order: 2,
          focus: 'distance hold',
          whistles: [{ id: 'w2', cue: 'stay', expects: 'hold at distance' }],
          rewards: [{ id: 'r2', on: 'verdict == worked', treat: 'affirmation: good stay', schedule: 'intermittent', weight: 0.5 }],
          nudgeBudget: 5,
          exitCriteria: { minKeepRatio: 0.8, minAttempts: 8 },
        },
      ],
    },
    peers: {
      source: 'ledger',
      minKeepRatio: 0.75,
      maxExamples: 10,
      demonstrations: [{ seq: 17, alignmentId: 'TOP', cellId: 'cell.yard-b', keepRatio: 0.75 }],
    },
    graduation: { ...criteria, thinningOrder: [...criteria.thinningOrder] }, // deep enough: mutation rows must not leak across jobs
    status: 'draft',
    notes: 'program per the seed',
  };
}

// ---------------------------------------------------------------------------
// domain similarity & ranking
// ---------------------------------------------------------------------------

test('domainSimilarityScore: Jaccard over normalized tag sets', () => {
  const r = ranch(['Herding', 'Livestock', 'Family']);
  assert.equal(domainSimilarityScore(r, ['herding ', 'LIVESTOCK', ' family']), 1); // identical after lowercase+trim
  assert.equal(domainSimilarityScore(r, ['Agility', 'Flyball']), 0); // disjoint
  assert.equal(domainSimilarityScore(ranch(['a', 'b', 'c']), ['b', 'c', 'd']), 0.5); // {b,c} / {a,b,c,d}, hand-computed
  assert.equal(domainSimilarityScore(ranch([]), []), 0); // no shared ground is not similarity
});

test('rankCandidates: re-scores, filters below the bar, sorts desc with stable id tie-break', () => {
  const r = ranch(['a', 'b', 'c']);
  const ranked = rankCandidates(
    r,
    [
      cand('c-late', ['a', 'b', 'd']), // 0.5 — ties with c-early, id breaks it
      cand('c-best', ['c', 'b', 'a'], 0), // declared 0, recomputed to 1 — declared scores are not trusted
      cand('c-mid', ['b', 'c']), // 2/3
      cand('c-zero', ['x', 'y', 'z']), // 0 — filtered out
      cand('c-early', ['d', 'a', 'b']), // 0.5
    ],
    0.5
  );
  assert.deepEqual(
    ranked.map((c) => c.candidateId),
    ['c-best', 'c-mid', 'c-early', 'c-late']
  );
  assert.equal(ranked[0]?.domainSimilarity, 1); // the RE-scored value, not the declared 0
});

// ---------------------------------------------------------------------------
// peer demonstrations
// ---------------------------------------------------------------------------

test('selectPeerDemonstrations: only top-aligned, proven dogs demonstrate', async () => {
  const { file } = buildKennelLedger();
  const set = await selectPeerDemonstrations(file, { minKeepRatio: 0.75, maxExamples: 10 });

  assert.equal(set.source, 'ledger');
  assert.equal(set.demonstrations.length, 6); // TOP's six worked entries; BAD (ratio) and PUP (floor) never show
  assert.ok(set.demonstrations.every((d) => d.alignmentId === 'TOP'));
  assert.ok(set.demonstrations.every((d) => d.keepRatio === 0.75)); // snapshot of TOP's FINAL ratio (6/8)
  assert.deepEqual(
    set.demonstrations.map((d) => d.seq),
    [17, 16, 8, 7, 6, 5] // newest-first
  );
});

test('selectPeerDemonstrations: maxExamples keeps the NEWEST demonstrations', async () => {
  const { file } = buildKennelLedger();
  const set = await selectPeerDemonstrations(file, { minKeepRatio: 0.75, maxExamples: 2 });
  assert.deepEqual(
    set.demonstrations.map((d) => d.seq),
    [17, 16]
  );
  assert.equal(set.maxExamples, 2);
});

test('selectPeerDemonstrations: cellId restricts demonstrations to one yard', async () => {
  const { file } = buildKennelLedger();
  const set = await selectPeerDemonstrations(file, { minKeepRatio: 0.75, maxExamples: 10, cellId: 'cell.yard-a' });
  assert.ok(set.demonstrations.length > 0);
  assert.ok(set.demonstrations.every((d) => d.cellId === 'cell.yard-a'));
  // BAD's worked seq-1 entry is in yard-a but stays excluded by its final ratio
  assert.deepEqual(
    set.demonstrations.map((d) => d.seq),
    [16, 8, 7, 6, 5]
  );
  // the yard filter narrows entries, not the books — keepRatio is still the alignment's ledger-wide final
  assert.ok(set.demonstrations.every((d) => d.keepRatio === 0.75));
});

test('selectPeerDemonstrations: empty ledger → an honest empty set', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saddle-kennel-'));
  const set = await selectPeerDemonstrations(path.join(dir, 'no-such-ledger.jsonl'), {
    minKeepRatio: 0.8,
    maxExamples: 7,
  });
  assert.deepEqual(set, { source: 'ledger', minKeepRatio: 0.8, maxExamples: 7, demonstrations: [] });
});

// ---------------------------------------------------------------------------
// graduation
// ---------------------------------------------------------------------------

test('evaluateGraduation: fewer samples than one window → insufficient data, honestly', () => {
  const d = evaluateGraduation(samples(false, false, false, false), criteria);
  assert.equal(d.graduated, false);
  assert.equal(d.nudgeRate, 0);
  assert.equal(d.windowsChecked, 0);
  assert.equal(d.windowsBelowCeiling, 0);
  assert.match(d.reason, /insufficient data/);
});

test('evaluateGraduation: two consecutive windows at or under the ceiling graduate', () => {
  const d = evaluateGraduation(
    samples(
      false, false, true, false, false, // 1/5 = 0.2, exactly at the ceiling — counts as under
      false, false, false, false, false // 0/5
    ),
    criteria
  );
  assert.equal(d.graduated, true);
  assert.equal(d.windowsChecked, 2);
  assert.equal(d.windowsBelowCeiling, 2);
  assert.equal(d.nudgeRate, 0); // over the most recent full window
  assert.match(d.reason, /stable under ceiling/);
});

test('evaluateGraduation: recent window over the ceiling → streak counted honestly, not graduated', () => {
  // newest window over, older windows under: the streak stops at the first miss going backward
  const d0 = evaluateGraduation(
    samples(
      false, false, false, false, false,
      false, false, false, false, false,
      true, true, false, false, false // 2/5 = 0.4 — over
    ),
    criteria
  );
  assert.equal(d0.graduated, false);
  assert.equal(d0.windowsChecked, 3);
  assert.equal(d0.nudgeRate, 0.4);
  assert.equal(d0.windowsBelowCeiling, 0);
  assert.match(d0.reason, /still needs the harness/);

  // newest window under, the one before it over: the streak honestly counts 1
  const d1 = evaluateGraduation(
    samples(
      true, true, true, false, false, // 0.6 — over
      false, false, false, false, false // 0 — under
    ),
    criteria
  );
  assert.equal(d1.graduated, false); // 1 consecutive < required 2
  assert.equal(d1.windowsChecked, 2);
  assert.equal(d1.windowsBelowCeiling, 1);
  assert.equal(d1.nudgeRate, 0);
});

test('evaluateGraduation: a leading partial window is dropped (13 samples, window 5 → 2 full windows)', () => {
  const d = evaluateGraduation(
    samples(
      true, true, true, // the dropped leading partial — would sink the rate if counted
      false, false, false, false, false,
      false, false, false, false, false
    ),
    criteria
  );
  assert.equal(d.windowsChecked, 2);
  assert.equal(d.nudgeRate, 0);
  assert.equal(d.windowsBelowCeiling, 2);
  assert.equal(d.graduated, true);
});

test('evaluateGraduation: an empty series never throws', () => {
  const d = evaluateGraduation([], criteria);
  assert.equal(d.graduated, false);
  assert.equal(d.windowsChecked, 0);
  assert.match(d.reason, /insufficient data/);
});

// ---------------------------------------------------------------------------
// whole-job validation
// ---------------------------------------------------------------------------

test('validateKennelJob: a fully-valid kennel program passes clean', () => {
  const check = validateKennelJob(validJob());
  assert.deepEqual(check, { ok: true, errors: [] });
});

test('validateKennelJob: each violation is one honest error', () => {
  const failures: Array<[label: string, mutate: (job: KennelTrainingJob) => void, marker: RegExp]> = [
    ['rising nudge budget', (j) => { j.curriculum.phases[1]!.nudgeBudget = 20; }, /nudge budget must not rise/],
    ['demo below the peer bar', (j) => { j.peers.demonstrations[0]!.keepRatio = 0.6; }, /below the minKeepRatio bar/],
    ['ceiling of 0', (j) => { j.graduation.nudgeRateCeiling = 0; }, /nudgeRateCeiling must be in \(0,1\) exclusive/],
    ['ceiling of 1', (j) => { j.graduation.nudgeRateCeiling = 1; }, /nudgeRateCeiling must be in \(0,1\) exclusive/],
    ['minAttempts below windowSize', (j) => { j.graduation.minAttempts = 4; }, /minAttempts must be >= windowSize/],
    ['duplicate whistle id in a phase', (j) => { j.curriculum.phases[0]!.whistles.push({ id: 'w1', cue: 'come', expects: 'recall' }); }, /duplicate whistle id/],
    ['bad status', (j) => { j.status = 'pending' as unknown as KennelTrainingJob['status']; }, /status 'pending' is not in the vocabulary/],
    ['unparseable createdAt', (j) => { j.createdAt = 'the other day'; }, /does not parse as a Date/],
    ['empty thinningOrder', (j) => { j.graduation.thinningOrder = []; }, /thinningOrder must be non-empty/],
    ['order not exactly 1..n', (j) => { j.curriculum.phases[1]!.order = 3; }, /order must be exactly 2/],
    ['duplicate ranch tag after normalization', (j) => { j.ranch.tags = ['Support', ' support ']; }, /duplicate after normalization/],
    ['reward weight of 0', (j) => { j.curriculum.phases[0]!.rewards[0]!.weight = 0; }, /weight must be in \(0,1\]/],
    ['schedule outside the vocabulary', (j) => { j.curriculum.phases[0]!.rewards[0]!.schedule = 'sometimes' as unknown as RewardSchedule; }, /schedule 'sometimes' is not in the vocabulary/],
    ['empty phases', (j) => { j.curriculum.phases = []; }, /phases must be non-empty/],
    ['maxExamples out of range', (j) => { j.peers.maxExamples = 0; }, /maxExamples must be in \[1,200\]/],
    ['domainSimilarity out of range', (j) => { j.candidate.domainSimilarity = 1.5; }, /domainSimilarity must be in \[0,1\]/],
    ['duplicate reward id in a phase', (j) => { j.curriculum.phases[0]!.rewards.push({ id: 'r1', on: 'always', treat: 'praise', schedule: 'continuous' }); }, /duplicate reward id/],
    ['windowSize below 5', (j) => { j.graduation.windowSize = 3; }, /windowSize must be >= 5/],
    ['consecutiveWindows below 1', (j) => { j.graduation.consecutiveWindows = 0; }, /consecutiveWindows must be >= 1/],
    ['duplicate thinning layer', (j) => { j.graduation.thinningOrder = ['output-filters', 'output-filters']; }, /duplicate layer/],
    ['empty ranch tags', (j) => { j.ranch.tags = []; }, /ranch\.tags must be non-empty/],
    ['duplicate demonstration seq', (j) => { j.peers.demonstrations.push({ ...j.peers.demonstrations[0]! }); }, /duplicate demonstration seq/],
  ];
  for (const [label, mutate, marker] of failures) {
    const job = validJob();
    mutate(job);
    const check = validateKennelJob(job);
    assert.equal(check.ok, false, label);
    assert.ok(check.errors.some((e) => marker.test(e)), `${label} — errors: ${check.errors.join('; ')}`);
  }
});

test('validateKennelJob: collects ALL violations, not just the first', () => {
  const job = validJob();
  job.jobId = '';
  job.curriculum.phases[1]!.nudgeBudget = 99;
  job.peers.maxExamples = 500;
  const check = validateKennelJob(job);
  assert.equal(check.ok, false);
  assert.equal(check.errors.length, 3);
  assert.ok(check.errors.some((e) => /jobId must be non-empty/.test(e)));
  assert.ok(check.errors.some((e) => /nudge budget must not rise/.test(e)));
  assert.ok(check.errors.some((e) => /maxExamples must be in \[1,200\]/.test(e)));
});

// ---------------------------------------------------------------------------
// export sanity
// ---------------------------------------------------------------------------

test('kennel-program exports resolve under NodeNext with .ts-extension imports', () => {
  assert.equal(typeof domainSimilarityScore, 'function');
  assert.equal(typeof rankCandidates, 'function');
  assert.equal(typeof selectPeerDemonstrations, 'function');
  assert.equal(typeof evaluateGraduation, 'function');
  assert.equal(typeof validateKennelJob, 'function');
});
