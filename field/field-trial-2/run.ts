/**
 * run.ts — Field Trial 2: the 15 QC-rewritten lines through a 3-judge QUORUM.
 *
 * Trial 1 judged the originals with ONE frozen judge (90.3% bank pass, but
 * the 15 worst were one model's opinion). Scrapcraft rewrote all 15 in
 * commit 9b9d0fa (merged c4afb31). Trial 2 asks: did the rewrites clear the
 * bar — and does a 3-judge panel agree with what a single judge would say?
 *
 * Judges (genuine diversity inside the same pass bar):
 *   j1 — the ORIGINAL trial-1 judge frozen state (bit-for-bit same alignment)
 *   j2 — "line editor" persona: same rubric and thresholds, sharper wording
 *   j3 — "playtester kid" persona: same rubric and thresholds, reads as a kid
 *
 * CLI: node field/field-trial-2/run.ts [--concurrency K]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ledger, type LedgerEntry } from '../../src/ledger.ts';
import { freeze, thaw, type AlignmentDraft, type FrozenState } from '../../src/frozens.ts';
import { runQuorumCell, type QuorumResult, type QuorumJudgeSpec } from '../../src/quorum.ts';
import { parseCredit, buildLineUserPrompt } from '../field-trial-1/run.ts';
import { makeZaiAdapter } from './adapter.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const DATA = path.join(__dirname, 'data');
const FROZENS = path.join(DATA, 'frozens');
const LEDGER = path.join(DATA, 'ledger.jsonl');

interface Ft2Line {
  id: string;
  ft1Id: string | null;
  persona: string;
  bank: string;
  tier?: number;
  trait?: string;
  text: string;
  ft1Verdict?: { pass: boolean; scores: Record<string, number>; reason: string } | null;
  note?: string;
}

// ---------------------------------------------------------------------------
// Judge alignments. j1 reuses trial-1's EXACT frozen state (copied in);
// j2/j3 are new freezes of the same rubric with different judge personas.
// The pass bar (kid_safe>=8, in_voice>=6, fresh>=5) is identical in all
// three so votes are comparable — only the READING voice varies.
// ---------------------------------------------------------------------------

const EDITOR_TAIL = ` You are a working line editor: you have read ten thousand submissions and you trust specific physical detail over atmosphere. When a line is generic you say so bluntly; when it is good you do not inflate it.`;

const KID_TAIL = ` You read these lines the way a 11-year-old player would hear them out loud: you notice when a line is boring filler you'd skip, and you notice when it makes you grin because it's about actual junk and actual bolts. You still score strictly by the rubric.`;

async function ensureJudge1(): Promise<string> {
  // trial-1's original frozen judge — copy verbatim into ft2 frozens
  const src = path.join(REPO_ROOT, 'field/field-trial-1/data/frozens/b51e0ea3c59090ad.json');
  const dst = path.join(FROZENS, 'b51e0ea3c59090ad.json');
  fs.mkdirSync(FROZENS, { recursive: true });
  if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
  thaw(FROZENS, 'b51e0ea3c59090ad'); // verifies hash chain — throws if tampered
  return 'b51e0ea3c59090ad';
}

async function freezeVariant(base: FrozenState, id: string, tail: string): Promise<string> {
  const draft: AlignmentDraft = {
    id,
    model: base.model,
    useCase: base.useCase,
    prompt: base.prompt + tail,
    inputFilters: base.inputFilters,
    outputFilters: base.outputFilters,
    params: base.params,
    directiveChunks: base.directiveChunks,
  };
  const frozen = freeze(FROZENS, draft);
  return frozen.alignmentId;
}

// ---------------------------------------------------------------------------
// Resume: a quorum cell is done when the LAST entry under its summary runId
// is a summary (panel) entry — verdictKind set, not an error-only state.
// Simpler here: key off `${line.id}` runId's last entry being the summary
// (the summary is the final append for that runId).
// ---------------------------------------------------------------------------

function isSummaryDone(entry: LedgerEntry): boolean {
  try {
    const debit = JSON.parse(entry.debit) as { panel?: boolean };
    return debit?.panel === true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const concurrencyArg = process.argv.indexOf('--concurrency');
  const concurrency = concurrencyArg !== -1 ? parseInt(process.argv[concurrencyArg + 1]!, 10) || 3 : 3;

  const linesData = JSON.parse(fs.readFileSync(path.join(DATA, 'lines.json'), 'utf8')) as { lines: Ft2Line[] };
  const lines = linesData.lines;
  const ledger = new Ledger(LEDGER);

  const j1Id = await ensureJudge1();
  const base = thaw(FROZENS, j1Id);
  const j2Id = await freezeVariant(base, 'ft2-judge-editor', EDITOR_TAIL);
  const j3Id = await freezeVariant(base, 'ft2-judge-kid', KID_TAIL);
  const judges: QuorumJudgeSpec[] = [
    { alignmentId: j1Id, label: 'j1-original' },
    { alignmentId: j2Id, label: 'j2-editor' },
    { alignmentId: j3Id, label: 'j3-kid' },
  ];
  console.error(`panel frozen: ${judges.map((j) => `${j.label}=${j.alignmentId.slice(0, 8)}`).join(' ')}`);

  // resume check: last entry per line summary runId
  const lastEntries = new Map<string, LedgerEntry>();
  for await (const entry of ledger.stream()) {
    lastEntries.set(entry.runId, entry);
  }
  const todo = lines.filter((l) => {
    const last = lastEntries.get(`ft2-${l.id}`);
    return last === undefined || !isSummaryDone(last);
  });
  console.error(`loaded ${lines.length} lines, ${lines.length - todo.length} already done, ${todo.length} to judge`);

  const adapter = makeZaiAdapter({ concurrency: concurrency * 3 });
  const results: QuorumResult[] = [];

  let sem = concurrency;
  const waiters: Array<() => void> = [];
  const acquire = () => (sem > 0 ? ((sem--), Promise.resolve()) : new Promise<void>((r) => waiters.push(() => { sem--; r(); })));
  const release = () => { sem++; const n = waiters.shift(); if (n) n(); };

  await Promise.all(
    todo.map(async (line) => {
      await acquire();
      try {
        const result = await runQuorumCell({
          frozenDir: FROZENS,
          judges,
          cellId: `ft2/banter-qc-quorum`,
          runId: `ft2-${line.id}`,
          input: { persona: line.persona, bank: line.bank, tier: line.tier, trait: line.trait, line: line.text },
          buildUserPrompt: buildLineUserPrompt,
          parseCredit,
          ledger,
          adapter,
        });
        results.push(result);
        process.stderr.write(
          ` ${line.id} ${result.majority}${result.dissent.length > 0 ? ' (dissent: ' + result.dissent.map((d) => d.judge).join(',') + ')' : ''}\n`
        );
      } finally {
        release();
      }
    })
  );

  // ---- summary stats + token cost per judge ----
  let worked = 0, failed = 0, hung = 0;
  const tokenByJudge: Record<string, { prompt: number; completion: number; calls: number }> = {};
  let anyDissent = false;

  for (const r of results) {
    if (r.majority === 'worked') worked++;
    else if (r.majority === 'judgment-fail') failed++;
    else hung++;
    if (r.dissent.length > 0) anyDissent = true;
    for (const j of r.judges) {
      for (const e of j.entries) {
        try {
          const credit = JSON.parse(e.credit) as { usage?: { promptTokens: number; completionTokens: number } };
          if (credit.usage) {
            const t = (tokenByJudge[j.label] ??= { prompt: 0, completion: 0, calls: 0 });
            t.prompt += credit.usage.promptTokens;
            t.completion += credit.usage.completionTokens;
            t.calls++;
          }
        } catch { /* skip */ }
      }
    }
  }

  const stats = {
    ts: new Date().toISOString(),
    lines: results.length,
    worked,
    judgmentFail: failed,
    hung,
    passRate: results.length > 0 ? Number((worked / results.length).toFixed(3)) : 0,
    dissentSeen: anyDissent,
    tokensPerJudge: tokenByJudge,
  };
  fs.writeFileSync(path.join(DATA, 'stats.json'), JSON.stringify(stats, null, 2));
  console.error(JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
