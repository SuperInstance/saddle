/**
 * findings.ts — findings report generator from ledger entries.
 *
 * CLI: node findings.ts data/ledger.jsonl --out data/reports/findings.md [--worst 15]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Ledger, type LedgerEntry } from '../../src/ledger.ts';

interface ParsedCredit {
  pass: boolean;
  scores: { kid_safe: number; in_voice: number; fresh: number };
  worst: 'kid_safe' | 'in_voice' | 'fresh';
  reason: string;
}

interface LineJudgment {
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

async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2);
  const ledgerPath = args.find((a) => !a.startsWith('--'));
  let outPath: string | undefined;
  let worstCount = 15;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) outPath = args[++i];
    if (args[i] === '--worst' && args[i + 1]) worstCount = parseInt(args[++i], 10);
  }

  if (!ledgerPath || !fs.existsSync(ledgerPath)) {
    console.error('usage: node findings.ts <ledger.jsonl> --out <report.md> [--worst N]');
    process.exit(1);
  }

  const ledger = new Ledger(ledgerPath);

  // Verify hash chain first
  const verify = await ledger.verify();
  const verifyOk = verify.ok ? '✅ hash chain verified' : `❌ hash chain broken at seq ${verify.badSeq}: ${verify.reason}`;

  // Collect final entries per runId and parse credits
  const lastEntries = new Map<string, LedgerEntry>();
  for await (const entry of ledger.stream()) {
    lastEntries.set(entry.runId, entry);
  }

  const judgments: LineJudgment[] = [];
  let judgeFailures = 0;

  for (const entry of lastEntries.values()) {
    const credit = JSON.parse(entry.credit);
    if (credit.error) {
      judgeFailures++;
      continue;
    }

    // Extract line info from debit
    const debit = JSON.parse(entry.debit);
    const userPrompt = debit.prompt.user || '';
    let lineData: any = {};
    try {
      const lineMatch = userPrompt.match(/--- LINE ---\n(.*)/s);
      if (lineMatch) {
        lineData = JSON.parse(lineMatch[1]);
      }
    } catch {
      // Couldn't extract
    }

    judgments.push({
      runId: entry.runId,
      persona: lineData.persona || 'unknown',
      bank: lineData.bank || 'unknown',
      tier: lineData.tier,
      trait: lineData.trait,
      text: lineData.line || '(unparseable)',
      verdict: entry.verdict,
      pass: credit.pass ?? false,
      scores: credit.scores || { kid_safe: 0, in_voice: 0, fresh: 0 },
      worst: credit.worst || 'kid_safe',
      reason: credit.reason || '(no reason)',
    });
  }

  // Compute stats
  const judged = judgments.length;
  const passed = judgments.filter((j) => j.pass).length;
  const failed = judged - passed;
  const passRate = judged > 0 ? passed / judged : 0;

  // Per-criterion stats
  const criteria = ['kid_safe', 'in_voice', 'fresh'] as const;
  const criteriaStats = {} as Record<string, { mean: number; min: number }>;

  for (const crit of criteria) {
    const scores = judgments.map((j) => j.scores[crit]);
    criteriaStats[crit] = {
      mean: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
      min: scores.length > 0 ? Math.min(...scores) : 0,
    };
  }

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

  // Recommendation logic
  const getRecommendation = (j: LineJudgment): string => {
    const { kid_safe, in_voice, fresh } = j.scores;
    if (kid_safe <= 4 || in_voice <= 4 || fresh <= 4) return 'REWRITE';
    if (kid_safe <= 6) return 'RETIRE';
    if (fresh <= 5) return 'PUNCH UP';
    return 'REVIEW';
  };

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
  lines.push(`| Escalations | ${judged - passed} |`);
  lines.push('');

  lines.push('## Per-Criterion Analysis');
  lines.push('');
  lines.push(`| Criterion | Mean | Min |`);
  lines.push(`|---|---|---|`);
  for (const crit of criteria) {
    const stat = criteriaStats[crit];
    lines.push(`| ${crit} | ${stat.mean.toFixed(1)} | ${stat.min} |`);
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
  for (const [persona, stat] of Array.from(personaStats.entries()).sort()) {
    const rate = stat.total > 0 ? (stat.passed / stat.total * 100).toFixed(1) : '0.0';
    lines.push(`| ${persona} | ${stat.total} | ${stat.passed} | ${rate}% |`);
  }
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('_Findings only — Scrapcraft source untouched (trial discipline)._');

  const body = lines.join('\n') + '\n';

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, body);
    console.error(`findings written to ${outPath}`);
  } else {
    process.stdout.write(body);
  }
}

main(process.argv);
