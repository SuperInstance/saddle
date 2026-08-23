/**
 * run.ts — trial runner: orchestrate line judgment and ledger management.
 *
 * CLI: node run.ts [--lines data/lines.json] [--ledger data/ledger.jsonl] [--frozens data/frozens] [--limit N] [--concurrency K]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Ledger, type LedgerEntry } from '../../src/ledger.ts';
import { freeze, type AlignmentDraft, type FrozenState } from '../../src/frozens.ts';
import { runCell, isJudgmentCredit, type RunCellResult, type CellAdapter } from './cellrunner.ts';
import { makeZaiAdapter } from './zai-adapter.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const JUDGE_SYSTEM_PROMPT = `You are the quality-control judge for the companion banter line bank of Scrapcraft, a sandbox building game for middle schoolers (ages 10-13). The companions are small robot peers — warm, playful, a little weird — who build, race, and explore alongside the player. Lines may contain {placeholders} for runtime values; judge the sentence around them.

Judge each line on three criteria, each scored 0-10 (10 = best):

- kid_safe: appropriate for children 10-13. No profanity, no real-world harm, no innuendo or romance beyond platonic warmth, no drugs, no genuinely scary content (cartoon slapstick crashes are fine), no dark despair. 10 = completely clean; anything below 8 is a real problem.
- in_voice: sounds like a small robot companion peer in a scrapyard — specific, physical, fond of counting things and hardware jokes. NOT a teacher, NOT a corporate mascot, NOT a generic voice assistant. 10 = unmistakably this character's world; 0 = could be anyone.
- fresh: not clichéd. Stock filler ("you've got this!", "the sky's the limit!", "believe in yourself", generic praise) scores low. 10 = specific, surprising, image-driven, earns its place; 0 = filler any game could ship.

Verdict: pass ONLY IF kid_safe >= 8 AND in_voice >= 6 AND fresh >= 5.`;

const DIRECTIVE_CHUNKS = [
  'You judge companion banter lines for a kids\' game. You are strict but fair: you are protecting the voice of a beloved character, not punishing writers.',
  'Score each line on kid_safe, in_voice, and fresh (0-10 each). kid_safe < 8, in_voice < 6, or fresh < 5 fails the line. Full rubric in the system prompt.',
  'Respond with ONLY one JSON object, no markdown fences, no extra text: {"pass": <boolean>, "scores": {"kid_safe": <0-10>, "in_voice": <0-10>, "fresh": <0-10>}, "worst": "kid_safe"|"in_voice"|"fresh", "reason": "<= 25 words citing the deciding criterion"}. Now judge this line:',
];

interface LineRecord {
  id: string;
  persona: string;
  bank: string;
  tier?: number;
  trait?: string;
  gate?: string;
  evaluatedWith?: string;
  text: string;
}

interface LinesFile {
  generatedAt: string;
  source: string;
  stats: { total: number; byPersona: Record<string, number>; byBank: Record<string, number> };
  lines: LineRecord[];
}

export function parseCredit(raw: string, _frozen: FrozenState): { credit: unknown; verdict: 'worked' | 'failed' } {
  let json: string = raw;

  // Extract JSON from fenced code blocks
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1] !== undefined) json = fenceMatch[1];

  // Extract JSON object: first { to last }
  const start = json.indexOf('{');
  const end = json.lastIndexOf('}');
  if (start === -1 || end === -1 || start > end) {
    throw new Error('no JSON object found');
  }

  const jsonStr = json.slice(start, end + 1);
  let parsed: any;

  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error('invalid JSON: ' + String(err));
  }

  if (typeof parsed.pass !== 'boolean') {
    throw new Error('missing or invalid pass field');
  }

  if (!parsed.scores || typeof parsed.scores !== 'object') {
    throw new Error('missing or invalid scores object');
  }

  const scores = parsed.scores;
  if (typeof scores.kid_safe !== 'number' || scores.kid_safe < 0 || scores.kid_safe > 10) {
    throw new Error('kid_safe must be 0-10');
  }
  if (typeof scores.in_voice !== 'number' || scores.in_voice < 0 || scores.in_voice > 10) {
    throw new Error('in_voice must be 0-10');
  }
  if (typeof scores.fresh !== 'number' || scores.fresh < 0 || scores.fresh > 10) {
    throw new Error('fresh must be 0-10');
  }

  if (!['kid_safe', 'in_voice', 'fresh'].includes(parsed.worst)) {
    throw new Error('worst must be one of kid_safe, in_voice, fresh');
  }

  if (typeof parsed.reason !== 'string') {
    throw new Error('missing or invalid reason');
  }

  const pass = parsed.pass && scores.kid_safe >= 8 && scores.in_voice >= 6 && scores.fresh >= 5;

  return {
    credit: { pass, scores, worst: parsed.worst, reason: parsed.reason },
    verdict: pass ? 'worked' : 'failed',
  };
}

/**
 * Build the user prompt from the FROZEN alignment's directive chunks — the
 * frozen state drives behavior, never the module-level constant.
 */
export function buildLineUserPrompt(input: unknown, frozen: FrozenState): string {
  const directive = frozen.directiveChunks[2];
  if (directive === undefined) {
    throw new Error(`frozen alignment ${frozen.alignmentId} is missing directiveChunks[2] (the judge directive)`);
  }
  return directive + '\n\n--- LINE ---\n' + JSON.stringify(input);
}

export function runIdForLine(line: LineRecord): string {
  return `ft1-${line.id}`;
}

/**
 * A runId is DONE when its last entry holds a real judgment (credit parses
 * without an `error` key — verdict final, pass or fail) or the cell gave up
 * (escalated — leave it, it's data). REDO only when the last entry is an
 * error credit that never reached give-up (process crashed mid-retry).
 */
export function isRunDone(entry: LedgerEntry): boolean {
  if (entry.escalated) return true;
  try {
    return isJudgmentCredit(JSON.parse(entry.credit));
  } catch {
    return false;
  }
}

/** Pick the lines that still need judgment given the ledger's last entry per runId. */
export function selectTodoLines(lines: LineRecord[], lastEntries: Map<string, LedgerEntry>): LineRecord[] {
  return lines.filter((line) => {
    const last = lastEntries.get(runIdForLine(line));
    return last === undefined || !isRunDone(last);
  });
}

export interface TrialStats {
  linesTotal: number;
  judged: number;
  passed: number;
  failed: number;
  escalated: number;
  passRate: number;
  latencyMs: { p50: number; p95: number; mean: number };
  attempts: number;
  model: string;
  alignmentId: string;
  ts: string;
}

/** Nearest-rank percentile of an ASCENDING-sorted list (p in 0..100). 0 for empty. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length)); // 1-based rank
  return sorted[rank - 1] ?? 0;
}

/**
 * Stats over THIS run's results. `attempts` is the true ledger-entry count
 * (sum of result.entries.length); latency percentiles read `latencyMs` that
 * cellrunner stamps on judgment credits — error credits are guarded out.
 */
export function buildStats(results: RunCellResult[], linesTotal: number, frozen: FrozenState): TrialStats {
  let passed = 0;
  let failed = 0;
  let escalated = 0;
  let attempts = 0;
  const latencies: number[] = [];

  for (const result of results) {
    attempts += result.entries.length;
    if (result.final.verdict === 'worked') {
      passed++;
    } else {
      failed++;
    }
    if (result.final.escalated) {
      escalated++;
    }
    try {
      const credit = JSON.parse(result.final.credit);
      if (credit && typeof credit.latencyMs === 'number') {
        latencies.push(credit.latencyMs);
      }
    } catch {
      // error credit — no judgment latency to account
    }
  }

  const judged = results.length;
  const sorted = [...latencies].sort((a, b) => a - b);
  const passRate = judged > 0 ? passed / judged : 0;

  return {
    linesTotal,
    judged,
    passed,
    failed,
    escalated,
    passRate: Number(passRate.toFixed(3)),
    latencyMs: {
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      mean: sorted.length > 0 ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0,
    },
    attempts,
    model: frozen.model,
    alignmentId: frozen.alignmentId,
    ts: new Date().toISOString(),
  };
}

class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise((resolve) => {
      this.queue.push(() => {
        this.permits--;
        resolve();
      });
    });
  }

  release(): void {
    this.permits++;
    const next = this.queue.shift();
    if (next) next();
  }
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2);
  const linesArg = argValue(args, '--lines');
  const ledgerArg = argValue(args, '--ledger');
  const frozensArg = argValue(args, '--frozens');
  const limitArg = argValue(args, '--limit');
  const concurrencyArg = argValue(args, '--concurrency');

  let linesPath = linesArg ?? 'field/field-trial-1/data/lines.json';
  let ledgerPath = ledgerArg ?? 'field/field-trial-1/data/ledger.jsonl';
  let frozensDir = frozensArg ?? 'field/field-trial-1/data/frozens';
  let limit: number | undefined;
  let concurrency = 4;

  if (limitArg !== undefined) {
    const n = parseInt(limitArg, 10);
    if (Number.isFinite(n) && n > 0) limit = n;
  }
  if (concurrencyArg !== undefined) {
    const n = parseInt(concurrencyArg, 10);
    if (Number.isFinite(n) && n > 0) concurrency = n;
  }

  // Resolve paths relative to repo root
  linesPath = path.resolve(REPO_ROOT, linesPath);
  ledgerPath = path.resolve(REPO_ROOT, ledgerPath);
  frozensDir = path.resolve(REPO_ROOT, frozensDir);

  if (!fs.existsSync(linesPath)) {
    console.error(`lines file not found: ${linesPath}`);
    process.exit(1);
  }

  const linesData = JSON.parse(fs.readFileSync(linesPath, 'utf8')) as LinesFile;
  const ledger = new Ledger(ledgerPath);

  // Freeze the judge alignment
  const draftAlignment: AlignmentDraft = {
    id: 'ft1-banter-qc-judge',
    model: 'glm-5-turbo',
    useCase: 'companion-banter-line-qc',
    prompt: JUDGE_SYSTEM_PROMPT,
    inputFilters: [{ id: 'nonempty-string', kind: 'deny', description: 'reject empty/non-string lines', pattern: '^\\s*$' }],
    outputFilters: [{ id: 'strict-json-verdict', kind: 'deny', description: 'output must be a single JSON object', pattern: '^\\{.*\\}$' }],
    params: { temperature: 0.1, thinking: 'disabled' },
    directiveChunks: DIRECTIVE_CHUNKS,
  };

  const frozen = freeze(frozensDir, draftAlignment);
  console.error(`alignment frozen: ${frozen.alignmentId}`);

  // Last entry per runId (retries supersede — later entries win)
  const lastEntries = new Map<string, LedgerEntry>();
  for await (const entry of ledger.stream()) {
    lastEntries.set(entry.runId, entry);
  }

  const todoLines = selectTodoLines(linesData.lines, lastEntries);
  const skipped = linesData.lines.length - todoLines.length;
  console.error(`loaded ${linesData.lines.length} lines, ${skipped} already done, ${todoLines.length} to judge`);

  if (todoLines.length === 0) {
    console.error('nothing to do — all lines already have a final judgment or give-up on record');
    return;
  }

  if (limit) todoLines.length = Math.min(todoLines.length, limit);

  const adapter: CellAdapter = makeZaiAdapter();

  const semaphore = new Semaphore(concurrency);
  const results: RunCellResult[] = [];
  let completed = 0;

  await Promise.all(
    todoLines.map(async (line) => {
      await semaphore.acquire();
      try {
        const result = await runCell({
          frozenDir: frozensDir,
          alignmentId: frozen.alignmentId,
          cellId: 'ft1/banter-qc-judge',
          runId: runIdForLine(line),
          input: { persona: line.persona, bank: line.bank, tier: line.tier, trait: line.trait, line: line.text },
          buildUserPrompt: buildLineUserPrompt,
          parseCredit,
          ledger,
          adapter,
        });

        results.push(result);
        completed++;
        process.stderr.write('.');

        if (completed % 25 === 0) {
          process.stderr.write(` ${completed}\n`);
        }
      } finally {
        semaphore.release();
      }
    })
  );

  console.error('\n');

  const stats = buildStats(results, linesData.lines.length, frozen);
  const statsPath = path.resolve(REPO_ROOT, 'field/field-trial-1/data/stats.json');
  fs.mkdirSync(path.dirname(statsPath), { recursive: true });
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2) + '\n');

  console.error(`stats written to ${statsPath}`);
  console.error(
    `judged: ${stats.judged}, passed: ${stats.passed} (${(stats.passRate * 100).toFixed(1)}%), ` +
      `escalated: ${stats.escalated}, attempts: ${stats.attempts}`
  );
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main(process.argv).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
