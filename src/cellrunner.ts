/**
 * cellrunner.ts — run ONE pinned cell against an adapter, keeping books.
 *
 * This module is a single-cell runner: it thaws the frozen alignment in
 * effect, builds the full prompt context, calls an injected adapter (never a
 * real model), parses the credit, and appends one ledger entry per attempt.
 * Retries chain via retryOf.
 *
 * Attempt outcomes come in exactly two classes (field-trial-1 semantics):
 *
 *   judgment — parseCredit succeeded. The credit is a real judgment and its
 *     verdict — 'worked' OR 'failed' — is FINAL: a QC-fail is a completed
 *     judgment, not a give-up. Never retried, never escalated. The entry
 *     carries verdictKind 'worked' or 'judgment-fail', and the credit is
 *     stamped with cellrunner's own round-trip latencyMs and the attempt
 *     count, so downstream stats never depend on the model self-reporting
 *     either.
 *
 *   error — the adapter call threw (transport) or parseCredit threw
 *     (unparseable output). verdictKind 'execution-error', retryable; when
 *     maxAttempts is exhausted the final entry is appended escalated with
 *     verdictKind 'escalated' (the cell gave up, the cowboy must look).
 *
 * Token accounting (the cost side of the books must not understate the
 * debit): every credit — judgment and error alike — carries a `usage` object.
 * Adapter-reported usage when the provider supplies it (`estimated: false`),
 * else a chars/4 estimate. Error credits with no raw output estimate from
 * the prompt side only.
 *
 * Critical-path rules honored here:
 *   - no model calls in core (adapter is injected), no subprocess, no deps
 *   - a tampered frozen state throws BEFORE any ledger append
 */

import { thaw } from './frozens.ts';
import { Ledger } from './ledger.ts';
import type { LedgerEntry, Verdict, VerdictKind } from './ledger.ts';

/** What a cell sends to whatever actually talks to a model. */
export interface CellRequest {
  model: string;
  prompt: { system: string; user: string };
  params: Record<string, number | string | boolean>;
  input: unknown;
}

/**
 * Token accounting for one call — the cost side of the double entry.
 * `estimated: true` means saddle derived the numbers (chars/4), not the
 * provider.
 */
export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
}

/** Transport seam — inject a real client here; core ships only mocks. */
export interface CellAdapter {
  name: string;
  call(request: CellRequest): Promise<{ raw: string; latencyMs: number; usage?: Usage }> | { raw: string; latencyMs: number; usage?: Usage };
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
 * Chars/4 fallback when the provider reports no usage: prompt side is the
 * system + user text, completion side is the raw output. Crude, honest, and
 * flagged `estimated: true` so reports can say how much of the corpus cost
 * is a guess.
 */
export function estimateUsage(prompt: { system: string; user: string }, rawOutput: string): Usage {
  const promptTokens = Math.ceil((prompt.system.length + prompt.user.length) / 4);
  const completionTokens = Math.ceil(rawOutput.length / 4);
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, estimated: true };
}

function errorText(err: unknown): string {
  return String(err instanceof Error ? err.message : err).slice(0, 200);
}

/**
 * Run one cell. Every attempt (judgment, or error) is one ledger entry;
 * retries chain via retryOf → the immediately previous attempt. A successful
 * parse is FINAL regardless of pass/fail; only errors retry, and exhausting
 * maxAttempts appends the final entry escalated with a 'gave up:' note.
 */
export async function runCell(opts: RunCellOptions): Promise<RunCellResult> {
  // thaw (and verify) BEFORE any bookkeeping — a tampered state never runs
  const frozen = thaw(opts.frozenDir, opts.alignmentId);

  const maxAttempts = opts.maxAttempts ?? 2;
  const entries: LedgerEntry[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = { system: frozen.prompt, user: opts.buildUserPrompt(opts.input) };
    const debit = {
      prompt,
      input: opts.input,
      model: frozen.model,
      params: frozen.params,
      adapter: opts.adapter.name,
    };
    const retryOf = entries.length > 0 ? entries[entries.length - 1]!.seq : undefined;
    const last = attempt === maxAttempts;

    let entry: LedgerEntry;

    try {
      const startMs = performance.now();
      const response = await opts.adapter.call({
        model: frozen.model,
        prompt,
        params: frozen.params,
        input: opts.input,
      });
      const latencyMs = Math.round(performance.now() - startMs);
      // provider-reported usage wins (estimated: false); else chars/4 estimate
      const usage: Usage = response.usage
        ? { ...response.usage, estimated: false }
        : estimateUsage(prompt, response.raw);

      try {
        const parsed = opts.parseCredit(response.raw);

        // Valid judgment — FINAL regardless of pass/fail. A QC-fail is a
        // completed judgment: append, stop, never retry, never escalate.
        const judgment: Record<string, unknown> =
          parsed.credit !== null && typeof parsed.credit === 'object' ? (parsed.credit as Record<string, unknown>) : {};
        entry = opts.ledger.append({
          cellId: opts.cellId,
          runId: opts.runId,
          alignmentId: frozen.alignmentId,
          debit,
          credit: { ...judgment, latencyMs, attempts: attempt, usage },
          verdict: parsed.verdict,
          verdictKind: parsed.verdict === 'worked' ? 'worked' : 'judgment-fail',
          escalated: false,
          ...(retryOf !== undefined ? { retryOf } : {}),
        });
      } catch (err) {
        // Unparseable output — retryable execution error; give up on the last.
        const msg = errorText(err);
        entry = opts.ledger.append({
          cellId: opts.cellId,
          runId: opts.runId,
          alignmentId: frozen.alignmentId,
          debit,
          credit: { error: msg, usage },
          verdict: 'failed',
          verdictKind: last ? 'escalated' : 'execution-error',
          escalated: last,
          note: last
            ? `gave up: attempt ${attempt}: parse failed: ${msg}`
            : `attempt ${attempt}: parse failed: ${msg}`,
          ...(retryOf !== undefined ? { retryOf } : {}),
        });
      }
    } catch (err) {
      // Transport/adapter error — retryable execution error; give up on the last.
      const msg = errorText(err);
      // no raw output to count: estimate from the prompt side only
      // (estimateUsage with an empty raw → completionTokens 0)
      const usage: Usage = estimateUsage(prompt, '');
      entry = opts.ledger.append({
        cellId: opts.cellId,
        runId: opts.runId,
        alignmentId: frozen.alignmentId,
        debit,
        credit: { error: msg, usage },
        verdict: 'failed',
        verdictKind: last ? 'escalated' : 'execution-error',
        escalated: last,
        note: last
          ? `gave up: attempt ${attempt}: adapter error: ${msg}`
          : `attempt ${attempt}: adapter error: ${msg}`,
        ...(retryOf !== undefined ? { retryOf } : {}),
      });
    }

    entries.push(entry);
    if (entry.verdictKind !== 'execution-error') {
      // judgment (worked/judgment-fail) or give-up (escalated): the run is over
      return { entries, final: entry };
    }
  }

  // Unreachable: the final attempt always returns (judgment or give-up).
  return { entries, final: entries[entries.length - 1]! };
}
