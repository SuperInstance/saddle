/**
 * run.ts — trial runner: orchestrate line judgment and ledger management.
 *
 * CLI: node run.ts [--lines data/lines.json] [--ledger data/ledger.jsonl] [--frozens data/frozens] [--limit N] [--concurrency K]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ledger, type LedgerEntry } from '../../src/ledger.ts';
import { freeze, type AlignmentDraft, type FrozenState } from '../../src/frozens.ts';
import { runCell } from '../../src/cellrunner.ts';
import { makeZaiAdapter } from './zai-adapter.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

interface ParsedCredit {
  pass: boolean;
  scores: { kid_safe: number; in_voice: number; fresh: number };
  worst: 'kid_safe' | 'in_voice' | 'fresh';
  reason: string;
  latencyMs?: number;
  model?: string;
}

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

function parseCredit(raw: string, frozen: FrozenState): { credit: unknown; verdict: 'worked' | 'failed' } {
  let json: string = raw;

  // Extract JSON from fenced code blocks
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) json = fenceMatch[1];

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

async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2);
  let linesPath = 'field/field-trial-1/data/lines.json';
  let ledgerPath = 'field/field-trial-1/data/ledger.jsonl';
  let frozensDir = 'field/field-trial-1/data/frozens';
  let limit: number | undefined;
  let concurrency = 4;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lines' && args[i + 1]) linesPath = args[++i];
    if (args[i] === '--ledger' && args[i + 1]) ledgerPath = args[++i];
    if (args[i] === '--frozens' && args[i + 1]) frozensDir = args[++i];
    if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[++i], 10);
    if (args[i] === '--concurrency' && args[i + 1]) concurrency = parseInt(args[++i], 10);
  }

  // Resolve paths relative to repo root
  linesPath = path.resolve(linesPath);
  ledgerPath = path.resolve(ledgerPath);
  frozensDir = path.resolve(frozensDir);

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

  // Collect runIds already done (have a final entry)
  const doneRunIds = new Set<string>();
  for await (const entry of ledger.stream()) {
    // A runId is done if it's the last entry for that runId
    // We'll rebuild this more carefully below
    doneRunIds.add(entry.runId);
  }

  // More accurate: build a map of runId → last entry
  const lastEntries = new Map<string, LedgerEntry>();
  for await (const entry of ledger.stream()) {
    lastEntries.set(entry.runId, entry);
  }

  // A runId is done if its last entry is either success or escalated
  const todoLines: LineRecord[] = [];
  for (const line of linesData.lines) {
    const runId = `ft1-${line.id}`;
    const lastEntry = lastEntries.get(runId);
    if (!lastEntry || (!lastEntry.escalated && lastEntry.verdict === 'failed')) {
      // Either new or failed non-final (should retry)
      todoLines.push(line);
    }
  }

  const skipped = linesData.lines.length - todoLines.length;
  console.error(`loaded ${linesData.lines.length} lines, ${skipped} already done, ${todoLines.length} to judge`);

  if (limit) todoLines.length = Math.min(todoLines.length, limit);

  // Create adapter (will throw if no API key, which is fine for tests)
  let adapter;
  try {
    adapter = makeZaiAdapter();
  } catch (err) {
    console.error(`warning: adapter init failed (tests may use mock): ${err}`);
    process.exit(1);
  }

  const semaphore = new Semaphore(concurrency);
  const latencies: number[] = [];
  let judged = 0;
  let passed = 0;
  let failed = 0;
  let escalated = 0;

  await Promise.all(
    todoLines.map(async (line) => {
      await semaphore.acquire();
      try {
        const runId = `ft1-${line.id}`;
        const result = await runCell({
          frozenDir: frozensDir,
          alignmentId: frozen.alignmentId,
          cellId: 'ft1/banter-qc-judge',
          runId,
          input: { persona: line.persona, bank: line.bank, tier: line.tier, trait: line.trait, line: line.text },
          buildUserPrompt: (input, frozen) => {
            return DIRECTIVE_CHUNKS[2] + '\n\n--- LINE ---\n' + JSON.stringify(input);
          },
          parseCredit,
          ledger,
          adapter,
        });

        if (result.final.verdict === 'worked') {
          passed++;
        } else {
          failed++;
        }

        if (result.final.escalated) {
          escalated++;
        }

        judged++;
        process.stderr.write('.');

        if (judged % 25 === 0) {
          process.stderr.write(` ${judged}\n`);
        }

        const credit = JSON.parse(result.final.credit);
        if (credit.latencyMs) latencies.push(credit.latencyMs);
      } finally {
        semaphore.release();
      }
    })
  );

  console.error('\n');

  // Compute stats
  const passRate = judged > 0 ? passed / judged : 0;
  const p50 = latencies.length > 0 ? latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.5)] : 0;
  const p95 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0;
  const meanLatency = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;

  const stats = {
    linesTotal: linesData.lines.length,
    judged,
    passed,
    failed,
    escalated,
    passRate: Number(passRate.toFixed(3)),
    latencyMs: { p50, p95, mean: meanLatency },
    attempts: judged + failed, // rough count
    model: frozen.model,
    alignmentId: frozen.alignmentId,
    ts: new Date().toISOString(),
  };

  const statsPath = path.resolve('field/field-trial-1/data/stats.json');
  fs.mkdirSync(path.dirname(statsPath), { recursive: true });
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2) + '\n');

  console.error(`stats written to ${statsPath}`);
  console.error(`judged: ${judged}, passed: ${passed} (${(passRate * 100).toFixed(1)}%), escalated: ${escalated}`);
}

main(process.argv);
