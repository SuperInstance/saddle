/**
 * cellrunner.ts — the roundup loop's middle, made real.
 *
 * Runs one inference (with retries) and logs to the ledger, without ever calling
 * a model directly — the adapter is injected. Double-entry bookkeeping on every
 * attempt: debit (full prompt + input + model), credit (output), verdict.
 *
 * Attempt outcomes come in exactly two classes:
 *
 *   judgment — parseCredit succeeded. The credit is a real judgment (scores,
 *     reason, ...). Its verdict — 'worked' OR 'failed' — is FINAL: a QC-fail
 *     is a completed judgment, not a give-up. Never retried, never escalated.
 *
 *   error — the adapter call threw (transport) or parseCredit threw
 *     (unparseable output). The credit is `{ error }`. Retried until
 *     maxAttempts; the last attempt is marked escalated (the cell gave up).
 */

import { Ledger, type Verdict, type LedgerEntry } from './ledger.ts';
import type { FrozenState } from './frozens.ts';
import { thaw } from './frozens.ts';

export interface CellAdapter {
  name: string;
  call(input: CellCallInput): Promise<CellCallOutput>;
}

export interface CellCallInput {
  systemPrompt: string;
  userPrompt: string;
  params: Record<string, number | string | boolean>;
}

export interface CellCallOutput {
  raw: string;
  latencyMs: number;
  meta?: Record<string, unknown>;
}

export interface RunCellOptions {
  frozenDir: string;
  alignmentId: string;
  cellId: string;
  runId: string;
  input: unknown;
  buildUserPrompt: (input: unknown, frozen: FrozenState) => string;
  parseCredit: (raw: string, frozen: FrozenState) => { credit: unknown; verdict: Verdict };
  ledger: Ledger;
  adapter: CellAdapter;
  maxAttempts?: number;
}

export interface RunCellResult {
  entries: LedgerEntry[];
  final: LedgerEntry;
}

/** True when a credit is a real judgment (parse succeeded) — not an attempt error. */
export function isJudgmentCredit(credit: unknown): boolean {
  return credit !== null && typeof credit === 'object' && !('error' in (credit as object));
}

function errorText(err: unknown): string {
  return String(err instanceof Error ? err.message : err).slice(0, 200);
}

export async function runCell(opts: RunCellOptions): Promise<RunCellResult> {
  const maxAttempts = opts.maxAttempts ?? 2;
  const frozen = thaw(opts.frozenDir, opts.alignmentId);
  const entries: LedgerEntry[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const userPrompt = opts.buildUserPrompt(opts.input, frozen);
    const debit = {
      prompt: { system: frozen.prompt, user: userPrompt },
      input: opts.input,
      model: frozen.model,
      params: frozen.params,
      adapter: opts.adapter.name,
    };
    const retryOf = attempt > 1 ? entries[entries.length - 1]?.seq : undefined;
    const gaveUp = attempt === maxAttempts;

    let entry: LedgerEntry;

    try {
      const startMs = performance.now();
      const output = await opts.adapter.call({
        systemPrompt: frozen.prompt,
        userPrompt,
        params: frozen.params,
      });
      const latencyMs = Math.round(performance.now() - startMs);

      try {
        const parsed = opts.parseCredit(output.raw, frozen);

        // Valid judgment — final regardless of pass/fail. Never escalated.
        // Stamp the credit with cellrunner's own round-trip latency and the
        // attempt count, so downstream stats never depend on the model
        // self-reporting either.
        const judgment: Record<string, unknown> =
          parsed.credit !== null && typeof parsed.credit === 'object' ? (parsed.credit as Record<string, unknown>) : {};
        entry = opts.ledger.append({
          cellId: opts.cellId,
          runId: opts.runId,
          alignmentId: opts.alignmentId,
          debit,
          credit: { ...judgment, latencyMs, attempts: attempt },
          verdict: parsed.verdict,
          escalated: false,
          retryOf,
        });

        entries.push(entry);
        return { entries, final: entry };
      } catch (err) {
        // Unparseable output — retry, or give up on the last attempt.
        const msg = errorText(err);
        entry = opts.ledger.append({
          cellId: opts.cellId,
          runId: opts.runId,
          alignmentId: opts.alignmentId,
          debit,
          credit: { error: msg },
          verdict: 'failed',
          escalated: gaveUp,
          note: gaveUp
            ? `gave up: unparseable output after ${attempt} attempts: ${msg}`
            : `attempt ${attempt}: unparseable output: ${msg}`,
          retryOf,
        });
      }
    } catch (err) {
      // Transport/adapter error — retry, or give up on the last attempt.
      const msg = errorText(err);
      entry = opts.ledger.append({
        cellId: opts.cellId,
        runId: opts.runId,
        alignmentId: opts.alignmentId,
        debit,
        credit: { error: msg },
        verdict: 'failed',
        escalated: gaveUp,
        note: gaveUp
          ? `gave up: adapter error after ${attempt} attempts: ${msg}`
          : `attempt ${attempt}: adapter error: ${msg}`,
        retryOf,
      });
    }

    entries.push(entry);
    if (entry.escalated) {
      return { entries, final: entry };
    }
  }

  // Unreachable: the final attempt always returns (judgment or give-up).
  return { entries, final: entries[entries.length - 1]! };
}
