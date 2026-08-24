/**
 * canonical.ts — the v4 canonical-value seam (SEAM-REPORT §1.1).
 *
 * ONE frozen canonical result per cell execution; every view is a pure
 * projection of it. The ledger line is the persisted canonical value; this
 * module is the SINGLE place that derives the typed CanonicalResult from a
 * line. Views (cards, one-liners) are pure functions of a CanonicalResult —
 * no I/O, no clock, no session state — so any view can be re-derived from
 * the log forever, with zero re-execution.
 *
 * Purity contract (what makes replay trustworthy): canonicalResultOf,
 * projectCard, and projectLine never touch I/O, never read the clock, never
 * consult session state, and never mutate their input. Replaying a ledger
 * re-derives identical views with zero re-execution — the "model-visible
 * means logged" invariant.
 */

import type { LedgerEntry, OutcomeFact, Verdict, VerdictKind } from './ledger.ts';
import { resolveVerdictKind, Ledger } from './ledger.ts';
import type { Usage } from './cellrunner.ts';

export interface CanonicalResult {
  seq: number;
  ts: string;
  cellId: string;
  runId: string;
  alignmentId: string;
  /** attempt number, from credit.attempts when cellrunner stamped it */
  attempt?: number;
  verdict: Verdict;
  /** resolved kind — legacy lines classified via resolveVerdictKind */
  verdictKind: VerdictKind;
  escalated: boolean;
  /** v4 orthogonal process facts, when stamped (SEAM-REPORT §1.4) */
  outcome?: OutcomeFact;
  /** parsed credit value; null when the credit string is not valid JSON */
  credit: unknown;
  /** token accounting stamped by cellrunner, when present on the credit */
  usage?: Usage;
  /** round-trip latency stamped by cellrunner, when present */
  latencyMs?: number;
  /** error text, when the credit carries one (execution-error family) */
  error?: string;
  note?: string;
  retryOf?: number;
}

/**
 * Derive the ONE canonical projection of a ledger entry. Pure — never throws,
 * never mutates the entry. Credit is parsed defensively (null on unparseable);
 * attempt/usage/latencyMs/error are lifted off the parsed credit ONLY when it
 * is a plain object (not array). Outcome/note/retryOf copy through when present.
 */
export function canonicalResultOf(entry: LedgerEntry): CanonicalResult {
  let credit: unknown = null;
  try {
    credit = JSON.parse(entry.credit);
  } catch {
    credit = null;
  }

  const isObj = credit !== null && typeof credit === 'object' && !Array.isArray(credit);
  const c = (isObj ? credit : {}) as Record<string, unknown>;

  const usage = readUsage(c.usage);
  const attempt = typeof c.attempts === 'number' && Number.isFinite(c.attempts) ? c.attempts : undefined;
  const latencyMs = typeof c.latencyMs === 'number' && Number.isFinite(c.latencyMs) ? c.latencyMs : undefined;
  const error = typeof c.error === 'string' ? c.error : undefined;

  const result: CanonicalResult = {
    seq: entry.seq,
    ts: entry.ts,
    cellId: entry.cellId,
    runId: entry.runId,
    alignmentId: entry.alignmentId,
    verdict: entry.verdict,
    verdictKind: entry.verdictKind ?? resolveVerdictKind(entry),
    escalated: entry.escalated,
    credit,
  };
  if (attempt !== undefined) result.attempt = attempt;
  if (usage) result.usage = usage;
  if (latencyMs !== undefined) result.latencyMs = latencyMs;
  if (error !== undefined) result.error = error;
  if (entry.outcome !== undefined) result.outcome = entry.outcome;
  if (entry.note !== undefined) result.note = entry.note;
  if (entry.retryOf !== undefined) result.retryOf = entry.retryOf;
  return result;
}

/** Lift a Usage off an ALREADY-parsed `usage` value (pure). null when absent. */
function readUsage(raw: unknown): Usage | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const u = raw as Record<string, unknown>;
  if (u.promptTokens === undefined && u.completionTokens === undefined && u.totalTokens === undefined) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    promptTokens: num(u.promptTokens),
    completionTokens: num(u.completionTokens),
    totalTokens: num(u.totalTokens),
    estimated: u.estimated === true,
  };
}

export interface LedgerCard {
  /** stable machine-readable flags: verdictKind, then 'escalated', then outcome facts */
  flags: string[];
  /** e.g. "seq 12 · qc · judgment-fail" */
  headline: string;
  /** facts line: alignment prefix, attempt, latency, tokens (+ " (est)"), outcome facts */
  detail: string;
}

const OUTCOME_ORDER: Array<keyof OutcomeFact> = ['timedOut', 'signal', 'exitCode'];

function outcomeFacts(c: CanonicalResult): string[] {
  if (!c.outcome) return [];
  const parts: string[] = [];
  for (const k of OUTCOME_ORDER) {
    const v = c.outcome[k];
    if (v === true) parts.push(k === 'signal' || k === 'exitCode' ? `${k}:${v}` : k);
    else if (typeof v === 'number') parts.push(`${k}:${v}`);
  }
  return parts;
}

/** Pure projection: a machine-and-human-readable card. No I/O, no clock. */
export function projectCard(c: CanonicalResult): LedgerCard {
  const flags: string[] = [c.verdictKind];
  if (c.escalated) flags.push('escalated');
  for (const k of OUTCOME_ORDER) if (c.outcome?.[k] !== undefined) flags.push(k);

  const cellTag = c.cellId.includes('/') ? c.cellId.slice(c.cellId.lastIndexOf('/') + 1) : c.cellId;
  const headline = `seq ${c.seq} · ${cellTag} · ${c.verdictKind}`;

  const detailBits: string[] = [`align ${c.alignmentId.slice(0, 8)}`];
  if (c.attempt !== undefined) detailBits.push(`attempt ${c.attempt}`);
  if (c.latencyMs !== undefined) detailBits.push(`${c.latencyMs}ms`);
  if (c.usage) {
    const est = c.usage.estimated ? ' (est)' : '';
    detailBits.push(`${c.usage.totalTokens} tok${est}`);
  }
  for (const f of outcomeFacts(c)) detailBits.push(f);

  const detail = detailBits.join(' · ');
  return { flags, headline, detail };
}

/** Pure projection: one terminal line. No I/O, no clock. */
export function projectLine(c: CanonicalResult): string {
  const card = projectCard(c);
  let line = `[${card.headline}] ${card.detail}`;
  if (c.error !== undefined) line += ` — error: ${c.error.slice(0, 80)}`;
  return line;
}

/**
 * Stream a ledger (path or Ledger) and yield canonical results — views
 * re-derived from the log alone, zero re-execution. O(chunk) memory.
 */
export async function* replayCanonical(source: string | Ledger): AsyncGenerator<CanonicalResult> {
  const ledger = typeof source === 'string' ? new Ledger(source) : source;
  for await (const entry of ledger.stream()) {
    yield canonicalResultOf(entry);
  }
}
