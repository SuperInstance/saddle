/**
 * findings.ts — findings report generator from ledger entries.
 *
 * CLI: node findings.ts data/ledger.jsonl --out data/reports/findings.md [--worst 15]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Ledger, type LedgerEntry, type VerifyResult } from '../../src/ledger.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

export interface LineJudgment {
  runId: string;
  persona: string;
  bank: string;
  tier?: number;
  trait?: string;
  text: string;
  verdict: 'worked' | 'failed';
  pass: boolean;
  scores: { kid_safe: number; in_voice: number; fresh: number };
  worst: 'kid_safe' | 'in_voice' | 'fresh';
  reason: string;
}

/** Extract the line record JSON that run.ts embeds after the `--- LINE ---` marker. */
function extractLineData(userPrompt: string): Record<string, unknown> {
  const lineMatch = userPrompt.match(/--- LINE ---\n(.*)/s);
  if (!lineMatch?.[1]) return {};
  try {
    return JSON.parse(lineMatch[1]) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Turn a last-entry into a judgment, or null for judge failures (error credits). */
export function toJudgment(entry: LedgerEntry): LineJudgment | null {
  let credit: any;
  try {
    credit = JSON.parse(entry.credit);
  } catch {
    return null; // malformed credit — treat as a judge failure
  }
  if (credit === null || typeof credit !== 'object' || 'error' in credit) {
    return null; // error credit — the judge gave no verdict for this attempt
  }

  let debit: any = {};
  try {
    debit = JSON.parse(entry.debit);
  } catch {
    // keep going — line metadata is best-effort
  }
  const userPrompt: string = debit?.prompt?.user ?? '';
  const lineData = extractLineData(userPrompt);

  return {
    runId: entry.runId,
    persona: typeof lineData.persona === 'string' ? lineData.persona : 'unknown',
    bank: typeof lineData.bank === 'string' ? lineData.bank : 'unknown',
    ...(lineData.tier !== undefined ? { tier: lineData.tier as number } : {}),
    ...(lineData.trait !== undefined ? { trait: lineData.trait as string } : {}),
    text: typeof lineData.line === 'string' ? lineData.line : '(unparseable)',
    verdict: entry.verdict,
    pass: credit.pass === true,
    scores: credit.scores ?? { kid_safe: 0, in_voice: 0, fresh: 0 },
    worst: credit.worst ?? 'kid_safe',
    reason: typeof credit.reason === 'string' ? credit.reason : '(no reason)',
  };
}

export function getRecommendation(j: LineJudgment): string {
  const { kid_safe, in_voice, fresh } = j.scores;
  if (kid_safe <= 4 || in_voice <= 4 || fresh <= 4) return 'REWRITE';
  if (kid_safe <= 6) return 'RETIRE';
  if (fresh <= 5) return 'PUNCH UP';
  return 'REVIEW';
}

/**
 * Build the markdown findings report from the LAST entry per runId (retries
 * supersede — later entries win). Pure: no filesystem, no ledger.
 */
export function buildFindingsReport(lastEntries: Map<string, LedgerEntry>, verify: VerifyResult, worstCount: number): string {
  const verifyOk = verify.ok
    ? '✅ hash chain verified'
    : `❌ hash chain broken at seq ${verify.badSeq ?? '?'}: ${verify.reason ?? 'unknown reason'}`;

  const judgments: LineJudgment[] = [];
  let judgeFailures = 0;
  let escalated = 0;

  for (const entry of lastEntries.values()) {
    if (entry.escalated) {
      escalated++;
    }
    const judgment = toJudgment(entry);
    if (judgment === null) {
      judgeFailures++;
      continue;
    }
    judgments.push(judgment);
  }

  // Compute stats
  const judged = judgments.length;
  const passed = judgments.filter((j) => j.pass).length;
  const failed = judged - passed;
  const passRate = judged > 0 ? passed / judged : 0;

  // Per-criterion stats
  const criteria = ['kid_safe', 'in_voice', 'fresh'] as const;
  const criteriaStats = criteria.map((crit) => {
    const scores = judgments.map((j) => j.scores[crit]);
    return {
      crit,
      mean: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
      min: scores.length > 0 ? Math.min(...scores) : 0,
    };
  });

  // Worst lines: lowest total score, tiebreak by min criterion
  const worst = judgments.slice().sort((a, b) => {
    const aTotal = a.scores.kid_safe + a.scores.in_voice + a.scores.fresh;
    const bTotal = b.scores.kid_safe + b.scores.in_voice + b.scores.fresh;
    if (aTotal !== bTotal) return aTotal - bTotal;
    return Math.min(a.scores.kid_safe, a.scores.in_voice, a.scores.fresh) - Math.min(b.scores.kid_safe, b.scores.in_voice, b.scores.fresh);
  });

  // Per-persona pass rate
  const personaStats = new Map<string, { total: number; passed: number }>();
  for (const j of judgments) {
    const stat = personaStats.get(j.persona) || { total: 0, passed: 0 };
    stat.total++;
    if (j.pass) stat.passed++;
    personaStats.set(j.persona, stat);
  }

  // Build report
  const lines: string[] = [];
  lines.push('# Companion Banter QC Findings');
  lines.push('');
  lines.push(`> ${verifyOk}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Lines Judged | ${judged} |`);
  lines.push(`| Passed | ${passed} |`);
  lines.push(`| Failed | ${failed} |`);
  lines.push(`| Pass Rate | ${(passRate * 100).toFixed(1)}% |`);
  lines.push(`| Judge Failures | ${judgeFailures} |`);
  lines.push(`| Escalations (gave up) | ${escalated} |`);
  lines.push('');

  lines.push('## Per-Criterion Analysis');
  lines.push('');
  lines.push(`| Criterion | Mean | Min |`);
  lines.push(`|---|---|---|`);
  for (const { crit, mean, min } of criteriaStats) {
    lines.push(`| ${crit} | ${mean.toFixed(1)} | ${min} |`);
  }
  lines.push('');

  lines.push(`## Worst Lines (top ${worstCount})`);
  lines.push('');
  for (const j of worst.slice(0, worstCount)) {
    const rec = getRecommendation(j);
    lines.push(`### ${j.runId} · \`${j.persona}\` / \`${j.bank}\``);
    lines.push('');
    lines.push(`**Text:** \`${j.text}\``);
    lines.push('');
    if (j.tier !== undefined) lines.push(`**Tier:** ${j.tier}`);
    if (j.trait) lines.push(`**Trait:** ${j.trait}`);
    lines.push('');
    lines.push(`**Scores:** kid_safe=${j.scores.kid_safe}, in_voice=${j.scores.in_voice}, fresh=${j.scores.fresh}`);
    lines.push('');
    lines.push(`**Reason:** ${j.reason}`);
    lines.push('');
    lines.push(`**Action:** \`${rec}\``);
    lines.push('');
  }

  lines.push('## Per-Persona Summary');
  lines.push('');
  lines.push(`| Persona | Judged | Passed | Pass Rate |`);
  lines.push(`|---|---|---|---|`);
  for (const [persona, stat] of Array.from(personaStats.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const rate = stat.total > 0 ? ((stat.passed / stat.total) * 100).toFixed(1) : '0.0';
    lines.push(`| ${persona} | ${stat.total} | ${stat.passed} | ${rate}% |`);
  }
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('_Findings only — Scrapcraft source untouched (trial discipline)._');

  return lines.join('\n') + '\n';
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2);
  const ledgerPathArg = args.find((a) => !a.startsWith('--') && a !== argValue(args, '--out') && a !== argValue(args, '--worst'));
  const outArg = argValue(args, '--out');
  const worstArg = argValue(args, '--worst');

  let worstCount = 15;
  if (worstArg !== undefined) {
    const n = parseInt(worstArg, 10);
    if (Number.isFinite(n) && n > 0) worstCount = n;
  }

  const ledgerPath = ledgerPathArg !== undefined ? path.resolve(REPO_ROOT, ledgerPathArg) : undefined;

  if (!ledgerPath || !fs.existsSync(ledgerPath)) {
    console.error('usage: node findings.ts <ledger.jsonl> --out <report.md> [--worst N]');
    process.exit(1);
  }

  const outPath = outArg !== undefined ? path.resolve(REPO_ROOT, outArg) : undefined;

  // Verify hash chain first
  const ledger = new Ledger(ledgerPath);
  const verify = await ledger.verify();

  // Collect final entries per runId (retries supersede — later entries win)
  const lastEntries = new Map<string, LedgerEntry>();
  for await (const entry of ledger.stream()) {
    lastEntries.set(entry.runId, entry);
  }

  const body = buildFindingsReport(lastEntries, verify, worstCount);

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, body);
    console.error(`findings written to ${outPath}`);
  } else {
    process.stdout.write(body);
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main(process.argv).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
