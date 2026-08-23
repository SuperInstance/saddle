/**
 * kennel-program.ts — the kennel program: training-job contracts, NOT execution.
 *
 * How a ranch turns a young dog into a working dog, written as schemas:
 *   treats    = the reward signal, on a schedule (continuous → intermittent;
 *               variable-ratio treats resist extinction)
 *   whistles  = trigger conditioning: a cue, and what the cowboy expects of it
 *   peers     = few-shot demonstrations from the top-aligned dogs in the ledger
 *   breeding  = candidate selection by domain similarity to the ranch
 *   nudging   = the human harness: budgeted per phase, thinning phase over phase
 *
 * Everything here is DATA ONLY: schema contracts, pure validators, and one
 * streaming ledger read. No training loop, no model calls, no I/O beyond the
 * ledger stream. Suggestions are data — the cowboy pulls every lever.
 * Graduation only ever means harness layers may THIN, and never silently
 * (see docs/INVISIBLE-HARNESS.md for the doctrine).
 *
 * Critical-path rules honored here:
 *   - selectPeerDemonstrations streams the ledger ONCE; memory is
 *     O(#alignments + window), never O(corpus)
 *   - no subprocess use, no deps, no model calls
 */

import { Ledger } from './ledger.ts';

// ---------------------------------------------------------------------------
// Ranch & candidate — breeding to a similar ranch = domain-similar selection
// ---------------------------------------------------------------------------

export interface DomainProfile {
  domainId: string;          // 'ranch.support-triage'
  tags: string[];            // what the land+family+livestock are like
  /** dynamic & temporal: the niche moves — profiles must be re-scored, never assumed static */
  temporal: boolean;
}

export interface CandidateSelection {
  candidateId: string;
  lineageId?: string;        // bloodline (base model family)
  domainTags: string[];      // what this candidate is bred toward
  domainSimilarity: number;  // 0..1 score vs the target ranch
  dispositionNotes?: string; // what the candidate arrives already wanting
}

/** the kennel's one spelling rule: lowercase + trim */
const normTag = (t: string): string => t.trim().toLowerCase();

/**
 * Jaccard over normalized tag sets: |ranch ∩ candidate| / |ranch ∪ candidate|.
 * Identical (non-empty) sets → 1; disjoint → 0; both empty → 0 (no shared
 * ground is not similarity). Pure.
 */
export function domainSimilarityScore(ranch: DomainProfile, candidateDomainTags: string[]): number {
  const ranchSet = new Set(ranch.tags.map(normTag));
  const candSet = new Set(candidateDomainTags.map(normTag));
  let intersection = 0;
  for (const t of candSet) {
    if (ranchSet.has(t)) intersection++;
  }
  const union = ranchSet.size + candSet.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Re-score every candidate against the ranch (trusting caller-declared tags —
 * the returned candidates carry the RECOMPUTED score, not the declared one),
 * drop those below minSimilarity, sort descending, ties broken by candidateId
 * ascending so the order is stable. Pure.
 */
export function rankCandidates(
  ranch: DomainProfile,
  candidates: CandidateSelection[],
  minSimilarity: number
): CandidateSelection[] {
  return candidates
    .map((c) => ({ ...c, domainSimilarity: domainSimilarityScore(ranch, c.domainTags) }))
    .filter((c) => c.domainSimilarity >= minSimilarity)
    .sort((a, b) => b.domainSimilarity - a.domainSimilarity || a.candidateId.localeCompare(b.candidateId));
}

// ---------------------------------------------------------------------------
// Curriculum — whistles & treats on a schedule
// ---------------------------------------------------------------------------

/** every response vs variable-ratio (resists extinction) */
export type RewardSchedule = 'continuous' | 'intermittent';

export interface WhistleSpec {
  id: string;
  cue: string;               // the conditioned trigger
  expects: string;           // what the cowboy expects on hearing it
}

export interface RewardSpec {
  id: string;
  on: string;                // condition description ('verdict == worked')
  treat: string;             // what the treat IS ('affirmation: good hold')
  schedule: RewardSchedule;
  weight?: number;           // 0..1, default 1
}

export interface CurriculumPhase {
  phaseId: string;
  order: number;             // strictly increasing from 1 — validated as exactly 1..n in order
  focus: string;
  whistles: WhistleSpec[];
  rewards: RewardSpec[];
  nudgeBudget: number;       // max human nudges allowed this phase; SHOULD decline phase-over-phase (validated)
  exitCriteria: { minKeepRatio: number; minAttempts: number }; // advance when both clear
}

export interface Curriculum {
  phases: CurriculumPhase[];
}

// ---------------------------------------------------------------------------
// Peer demonstrations — few-shot set from top-aligned ledger entries
// ---------------------------------------------------------------------------

export interface PeerDemonstration {
  seq: number;              // ledger seq of the demonstrated entry
  alignmentId: string;      // the demonstrating dog
  cellId: string;
  keepRatio: number;        // that alignment's keep ratio at selection time (snapshot)
}

export interface PeerDemonstrationSet {
  source: 'ledger';         // honest label — only source saddle knows
  minKeepRatio: number;     // only top-aligned dogs demonstrate (>= this)
  maxExamples: number;
  demonstrations: PeerDemonstration[];
}

export interface PeerSelectionOptions {
  minKeepRatio: number;     // recommend >= EARNED_KEEP_THRESHOLD (0.75, src/nightcycle.ts)
  maxExamples: number;      // 1..200
  cellId?: string;          // restrict demonstrations to one cell's yard
}

/** total ledger entries before an alignment may demonstrate — no puppy classes */
const PUPPY_CLASS_FLOOR = 5;

/**
 * Streams the ledger ONCE and assembles the demonstration set. Memory:
 * per-alignment worked/failed counters (O(#alignments)) plus ONE bounded
 * window — the newest maxExamples worked entries (post-cell-filter); the
 * corpus is never held. A demonstration is a 'worked' entry whose
 * alignment's FINAL keepRatio >= minKeepRatio and whose total entries
 * >= PUPPY_CLASS_FLOOR. Results are newest-first, up to maxExamples, each
 * carrying a snapshot of the alignment's final keepRatio.
 */
export async function selectPeerDemonstrations(
  ledgerPath: string,
  opts: PeerSelectionOptions
): Promise<PeerDemonstrationSet> {
  const ledger = new Ledger(ledgerPath);
  const counters = new Map<string, { worked: number; failed: number }>();
  // bounded window: worked entries are buffered newest-last; once the window
  // is full the OLDEST is released. Final ratios are only known after the
  // stream ends, so qualification is judged afterward, on the window's
  // survivors — the memory bound demands the corpus never be held.
  const window: Array<Pick<PeerDemonstration, 'seq' | 'alignmentId' | 'cellId'>> = [];

  for await (const e of ledger.stream()) {
    const c = counters.get(e.alignmentId) ?? { worked: 0, failed: 0 };
    if (e.verdict === 'worked') c.worked++;
    else c.failed++;
    counters.set(e.alignmentId, c);

    if (e.verdict === 'worked' && (opts.cellId === undefined || e.cellId === opts.cellId)) {
      window.push({ seq: e.seq, alignmentId: e.alignmentId, cellId: e.cellId });
      if (window.length > opts.maxExamples) window.shift();
    }
  }

  const finals = new Map<string, { keepRatio: number; total: number }>();
  for (const [id, c] of counters) {
    const total = c.worked + c.failed;
    finals.set(id, { keepRatio: total === 0 ? 0 : c.worked / total, total });
  }

  const demonstrates = (id: string): boolean => {
    const f = finals.get(id);
    return f !== undefined && f.total >= PUPPY_CLASS_FLOOR && f.keepRatio >= opts.minKeepRatio;
  };

  const demonstrations = window
    .filter((d) => demonstrates(d.alignmentId))
    .map((d) => ({ ...d, keepRatio: finals.get(d.alignmentId)!.keepRatio }))
    .sort((a, b) => b.seq - a.seq)
    .slice(0, opts.maxExamples);

  return { source: 'ledger', minKeepRatio: opts.minKeepRatio, maxExamples: opts.maxExamples, demonstrations };
}

// ---------------------------------------------------------------------------
// Graduation — nudge rate under the ceiling means the harness may thin
// ---------------------------------------------------------------------------

export interface GraduationCriteria {
  nudgeRateCeiling: number;   // 0..1 exclusive bounds (0,1): nudges per attempt
  windowSize: number;         // >= 5 attempts per window
  minAttempts: number;        // >= windowSize, statistical floor before any claim
  consecutiveWindows: number; // >= 1 full windows in a row under the ceiling
  thinningOrder: string[];    // harness layers that may come off, in order ('output-filters' → 'rewards' → …)
}

export interface GraduationDecision {
  graduated: boolean;
  nudgeRate: number;          // over the most recent full window (0 if no full window)
  windowsChecked: number;     // full windows evaluated
  windowsBelowCeiling: number;// most recent CONSECUTIVE windows under ceiling (stops counting at first miss going backward)
  reason: string;             // human-readable, honest (insufficient data / stable under ceiling / still needs the harness)
  // data only — saddle never removes harness layers; the cowboy thins
}

/**
 * Pure evaluation of a nudge sample series against graduation criteria.
 * `nudges` are chronological samples (the attempt index may have gaps; array
 * order IS time). Full windows are the LAST floor(n/windowSize) windows —
 * a leading partial window is dropped, never counted. The nudge rate is over
 * the most recent FULL window. windowsBelowCeiling counts consecutive full
 * windows, newest backward, whose rate <= ceiling, stopping at the first
 * miss. graduated = attempts >= minAttempts AND windowsBelowCeiling >=
 * consecutiveWindows. Insufficient data returns graduated:false with an
 * honest reason; never throws, not even on an empty series.
 */
export function evaluateGraduation(
  nudges: ReadonlyArray<{ attempt: number; nudged: boolean }>,
  criteria: GraduationCriteria
): GraduationDecision {
  const n = nudges.length;
  const w = criteria.windowSize;

  if (w < 1 || n < w) {
    return {
      graduated: false,
      nudgeRate: 0,
      windowsChecked: 0,
      windowsBelowCeiling: 0,
      reason: `insufficient data: ${n} sample(s) is less than one full window of ${w}`,
    };
  }

  const fullWindows = Math.floor(n / w);
  const leading = n - fullWindows * w; // the dropped leading partial
  const rates: number[] = [];
  for (let i = 0; i < fullWindows; i++) {
    let hits = 0;
    for (let j = leading + i * w; j < leading + (i + 1) * w; j++) {
      if (nudges[j]!.nudged) hits++;
    }
    rates.push(hits / w);
  }

  const nudgeRate = rates[rates.length - 1]!;
  let windowsBelowCeiling = 0;
  for (let i = rates.length - 1; i >= 0; i--) {
    if (rates[i]! <= criteria.nudgeRateCeiling) windowsBelowCeiling++;
    else break; // the streak stops at the first miss, counting newest backward
  }

  const graduated = n >= criteria.minAttempts && windowsBelowCeiling >= criteria.consecutiveWindows;

  let reason: string;
  if (n < criteria.minAttempts) {
    reason = `insufficient data: ${n} attempts is below the statistical floor of ${criteria.minAttempts}`;
  } else if (graduated) {
    reason = `stable under ceiling: nudge rate ${pct(nudgeRate)} in the latest window, ${windowsBelowCeiling} consecutive window(s) at or under ${pct(criteria.nudgeRateCeiling)} — harness layers may thin (never silently removed)`;
  } else {
    reason = `still needs the harness: nudge rate ${pct(nudgeRate)} in the latest window against a ${pct(criteria.nudgeRateCeiling)} ceiling (${windowsBelowCeiling} consecutive window(s) under)`;
  }

  return { graduated, nudgeRate, windowsChecked: fullWindows, windowsBelowCeiling, reason };
}

// ---------------------------------------------------------------------------
// The whole kennel program for one candidate
// ---------------------------------------------------------------------------

/** honest labels; graduation is CLAIMED by nightcycle data, APPROVED by the cowboy */
export type KennelJobStatus = 'draft' | 'approved' | 'graduated';

export interface KennelTrainingJob {
  jobId: string;
  createdAt: string;          // ISO
  ranch: DomainProfile;
  candidate: CandidateSelection;
  curriculum: Curriculum;
  peers: PeerDemonstrationSet;
  graduation: GraduationCriteria;
  status: KennelJobStatus;
  notes?: string;
}

export interface KennelJobCheck {
  ok: boolean;
  errors: string[];
}

const REWARD_SCHEDULES: ReadonlySet<string> = new Set(['continuous', 'intermittent']);
const KENNEL_JOB_STATUSES: ReadonlySet<string> = new Set(['draft', 'approved', 'graduated']);

/**
 * Pure validation of a whole kennel program. Collects EVERY violation — one
 * error string each — so the cowboy sees the full bill, not the first line.
 */
export function validateKennelJob(job: KennelTrainingJob): KennelJobCheck {
  const errors: string[] = [];

  if (!job.jobId) errors.push('jobId must be non-empty');
  if (!job.ranch.domainId) errors.push('ranch.domainId must be non-empty');
  if (!job.candidate.candidateId) errors.push('candidate.candidateId must be non-empty');

  if (job.ranch.tags.length === 0) errors.push('ranch.tags must be non-empty — say what the land is like');
  const seenTags = new Set<string>();
  for (const t of job.ranch.tags) {
    const k = normTag(t);
    if (seenTags.has(k)) errors.push(`ranch.tags has a duplicate after normalization: '${k}'`);
    seenTags.add(k);
  }

  if (!(job.candidate.domainSimilarity >= 0 && job.candidate.domainSimilarity <= 1)) {
    errors.push(`candidate.domainSimilarity must be in [0,1], got ${job.candidate.domainSimilarity}`);
  }
  if (job.candidate.domainTags.length === 0) errors.push('candidate.domainTags must be non-empty');

  const phases = job.curriculum.phases;
  if (phases.length === 0) errors.push('curriculum.phases must be non-empty');
  let prevBudget: number | undefined;
  phases.forEach((p, i) => {
    if (p.order !== i + 1) {
      errors.push(`phase '${p.phaseId}' (slot ${i}): order must be exactly ${i + 1} (1..n in order as given), got ${p.order}`);
    }

    const whistleIds = new Set<string>();
    for (const w of p.whistles) {
      if (whistleIds.has(w.id)) errors.push(`phase '${p.phaseId}': duplicate whistle id '${w.id}'`);
      whistleIds.add(w.id);
    }

    const rewardIds = new Set<string>();
    for (const r of p.rewards) {
      if (rewardIds.has(r.id)) errors.push(`phase '${p.phaseId}': duplicate reward id '${r.id}'`);
      rewardIds.add(r.id);
      if (!REWARD_SCHEDULES.has(r.schedule)) {
        errors.push(`phase '${p.phaseId}': reward '${r.id}' schedule '${r.schedule}' is not in the vocabulary (continuous | intermittent)`);
      }
      if (r.weight !== undefined && !(r.weight > 0 && r.weight <= 1)) {
        errors.push(`phase '${p.phaseId}': reward '${r.id}' weight must be in (0,1], got ${r.weight}`);
      }
    }

    if (!Number.isInteger(p.nudgeBudget) || p.nudgeBudget < 0) {
      errors.push(`phase '${p.phaseId}': nudgeBudget must be an integer >= 0, got ${p.nudgeBudget}`);
    } else {
      if (prevBudget !== undefined && p.nudgeBudget > prevBudget) {
        errors.push(`phase '${p.phaseId}': nudge budget must not rise (${prevBudget} → ${p.nudgeBudget}) — younger dogs get less nudging, not more`);
      }
      prevBudget = p.nudgeBudget;
    }

    if (!(p.exitCriteria.minKeepRatio >= 0 && p.exitCriteria.minKeepRatio <= 1)) {
      errors.push(`phase '${p.phaseId}': exitCriteria.minKeepRatio must be in [0,1], got ${p.exitCriteria.minKeepRatio}`);
    }
    if (!(p.exitCriteria.minAttempts >= 1)) {
      errors.push(`phase '${p.phaseId}': exitCriteria.minAttempts must be >= 1, got ${p.exitCriteria.minAttempts}`);
    }
  });

  const peers = job.peers;
  if (peers.source !== 'ledger') {
    errors.push(`peers.source must be 'ledger' — the only source saddle knows, got '${peers.source}'`);
  }
  if (!(peers.minKeepRatio >= 0 && peers.minKeepRatio <= 1)) {
    errors.push(`peers.minKeepRatio must be in [0,1], got ${peers.minKeepRatio}`);
  }
  if (!(peers.maxExamples >= 1 && peers.maxExamples <= 200)) {
    errors.push(`peers.maxExamples must be in [1,200], got ${peers.maxExamples}`);
  }
  const seqs = new Set<number>();
  for (const d of peers.demonstrations) {
    if (d.keepRatio < peers.minKeepRatio) {
      errors.push(`peers: demonstration seq ${d.seq} (alignment '${d.alignmentId}') keepRatio ${d.keepRatio} is below the minKeepRatio bar ${peers.minKeepRatio} — a lying label`);
    }
    if (seqs.has(d.seq)) errors.push(`peers: duplicate demonstration seq ${d.seq}`);
    seqs.add(d.seq);
  }

  const g = job.graduation;
  if (!(g.nudgeRateCeiling > 0 && g.nudgeRateCeiling < 1)) {
    errors.push(`graduation.nudgeRateCeiling must be in (0,1) exclusive, got ${g.nudgeRateCeiling}`);
  }
  if (!(g.windowSize >= 5)) errors.push(`graduation.windowSize must be >= 5, got ${g.windowSize}`);
  if (!(g.minAttempts >= g.windowSize)) {
    errors.push(`graduation.minAttempts must be >= windowSize (${g.windowSize}), got ${g.minAttempts}`);
  }
  if (!(g.consecutiveWindows >= 1)) {
    errors.push(`graduation.consecutiveWindows must be >= 1, got ${g.consecutiveWindows}`);
  }
  if (g.thinningOrder.length === 0) errors.push('graduation.thinningOrder must be non-empty — layers come off in a named order or not at all');
  const layers = new Set<string>();
  for (const layer of g.thinningOrder) {
    if (layers.has(layer)) errors.push(`graduation.thinningOrder has duplicate layer '${layer}'`);
    layers.add(layer);
  }

  if (!KENNEL_JOB_STATUSES.has(job.status)) {
    errors.push(`status '${job.status}' is not in the vocabulary (draft | approved | graduated)`);
  }
  if (Number.isNaN(Date.parse(job.createdAt))) {
    errors.push(`createdAt '${job.createdAt}' does not parse as a Date`);
  }

  return { ok: errors.length === 0, errors };
}

const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
