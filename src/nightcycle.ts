/**
 * nightcycle.ts — the stub runner: walks the ledger, emits the earned-keep report.
 *
 * The night cycle is the kennel after dark: what did the corpus teach us?
 * Today this runner answers the bookkeeping questions —
 *   which alignments earned their keep, which cells escalated, how big is the corpus.
 * The training passes (sim/shadow drills, LoRA corpus crunch, cell decomposition)
 * are contracts in docs/nightcycle.md — deliberately not code in this repo.
 *
 * v3 earned-keep semantics (field-trial-1 gap 2): keepRatio used to measure
 * the BANK's quality (subject pass rate), not the ALIGNMENT's. A judge
 * alignment that cleanly fails bad lines is doing its job. Outcome stats are
 * therefore computed from FINAL entries only (retries deduped per run),
 * classified by VerdictKind:
 *   worked + judgment-fail = judgments produced  → alignment SUCCESS
 *   execution-error + escalated = alignment failures
 *   keepRatio = judgmentsProduced / totalFinal
 * The bank's quality survives as the separate `judgmentPassRate` ("subject
 * pass rate"), meaningful wherever judgment-fails exist.
 *
 * Critical-path rules honored here:
 *   - streams the ledger line by line; memory is O(#alignments + #cells +
 *     #runs), never O(corpus)
 *   - no subprocess use at all; future passes use list-form spawning only
 *   - report rendering is a separate bounded step
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Ledger } from './ledger.ts';
import type { LedgerEntry } from './ledger.ts';
import { resolveVerdictKind } from './ledger.ts';
import { thaw } from './frozens.ts';

export const EARNED_KEEP_THRESHOLD = 0.75; // keep ratio an alignment must clear

/** What the night cycle suggests the cowboy do with an alignment. Data only —
 *  saddle never auto-mutates frozens or alignments. */
export interface AlignmentSuggestion {
  action: 'keep' | 'thaw' | 'refreeze';
  reason: string;
}

/** Token cost per alignment — the debit side, summed over EVERY entry
 *  (retried attempts cost real tokens too; dedupe would understate spend). */
export interface AlignmentTokens {
  prompt: number;
  completion: number;
  total: number;
  /** how many of `total` came from chars/4 estimates rather than provider reports */
  estimated: number;
}

export interface AlignmentStat {
  alignmentId: string;
  /** final entries with kind 'worked' (judgments/outcomes that passed) */
  worked: number;
  /** back-compat: judgmentFails + executionErrors + escalations (worked+failed = totalFinal) */
  failed: number;
  escalated: number;
  /** judgmentsProduced / totalFinal — the earned-keep metric (v3 semantics) */
  keepRatio: number;
  /** worked / (worked + failed) — only meaningful when the frozen state declares earnedKeepMetric: 'task-approval' */
  approvalRatio?: number;
  /** the metric the FROZEN STATE declared (gap 2: semantics live in the state, not the runner). Defaults to 'production' */
  earnedKeepMetric?: 'production' | 'task-approval';
  earnedKeep: boolean;
  suggestion: AlignmentSuggestion;
  /** worked + judgmentFails: outcomes the alignment actually produced */
  judgmentsProduced: number;
  /** completed QC-fail judgments — the alignment DID its job here */
  judgmentFails: number;
  /** adapter/parse failures that never produced an outcome */
  executionErrors: number;
  /** final give-ups (kind 'escalated'; same count as `escalated`) */
  escalations: number;
  /** worked / (worked + judgmentFails) — the SUBJECT's pass rate, guarded to 0 */
  judgmentPassRate: number;
  tokens: AlignmentTokens;
  /** entries whose usage the provider reported vs chars/4-estimated (missing usage: neither) */
  reportedTokenEntries: number;
  estimatedTokenEntries: number;
}

export interface CellStat {
  cellId: string;
  worked: number;
  failed: number;
  escalated: number;
}

export interface NightCycleReport {
  generatedAt: string;
  ledgerPath: string;
  entries: number;
  worked: number;
  failed: number;
  escalated: number;
  alignments: AlignmentStat[];
  cells: CellStat[];
  escalations: Array<Pick<LedgerEntry, 'seq' | 'cellId' | 'alignmentId' | 'note'>>;
  /** same data as `escalations`, named for the mission. Migrate consumers to
   * this field — `escalations` is the deprecation candidate (back-compat keeps both). */
  cowboyNeeded: Array<Pick<LedgerEntry, 'seq' | 'cellId' | 'alignmentId' | 'note'>>;
}

/**
 * Suggest an action for one alignment. Data only — the cowboy pulls the lever.
 *   thaw     — keepRatio below EARNED_KEEP_THRESHOLD, or escalation-heavy
 *              (>20% of entries escalated)
 *   refreeze — earned its keep, proven (≥20 worked), and very stable (≥0.95):
 *              a candidate to pin/re-freeze as a canonical state
 *   keep     — everything else, and always when samples < 5 (insufficient data)
 *
 * v3: keepRatio is the PRODUCTION ratio (judgments produced / final runs),
 * so a strict judge no longer gets thawed for failing bad subjects.
 */
export function suggestForAlignment(a: AlignmentStat): AlignmentSuggestion {
  const total = a.worked + a.failed;
  if (total < 5) return { action: 'keep', reason: 'insufficient data' };
  if (a.earnedKeepMetric === 'task-approval' && a.approvalRatio !== undefined && a.approvalRatio < EARNED_KEEP_THRESHOLD) {
    return { action: 'thaw', reason: `task approval ${pct(a.approvalRatio)} is below the ${pct(EARNED_KEEP_THRESHOLD)} threshold (declared metric: task-approval)` };
  }
  if (a.keepRatio < EARNED_KEEP_THRESHOLD) {
    return { action: 'thaw', reason: `keep ratio ${pct(a.keepRatio)} is below the ${pct(EARNED_KEEP_THRESHOLD)} threshold` };
  }
  if (a.escalated > 0 && a.escalated / total > 0.2) {
    return { action: 'thaw', reason: `escalation rate ${pct(a.escalated / total)} exceeds 20%` };
  }
  if (a.earnedKeep && a.worked >= 20 && a.keepRatio >= 0.95) {
    return { action: 'refreeze', reason: `stable and proven: ${a.worked} worked at ${pct(a.keepRatio)} keep ratio` };
  }
  return { action: 'keep', reason: 'performing within tolerance' };
}

/** Read `usage` off a credit JSON string; null when absent/unreadable. */
function usageOf(entry: LedgerEntry): { promptTokens: number; completionTokens: number; totalTokens: number; estimated: boolean } | null {
  try {
    const credit = JSON.parse(entry.credit) as unknown;
    if (credit === null || typeof credit !== 'object' || Array.isArray(credit)) return null;
    const usage = (credit as Record<string, unknown>).usage;
    if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) return null;
    const u = usage as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    if (u.promptTokens === undefined && u.completionTokens === undefined && u.totalTokens === undefined) return null;
    return {
      promptTokens: num(u.promptTokens),
      completionTokens: num(u.completionTokens),
      totalTokens: num(u.totalTokens),
      estimated: u.estimated === true,
    };
  } catch {
    return null;
  }
}

/**
 * Pure function of (ledger) → report. Streams; keeps counters only.
 * Cron-able: see docs/ARCHITECTURE.md for the crontab/systemd timer shape.
 */
export async function runNightCycle(ledgerPath: string, opts?: { frozenDir?: string }): Promise<NightCycleReport> {
  const ledger = new Ledger(ledgerPath);
  const cells = new Map<string, CellStat>();
  const escalations: NightCycleReport['escalations'] = [];
  let entries = 0;
  let worked = 0;
  let failed = 0;
  let escalated = 0;

  // Outcome stats are computed from FINAL entries only: retries are deduped
  // per run, last entry wins. This map holds one entry per run — bounded by
  // O(#runs), the same memory class as the per-cell map below, never O(corpus).
  const finals = new Map<string, LedgerEntry>();

  interface Acc {
    judgmentsProduced: number;
    worked: number;
    judgmentFails: number;
    executionErrors: number;
    escalations: number;
    tokens: AlignmentTokens;
    reportedTokenEntries: number;
    estimatedTokenEntries: number;
  }
  const accs = new Map<string, Acc>();
  const accOf = (alignmentId: string): Acc => {
    let a = accs.get(alignmentId);
    if (!a) {
      a = {
        judgmentsProduced: 0, worked: 0, judgmentFails: 0, executionErrors: 0, escalations: 0,
        tokens: { prompt: 0, completion: 0, total: 0, estimated: 0 },
        reportedTokenEntries: 0, estimatedTokenEntries: 0,
      };
      accs.set(alignmentId, a);
    }
    return a;
  };

  for await (const e of ledger.stream()) {
    entries++;
    // ledger-wide + per-cell counts stay RAW (every entry counts): the cells
    // table is a failure-load view, and a retried attempt was still load.
    if (e.verdict === 'worked') worked++;
    else failed++;
    if (e.escalated) {
      escalated++;
      escalations.push({ seq: e.seq, cellId: e.cellId, alignmentId: e.alignmentId, note: e.note });
    }

    const c = cells.get(e.cellId) ?? { cellId: e.cellId, worked: 0, failed: 0, escalated: 0 };
    if (e.verdict === 'worked') c.worked++;
    else c.failed++;
    if (e.escalated) c.escalated++;
    cells.set(e.cellId, c);

    // token cost: every entry spends, retries included
    const a = accOf(e.alignmentId);
    const usage = usageOf(e);
    if (usage) {
      a.tokens.prompt += usage.promptTokens;
      a.tokens.completion += usage.completionTokens;
      a.tokens.total += usage.totalTokens;
      if (usage.estimated) {
        a.tokens.estimated += usage.totalTokens;
        a.estimatedTokenEntries++;
      } else {
        a.reportedTokenEntries++;
      }
    }

    finals.set(`${e.cellId}\u0000${e.runId}`, e); // later entries overwrite: last wins
  }

  // classify final outcomes per alignment (the alignment of the FINAL entry
  // of a run owns that run's outcome)
  for (const e of finals.values()) {
    const a = accOf(e.alignmentId);
    switch (resolveVerdictKind(e)) {
      case 'worked':
        a.worked++;
        a.judgmentsProduced++;
        break;
      case 'judgment-fail':
        a.judgmentFails++;
        a.judgmentsProduced++;
        break;
      case 'execution-error':
        a.executionErrors++;
        break;
      case 'escalated':
        a.escalations++;
        break;
    }
  }

  const alignments: AlignmentStat[] = [];
  for (const [alignmentId, a] of accs) {
    const totalFinal = a.worked + a.judgmentFails + a.executionErrors + a.escalations;
    const keepRatio = totalFinal === 0 ? 0 : a.judgmentsProduced / totalFinal;
    const judged = a.worked + a.judgmentFails;
    // gap 2: the metric the frozen state DECLARES decides what earned-keep means.
    // Old frozens (no declaration) read as 'production' — bit-compatible.
    let declared: 'production' | 'task-approval' = 'production';
    if (opts?.frozenDir) {
      try {
        const frozen = thaw(opts.frozenDir, alignmentId);
        if (frozen.earnedKeepMetric === 'task-approval') declared = 'task-approval';
      } catch {
        // frozen state missing/unreadable — fall back to the default metric, report it as undeclared
      }
    }
    const approvalRatio = judged === 0 ? 0 : a.worked / judged;
    const stat: AlignmentStat = {
      alignmentId,
      worked: a.worked,
      failed: a.judgmentFails + a.executionErrors + a.escalations, // old shape still adds up
      escalated: a.escalations,
      keepRatio,
      approvalRatio,
      earnedKeepMetric: declared,
      earnedKeep: declared === 'task-approval' ? approvalRatio >= EARNED_KEEP_THRESHOLD : keepRatio >= EARNED_KEEP_THRESHOLD,
      suggestion: { action: 'keep', reason: 'insufficient data' },
      judgmentsProduced: a.judgmentsProduced,
      judgmentFails: a.judgmentFails,
      executionErrors: a.executionErrors,
      escalations: a.escalations,
      judgmentPassRate: judged === 0 ? 0 : a.worked / judged,
      tokens: a.tokens,
      reportedTokenEntries: a.reportedTokenEntries,
      estimatedTokenEntries: a.estimatedTokenEntries,
    };
    stat.suggestion = suggestForAlignment(stat);
    alignments.push(stat);
  }

  return {
    generatedAt: new Date().toISOString(),
    ledgerPath,
    entries,
    worked,
    failed,
    escalated,
    alignments: alignments.sort((x, y) => y.keepRatio - x.keepRatio),
    cells: [...cells.values()].sort((x, y) => y.failed - x.failed || x.cellId.localeCompare(y.cellId)),
    escalations,
    cowboyNeeded: escalations.map((e) => ({ ...e })),
  };
}

const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

/** Compact token counts for the report: 9,412 stays raw; 94,120 → 94.1k. */
const tok = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

/** Render the sunrise report: what the cowboy reads with coffee. */
export function renderReport(r: NightCycleReport): string {
  const lines: string[] = [];
  lines.push(`# Night Cycle Report — ${r.generatedAt}`);
  lines.push('');
  lines.push(`> ledger: \`${r.ledgerPath}\` · ${r.entries} entries · ${r.worked} worked / ${r.failed} failed / ${r.escalated} escalated`);
  lines.push('');
  lines.push('## Alignments — which ones earned their keep');
  lines.push('');
  lines.push('_keep ratio = judgments produced / final runs (v3: a judge that cleanly fails bad lines is doing its job). Subject pass rate = how often the judged subject itself passed._');
  lines.push('');
  lines.push('| alignment | worked | failed | escalated | keep ratio | subject pass | verdict |');
  lines.push('|---|---|---|---|---|---|---|');
  if (r.alignments.length === 0) lines.push('| _(empty ledger)_ | | | | | | |');
  for (const a of r.alignments) {
    lines.push(`| \`${a.alignmentId}\` | ${a.worked} | ${a.failed} | ${a.escalated} | ${pct(a.keepRatio)} | ${pct(a.judgmentPassRate)} | ${a.earnedKeep ? '✅ earned its keep' : '🔥 thaw candidate'} |`);
  }
  lines.push('');
  lines.push('## Cells — failure load, worst first');
  lines.push('');
  lines.push('| cell | worked | failed | escalated |');
  lines.push('|---|---|---|---|');
  for (const c of r.cells.slice(0, 25)) {
    lines.push(`| \`${c.cellId}\` | ${c.worked} | ${c.failed} | ${c.escalated} |`);
  }
  if (r.cells.length > 25) lines.push(`| _…${r.cells.length - 25} more cells_ | | | |`);
  lines.push('');
  lines.push('## Cost per alignment');
  lines.push('');
  lines.push('| alignment | prompt | completion | total | estimated share |');
  lines.push('|---|---|---|---|---|');
  if (r.alignments.length === 0) lines.push('| _(no token data)_ | | | | |');
  for (const a of r.alignments) {
    const share = a.tokens.total === 0 ? '0.0%' : pct(a.tokens.estimated / a.tokens.total);
    lines.push(`| \`${a.alignmentId}\` | ${tok(a.tokens.prompt)} | ${tok(a.tokens.completion)} | ${tok(a.tokens.total)} | ${share} |`);
  }
  lines.push('');
  lines.push('_Token costs for now — dollars when pricing lands. Estimated share is the fraction of tokens derived by chars/4 rather than reported by the provider._');
  lines.push('');
  lines.push('## Suggested actions');
  lines.push('');
  lines.push('| alignment | action | reason |');
  lines.push('|---|---|---|');
  if (r.alignments.length === 0) lines.push('| _(empty ledger)_ | | |');
  for (const a of r.alignments) {
    lines.push(`| \`${a.alignmentId}\` | ${a.suggestion.action} | ${a.suggestion.reason} |`);
  }
  lines.push('');
  lines.push('_Suggestions are data only — saddle never auto-mutates frozens or alignments. The cowboy decides._');
  lines.push('_A suggestion is an advisory snapshot of the ledger at generation time; it does not consult in-flight runs._');
  lines.push('');
  lines.push('## Attention list — escalations for the cowboy');
  lines.push('');
  if (r.escalations.length === 0) {
    lines.push('_None. The kennel slept through the night._');
  } else {
    for (const e of r.escalations.slice(0, 50)) {
      lines.push(`- seq ${e.seq} · \`${e.cellId}\` · alignment \`${e.alignmentId}\`${e.note ? ` — ${e.note}` : ''}`);
    }
    if (r.escalations.length > 50) lines.push(`- _…${r.escalations.length - 50} more (see JSON report for the full list)_`);
  }
  lines.push('');
  lines.push('---');
  lines.push('_Training passes (sim/shadow, LoRA corpus crunch, cell decomposition) are contracts — see docs/nightcycle.md. No training code ships from saddle._');
  return lines.join('\n') + '\n';
}

/** CLI: node src/nightcycle.ts <ledger.jsonl> [--out report.md] [--json] */
async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2);
  const ledgerPath = args.find((a) => !a.startsWith('--'));
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  if (!ledgerPath || flags.has('--help') || flags.has('-h')) {
    console.log('usage: node src/nightcycle.ts <ledger.jsonl> [--out report.md] [--json]');
    process.exit(ledgerPath ? 0 : 1);
  }
  if (!fs.existsSync(ledgerPath)) {
    console.error(`nightcycle: ledger not found: ${ledgerPath}`);
    process.exit(1);
  }
  const report = await runNightCycle(ledgerPath);
  const out = args.indexOf('--out');
  const outPath = out !== -1 ? args[out + 1] : undefined;
  const body = flags.has('--json') ? JSON.stringify(report, null, 2) + '\n' : renderReport(report);
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, body);
    console.error(`nightcycle: report written to ${outPath} (${report.entries} entries, ${report.alignments.length} alignments)`);
  } else {
    process.stdout.write(body);
  }
}

// run as CLI only when invoked directly
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  await main(process.argv);
}
