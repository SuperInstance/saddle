/**
 * cellrunner.ts — the roundup loop's middle, made real.
 *
 * Runs one inference (with retries) and logs to the ledger, without ever calling
 * a model directly — the adapter is injected. Double-entry bookkeeping on every
 * attempt: debit (full prompt + input + model), credit (output), verdict.
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

    let entry: LedgerEntry;

    try {
      const startMs = performance.now();
      const output = await opts.adapter.call({
        systemPrompt: frozen.prompt,
        userPrompt,
        params: frozen.params,
      });
      const latencyMs = Math.round(performance.now() - startMs);

      let verdict: Verdict;
      let credit: unknown;

      try {
        const parsed = opts.parseCredit(output.raw, frozen);
        verdict = parsed.verdict;
        credit = parsed.credit;
      } catch (err) {
        verdict = 'failed';
        credit = { error: String(err instanceof Error ? err.message : err) };
      }

      const note = verdict === 'failed' && credit && typeof credit === 'object' && 'error' in credit ? `attempt ${attempt}: ${String((credit as any).error).slice(0, 200)}` : undefined;
      const escalated = verdict === 'failed' && attempt === maxAttempts;

      entry = opts.ledger.append({
        cellId: opts.cellId,
        runId: opts.runId,
        alignmentId: opts.alignmentId,
        debit,
        credit,
        verdict,
        escalated,
        note: escalated && verdict === 'failed' ? `gave up: ${note ?? 'max attempts exceeded'}` : note,
        retryOf: attempt > 1 ? entries[entries.length - 1].seq : undefined,
      });
    } catch (err) {
      const errorMsg = String(err instanceof Error ? err.message : err).slice(0, 200);
      const escalated = attempt === maxAttempts;

      entry = opts.ledger.append({
        cellId: opts.cellId,
        runId: opts.runId,
        alignmentId: opts.alignmentId,
        debit,
        credit: { error: errorMsg },
        verdict: 'failed',
        escalated,
        note: escalated ? `gave up: attempt ${attempt}: ${errorMsg}` : `attempt ${attempt}: ${errorMsg}`,
        retryOf: attempt > 1 ? entries[entries.length - 1].seq : undefined,
      });
    }

    entries.push(entry);

    if (entry.verdict === 'worked' || entry.escalated) {
      return { entries, final: entry };
    }
  }

  return { entries, final: entries[entries.length - 1] };
}
