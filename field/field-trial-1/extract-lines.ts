#!/usr/bin/env node

/**
 * extract-lines.ts — extract companion banter lines from Scrapcraft modules.
 * Imports real Scrapcraft companion ESM modules (pure, zero deps).
 *
 * CLI: node extract-lines.ts [--src ../Scrapcraft/src/companion] [--out field/field-trial-1/data/lines.json]
 *
 * Relative --src/--out paths resolve against the REPO ROOT (this script lives
 * at <repo>/field/field-trial-1/), so outputs land inside the repo — never
 * one level above it.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractLines } from './walk.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root — this file is <repo>/field/field-trial-1/extract-lines.ts. */
export const REPO_ROOT = path.resolve(__dirname, '../..');

/** Resolve a CLI path against the repo root; absolute paths pass through. */
export function resolveRepoPath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(REPO_ROOT, p);
}

const DEFAULT_SRC = '../Scrapcraft/src/companion';
const DEFAULT_OUT = 'field/field-trial-1/data/lines.json';

async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2);
  let src = DEFAULT_SRC;
  let out = DEFAULT_OUT;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--src' && args[i + 1]) src = args[++i] as string;
    if (args[i] === '--out' && args[i + 1]) out = args[++i] as string;
  }

  const srcDir = resolveRepoPath(src);
  const outPath = resolveRepoPath(out);

  if (!fs.existsSync(srcDir)) {
    console.error(`error: companion source dir not found: ${srcDir}`);
    process.exit(1);
  }

  try {
    const banterPath = path.join(srcDir, 'banter.js');
    const personasPath = path.join(srcDir, 'personas.js');
    const partyPath = path.join(srcDir, 'party.js');

    const banterMod = await import(pathToFileURL(banterPath).href);
    const personasMod = await import(pathToFileURL(personasPath).href);
    const partyMod = await import(pathToFileURL(partyPath).href);

    const banter = banterMod.default ?? banterMod;
    const personas = personasMod.default ?? personasMod;
    const party = partyMod.default ?? partyMod;

    // Extract individual exports
    const BANTER = (banter as any).BANTER || banter;
    const TIER_UP_LINES = (banter as any).TIER_UP_LINES || {};
    const OBSERVATIONS = (banter as any).OBSERVATIONS || [];
    const RIVET_AMBIENT = (banter as any).RIVET_AMBIENT || [];
    const PERSONAS = (personas as any).PERSONAS || personas;
    const CROSSTALK = (party as any).CROSSTALK || {};
    const OBJECTIONS = (party as any).OBJECTIONS || {};

    const lines = extractLines(BANTER, TIER_UP_LINES, OBSERVATIONS, RIVET_AMBIENT, PERSONAS, {
      crosstalk: CROSSTALK,
      objections: OBJECTIONS,
    });

    const stats = {
      total: lines.length,
      byPersona: {} as Record<string, number>,
      byBank: {} as Record<string, number>,
    };

    for (const line of lines) {
      stats.byPersona[line.persona] = (stats.byPersona[line.persona] || 0) + 1;
      stats.byBank[line.bank] = (stats.byBank[line.bank] || 0) + 1;
    }

    const output = {
      generatedAt: new Date().toISOString(),
      source: srcDir,
      stats,
      lines,
    };

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');

    console.error(`extracted ${lines.length} lines`);
    console.error(`by persona: ${JSON.stringify(stats.byPersona)}`);
    console.error(`by bank: ${Object.keys(stats.byBank).length} banks`);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main(process.argv).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
