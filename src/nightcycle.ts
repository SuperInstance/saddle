/**
 * nightcycle.ts — the stub runner: walks the ledger, emits the earned-keep report.
 *
 * The night cycle is the kennel after dark: what did the corpus teach us?
 * Today this runner answers the bookkeeping questions —
 *   which alignments earned their keep, which cells escalated, how big is the corpus.
 * The training passes (sim/shadow drills, LoRA corpus crunch, cell decomposition)
 * are contracts in docs/nightcycle.md — deliberately not code in this repo.
 *
 * Critical-path rules honored here:
 *   - streams the ledger line by line; memory is O(#alignments + #cells), never O(corpus)
 *   - no subprocess use at all; future passes use list-form spawning only
 *   - report rendering is a separate bounded step
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Ledger } from './ledger.ts';
import type { LedgerEntry } from './ledger.ts';

export const EARNED_KEEP_THRESHOLD = 0.75; // keep ratio an alignment must clear

/** What the night cycle suggests the cowboy do with an alignment. Data only —
 *  saddle never auto-mutates frozens or alignments. */
export interface AlignmentSuggestion {
  action: 'keep' | 'thaw' | 'refreeze';
  reason: string;
}

export interface AlignmentStat {
  alignmentId: string;
  worked: number;
  failed: number;
  escalated: number;
  keepRatio: number;
  earnedKeep: boolean;
  suggestion: AlignmentSuggestion;
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
 */
export function suggestForAlignment(a: AlignmentStat): AlignmentSuggestion {
  const total = a.worked + a.failed;
  if (total < 5) return { action: 'keep', reason: 'insufficient data' };
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

/**
 * Pure function of (ledger) → report. Streams; keeps counters only.
 * Cron-able: see docs/ARCHITECTURE.md for the crontab/systemd timer shape.
 */
export async function runNightCycle(ledgerPath: string): Promise<NightCycleReport> {
  const ledger = new Ledger(ledgerPath);
  const alignments = new Map<string, AlignmentStat>();
  const cells = new Map<string, CellStat>();
  const escalations: NightCycleReport['escalations'] = [];
  let entries = 0;
  let worked = 0;
  let failed = 0;
  let escalated = 0;

  for await (const e of ledger.stream()) {
    entries++;
    if (e.verdict === 'worked') worked++;
    else failed++;
    if (e.escalated) {
      escalated++;
      escalations.push({ seq: e.seq, cellId: e.cellId, alignmentId: e.alignmentId, note: e.note });
    }

    const a = alignments.get(e.alignmentId) ?? {
      alignmentId: e.alignmentId, worked: 0, failed: 0, escalated: 0,
      keepRatio: 0, earnedKeep: false, suggestion: { action: 'keep', reason: 'insufficient data' },
    };
    if (e.verdict === 'worked') a.worked++;
    else a.failed++;
    if (e.escalated) a.escalated++;
    alignments.set(e.alignmentId, a);

    const c = cells.get(e.cellId) ?? { cellId: e.cellId, worked: 0, failed: 0, escalated: 0 };
    if (e.verdict === 'worked') c.worked++;
    else c.failed++;
    if (e.escalated) c.escalated++;
    cells.set(e.cellId, c);
  }

  for (const a of alignments.values()) {
    const total = a.worked + a.failed;
    a.keepRatio = total === 0 ? 0 : a.worked / total;
    a.earnedKeep = a.keepRatio >= EARNED_KEEP_THRESHOLD;
    a.suggestion = suggestForAlignment(a);
  }

  return {
    generatedAt: new Date().toISOString(),
    ledgerPath,
    entries,
    worked,
    failed,
    escalated,
    alignments: [...alignments.values()].sort((x, y) => y.keepRatio - x.keepRatio),
    cells: [...cells.values()].sort((x, y) => y.failed - x.failed || x.cellId.localeCompare(y.cellId)),
    escalations,
    cowboyNeeded: escalations.map((e) => ({ ...e })),
  };
}

const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

/** Render the sunrise report: what the cowboy reads with coffee. */
export function renderReport(r: NightCycleReport): string {
  const lines: string[] = [];
  lines.push(`# Night Cycle Report — ${r.generatedAt}`);
  lines.push('');
  lines.push(`> ledger: \`${r.ledgerPath}\` · ${r.entries} entries · ${r.worked} worked / ${r.failed} failed / ${r.escalated} escalated`);
  lines.push('');
  lines.push('## Alignments — which ones earned their keep');
  lines.push('');
  lines.push('| alignment | worked | failed | escalated | keep ratio | verdict |');
  lines.push('|---|---|---|---|---|---|');
  if (r.alignments.length === 0) lines.push('| _(empty ledger)_ | | | | | |');
  for (const a of r.alignments) {
    lines.push(`| \`${a.alignmentId}\` | ${a.worked} | ${a.failed} | ${a.escalated} | ${pct(a.keepRatio)} | ${a.earnedKeep ? '✅ earned its keep' : '🔥 thaw candidate'} |`);
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
