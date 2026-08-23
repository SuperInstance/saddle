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

export interface AlignmentStat {
  alignmentId: string;
  worked: number;
  failed: number;
  escalated: number;
  keepRatio: number;
  earnedKeep: boolean;
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

    const a = alignments.get(e.alignmentId) ?? { alignmentId: e.alignmentId, worked: 0, failed: 0, escalated: 0, keepRatio: 0, earnedKeep: false };
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
  const body = flags.has('--json') ? JSON.stringify(report, null, 2) + '\n' : renderReport(report);
  if (out !== -1 && args[out + 1]) {
    fs.mkdirSync(path.dirname(args[out + 1]), { recursive: true });
    fs.writeFileSync(args[out + 1], body);
    console.error(`nightcycle: report written to ${args[out + 1]} (${report.entries} entries, ${report.alignments.length} alignments)`);
  } else {
    process.stdout.write(body);
  }
}

// run as CLI only when invoked directly
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  await main(process.argv);
}
