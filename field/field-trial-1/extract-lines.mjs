#!/usr/bin/env node

/**
 * extract-lines.mjs — extract companion banter lines from Scrapcraft modules.
 * Imports real Scrapcraft companion ESM modules (pure, zero deps).
 *
 * CLI: node extract-lines.mjs [--src ../Scrapcraft/src/companion] [--out data/lines.json]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractLines } from './walk.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(argv) {
  const args = argv.slice(2);
  let src = '../Scrapcraft/src/companion';
  let out = 'field/field-trial-1/data/lines.json';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--src' && args[i + 1]) src = args[++i];
    if (args[i] === '--out' && args[i + 1]) out = args[++i];
  }

  // Resolve paths relative to script location
  const srcDir = path.isAbsolute(src) ? src : path.resolve(__dirname, '../../..', src);
  const outPath = path.isAbsolute(out) ? out : path.resolve(__dirname, '../../..', out);

  if (!fs.existsSync(srcDir)) {
    console.error(`error: companion source dir not found: ${srcDir}`);
    process.exit(1);
  }

  try {
    const banterPath = path.join(srcDir, 'banter.js');
    const personasPath = path.join(srcDir, 'personas.js');
    const partyPath = path.join(srcDir, 'party.js');

    const banter = (await import(new URL(banterPath, 'file://').href)).default || (await import(new URL(banterPath, 'file://').href));
    const personas = (await import(new URL(personasPath, 'file://').href)).default || (await import(new URL(personasPath, 'file://').href));
    const party = (await import(new URL(partyPath, 'file://').href)).default || (await import(new URL(partyPath, 'file://').href));

    // Extract individual exports
    const BANTER = banter.BANTER || banter;
    const TIER_UP_LINES = banter.TIER_UP_LINES || {};
    const OBSERVATIONS = banter.OBSERVATIONS || [];
    const RIVET_AMBIENT = banter.RIVET_AMBIENT || [];
    const PERSONAS = personas.PERSONAS || personas;
    const CROSSTALK = party.CROSSTALK || {};
    const OBJECTIONS = party.OBJECTIONS || {};

    const lines = extractLines(BANTER, TIER_UP_LINES, OBSERVATIONS, RIVET_AMBIENT, PERSONAS, { crosstalk: CROSSTALK, objections: OBJECTIONS });

    const stats = {
      total: lines.length,
      byPersona: {},
      byBank: {},
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
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}

main(process.argv);
