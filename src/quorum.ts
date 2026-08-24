/**
 * quorum.ts — many judges, one verdict: cross-check a cell with N frozen
 * alignments and let a strict majority rule.
 *
 * Field trial 1 ran one judge and got one opinion — a 90.3% pass rate is one
 * model's reading, not a fact. The quorum runner fans the SAME input out to
 * N frozen judge alignments (one adapter, N thawed states), counts votes
 * over JUDGMENTS only, and appends exactly ONE summary entry so the books
 * show what the panel concluded, not just what each judge said.
 *
 * Voting rules (why they are what they are):
 *   - a judge that produced a judgment votes: 'worked' or 'judgment-fail'.
 *     A judgment-fail is a real vote — the judge DID its job; what failed
 *     is the subject line, not the judge.
 *   - execution-error/escalated judges cast NO vote: an absent judge is not
 *     a no-vote, it is an absence. Counting absences as votes would let a
 *     dead adapter pass lines by failing loudly.
 *   - majority is strict over ALL seats (votes > judges.length / 2), not
 *     over votes cast — otherwise a 1-0 vote among three judges (two dead)
 *     would rule. No strict majority → 'hung', the summary entry escalates
 *     (verdictKind 'escalated', escalated: true) so the cowboy must look.
 *   - dissent records judges whose VOTE differs from the majority. A hung
 *     panel has no majority to dissent from, so dissent is empty there —
 *     the votes themselves are the story.
 *
 * Critical-path rules honored here: no model calls in core (adapter
 * injected), no subprocess, no deps. Judges fan out concurrently over the
 * shared ledger — safe because each runCell append is one synchronous
 * tail-read+append block on the single-threaded event loop.
 */

import { runCell } from './cellrunner.ts';
import type { CellAdapter } from './cellrunner.ts';
import { thaw } from './frozens.ts';
import type { FrozenState } from './frozens.ts';
import { resolveVerdictKind } from './ledger.ts';
import type { Ledger, LedgerEntry, Verdict, VerdictKind } from './ledger.ts';
import { GrantLedger } from './grants.ts';
import { hashValue } from './hash.ts';

/** One seat at the table: a frozen judge alignment and its display label ('j1', ...). */
export interface QuorumJudgeSpec {
  alignmentId: string;
  label: string;
}

export type QuorumMajority = 'worked' | 'judgment-fail' | 'hung';

export interface QuorumVotes {
  worked: number;
  'judgment-fail': number;
  /** execution-error / escalated judges — no judgment produced, no vote cast */
  noJudgment: number;
}

/** One judge's final state, as it went into the books. */
export interface QuorumJudgeOutcome {
  label: string;
  alignmentId: string;
  finalVerdictKind: VerdictKind;
  /** the vote this judge cast ('worked'/'judgment-fail') or null = no judgment */
  vote: 'worked' | 'judgment-fail' | null;
  entries: LedgerEntry[];
  final: LedgerEntry;
}

export interface QuorumDissent {
  judge: string;
  alignmentId: string;
  verdict: 'worked' | 'judgment-fail';
}

export interface QuorumResult {
  cellId: string;
  runId: string;
  majority: QuorumMajority;
  votes: QuorumVotes;
  judges: QuorumJudgeOutcome[];
  /** judges whose vote differs from the majority (empty when hung) */
  dissent: QuorumDissent[];
  summary: LedgerEntry;
}

export interface RunQuorumCellOptions {
  frozenDir: string;
  /** N frozen judge alignments, N >= 1 */
  judges: QuorumJudgeSpec[];
  /** the quorum cell, e.g. 'ft2/banter-qc-quorum' */
  cellId: string;
  runId: string;
  input: unknown;
  buildUserPrompt: (input: unknown, frozen: FrozenState) => string;
  parseCredit: (raw: string, frozen: FrozenState) => { credit: unknown; verdict: Verdict };
  ledger: Ledger;
  /** SAME adapter for all judges — the frozen state is what varies */
  adapter: CellAdapter;
  maxAttempts?: number;
  /** v4: monotonic permission policy folded by each judge at load (SEAM-REPORT
   *  §1.7). A loosening judge throws BEFORE any fan-out/append. */
  policy?: GrantLedger;
}

/**
 * Content-address the panel itself: the summary entry's alignmentId is the
 * hash of the judge set, so "what exactly was the dog wearing" has an answer
 * for a quorum too — and the summary never pollutes any single judge
 * alignment's earned-keep stats.
 */
function quorumAlignmentId(judges: QuorumJudgeSpec[]): string {
  return 'quorum:' + hashValue(judges.map((j) => [j.label, j.alignmentId]));
}

/**
 * Run the panel. Judge k's entries land under `${cellId}/j${k}` (same runId —
 * cellId disambiguates), then ONE summary entry under the quorum cellId.
 */
export async function runQuorumCell(opts: RunQuorumCellOptions): Promise<QuorumResult> {
  if (opts.judges.length === 0) throw new Error('runQuorumCell: at least one judge is required');

  // thaw every judge up front — a tampered state must throw BEFORE any
  // ledger append, not halfway through the panel
  const frozens = opts.judges.map((j) => thaw(opts.frozenDir, j.alignmentId));

  // SEAM-REPORT §1.7: fold each judge's declared grants into the (possibly
  // caller-owned) policy BEFORE the fan-out — a loosening judge throws before
  // ANY judge's first ledger entry. Re-folding below is idempotent by design.
  let policy = opts.policy;
  frozens.forEach((f) => {
    if (f.grants === undefined) return;
    if (policy === undefined) {
      // caller passed no policy: seed from the first judge that declares grants
      policy = new GrantLedger(f.grants);
    } else {
      policy.tightenFor(f.grants);
    }
  });

  const outcomes: QuorumJudgeOutcome[] = await Promise.all(
    opts.judges.map(async (judge, i) => {
      const frozen = frozens[i]!;
      const k = i + 1;
      const result = await runCell({
        frozenDir: opts.frozenDir,
        alignmentId: judge.alignmentId,
        cellId: `${opts.cellId}/j${k}`,
        runId: opts.runId,
        input: opts.input,
        buildUserPrompt: (input) => opts.buildUserPrompt(input, frozen),
        parseCredit: (raw) => opts.parseCredit(raw, frozen),
        ledger: opts.ledger,
        adapter: opts.adapter,
        maxAttempts: opts.maxAttempts,
        ...(policy ? { grants: policy } : {}),
      });
      const kind = resolveVerdictKind(result.final);
      const vote: QuorumJudgeOutcome['vote'] =
        kind === 'worked' || kind === 'judgment-fail' ? kind : null;
      return {
        label: judge.label,
        alignmentId: judge.alignmentId,
        finalVerdictKind: kind,
        vote,
        entries: result.entries,
        final: result.final,
      };
    })
  );

  const votes: QuorumVotes = {
    worked: outcomes.filter((o) => o.vote === 'worked').length,
    'judgment-fail': outcomes.filter((o) => o.vote === 'judgment-fail').length,
    noJudgment: outcomes.filter((o) => o.vote === null).length,
  };

  // strict majority over ALL seats: votes > N/2
  const seats = outcomes.length;
  let majority: QuorumMajority;
  if (votes.worked > seats / 2) majority = 'worked';
  else if (votes['judgment-fail'] > seats / 2) majority = 'judgment-fail';
  else majority = 'hung';

  const dissent: QuorumDissent[] =
    majority === 'hung'
      ? [] // no majority position exists to dissent from
      : outcomes
          .filter((o) => o.vote !== null && o.vote !== majority)
          .map((o) => ({ judge: o.label, alignmentId: o.alignmentId, verdict: o.vote! }));

  const summaryCredit = {
    majority,
    votes,
    dissent,
    judges: outcomes.map((o) => ({ label: o.label, alignmentId: o.alignmentId, finalVerdictKind: o.finalVerdictKind })),
  };

  const hung = majority === 'hung';
  const summary = opts.ledger.append({
    cellId: opts.cellId,
    runId: opts.runId,
    alignmentId: quorumAlignmentId(opts.judges),
    debit: { input: opts.input, judges: opts.judges, panel: true },
    credit: summaryCredit,
    verdict: majority === 'worked' ? 'worked' : 'failed',
    verdictKind: majority === 'hung' ? 'escalated' : majority,
    escalated: majority === 'hung',
    ...(majority === 'hung'
      ? {
          note: `hung jury: no strict majority (${votes.worked} worked / ${votes['judgment-fail']} failed / ${votes.noJudgment} no judgment) — the cowboy must look`,
        }
      : {}),
  });

  return { cellId: opts.cellId, runId: opts.runId, majority, votes, judges: outcomes, dissent, summary };
}
