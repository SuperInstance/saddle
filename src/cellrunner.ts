/**
 * cellrunner.ts — run ONE pinned cell against an adapter, keeping books.
 *
 * This module is a single-cell runner: it thaws the frozen alignment in
 * effect, builds the full prompt context, calls an injected adapter (never a
 * real model), parses the credit, and appends one ledger entry per attempt.
 * Retries chain via retryOf; the final failed attempt escalates.
 *
 * NOTE: this module is a companion to cells.ts (workflows of many cells);
 * cellrunner.ts runs one cell with a frozen alignment pinned explicitly.
 *
 * Critical-path rules honored here:
 *   - no model calls in core (adapter is injected), no subprocess, no deps
 *   - a tampered frozen state throws BEFORE any ledger append
 */

import { thaw } from './frozens.ts';
import { Ledger } from './ledger.ts';
import type { LedgerEntry, Verdict } from './ledger.ts';

/** What a cell sends to whatever actually talks to a model. */
export interface CellRequest {
  model: string;
  prompt: { system: string; user: string };
  params: Record<string, number | string | boolean>;
  input: unknown;
}

/** Transport seam — inject a real client here; core ships only mocks. */
export interface CellAdapter {
  name: string;
  call(request: CellRequest): Promise<{ raw: string; latencyMs: number }> | { raw: string; latencyMs: number };
}

export interface RunCellOptions {
  frozenDir: string;
  alignmentId: string;
  cellId: string;
  runId: string;
  input: unknown;
  /** build the user prompt from the domain input */
  buildUserPrompt: (input: unknown) => string;
  /** parse the adapter's raw output into a credit + verdict; may throw */
  parseCredit: (raw: string) => { credit: unknown; verdict: Verdict };
  ledger: Ledger;
  adapter: CellAdapter;
  /** total attempts (default 2: one try + one retry) */
  maxAttempts?: number;
}

export interface RunCellResult {
  entries: LedgerEntry[];
  final: LedgerEntry;
}

/**
 * Run one cell. Every attempt (success or fail) is one ledger entry; retries
 * chain via retryOf → the immediately previous attempt (walk the links back
 * to find the first). Exhausting maxAttempts appends the final entry with
 * escalated: true and a 'gave up:' note.
 */
export async function runCell(opts: RunCellOptions): Promise<RunCellResult> {
  // thaw (and verify) BEFORE any bookkeeping — a tampered state never runs
  const frozen = thaw(opts.frozenDir, opts.alignmentId);

  const maxAttempts = opts.maxAttempts ?? 2;
  const entries: LedgerEntry[] = [];
  let firstSeq: number | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const debit = {
      prompt: { system: frozen.prompt, user: opts.buildUserPrompt(opts.input) },
      input: opts.input,
      model: frozen.model,
      params: frozen.params,
      adapter: opts.adapter.name,
    };

    let credit: unknown;
    let verdict: Verdict;
    let reason: string | undefined;

    try {
      const response = await opts.adapter.call({
        model: frozen.model,
        prompt: debit.prompt,
        params: frozen.params,
        input: opts.input,
      });
      try {
        const parsed = opts.parseCredit(response.raw);
        credit = parsed.credit;
        verdict = parsed.verdict;
        if (verdict !== 'worked') reason = 'judged failed by parseCredit';
      } catch (e) {
        verdict = 'failed';
        credit = `parse failed: ${(e as Error).message}`;
        reason = (e as Error).message;
      }
    } catch (e) {
      verdict = 'failed';
      credit = `adapter error: ${(e as Error).message}`;
      reason = (e as Error).message;
    }

    const last = attempt === maxAttempts;
    const failed = verdict !== 'worked';
    const entry = opts.ledger.append({
      cellId: opts.cellId,
      runId: opts.runId,
      alignmentId: frozen.alignmentId,
      debit,
      credit,
      verdict,
      escalated: failed && last,
      ...(failed ? { note: last ? `gave up: attempt ${attempt}: ${reason}` : `attempt ${attempt}: ${reason}` } : {}),
      ...(entries.length > 0 ? { retryOf: entries[entries.length - 1]!.seq } : {}),
    });
    if (firstSeq === undefined) firstSeq = entry.seq;
    entries.push(entry);

    if (!failed) break;
  }

  return { entries, final: entries[entries.length - 1]! };
}
