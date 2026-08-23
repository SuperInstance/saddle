# Field Trial 1: Companion Banter Line QC

Testing Saddle on a real fleet task: quality-control judgment of companion banter lines from Scrapcraft (a kids' voxel game) using a cheap LLM as a judge.

## Architecture

The trial workflow follows the **Roundup Loop**: reflex (pincher) → ledger → alignment → night cycles → cells → quilt.

**Saddle's role:** manage alignment (judge system prompt + scoring criteria), instrument every inference with double-entry bookkeeping (debit = full prompt + input + model params; credit = judge output), and log to a tamper-evident hash-chained ledger.

## Components

### Core: `cellrunner.ts`

Generic cell runner: orchestrates inference (with retries) and ledger management. The payload is injected (adapter + parseCredit function), so no model calls live in core.

- **Semantics:**
  - Thaw frozen alignment (throws on hash mismatch)
  - Build user prompt from input + frozen state
  - Time the adapter call
  - Parse output (throw to retry or reject)
  - Log to ledger (every attempt, chain verified)
  - Resume on non-escalated failures; give up after maxAttempts

### Field Harness: `field/field-trial-1/`

#### `walk.mjs` — pure line extraction functions

Exported: `extractLines(banterMod, tierUpMod, observationsMod, rivetAmbientMod, personasMod, partMod) → lines[]`

Testable in isolation (takes module objects, not live imports). Dedupes lines by exact text; first-seen wins.

#### `extract-lines.mjs` — production line extractor

CLI: `node extract-lines.mjs [--src ../Scrapcraft/src/companion] [--out field/field-trial-1/data/lines.json]`

Imports real Scrapcraft companion modules and walks them via `walk.mjs`. Outputs `lines.json` with deduped line records (id, persona, bank, tier?, trait?, gate?, evaluatedWith?, text) + stats.

#### `zai-adapter.ts` — network-facing Z.ai client

The ONLY module that calls external APIs. Wraps Z.ai chat completions API with:
- Concurrency control (semaphore, default 8)
- Timeout handling (AbortController, default 30s)
- Error propagation (HTTP >= 400 throws)
- Key management (ZAI_API_KEY or FLEET_GATEWAY__PROVIDERS__ZAI__KEYS)

Exported: `makeZaiAdapter(opts?) → CellAdapter`

#### `run.ts` — trial runner

CLI: `node run.ts [--lines data/lines.json] [--ledger data/ledger.jsonl] [--frozens data/frozens] [--limit N] [--concurrency K]`

Orchestration:
1. Freeze the judge alignment (system prompt + filtering rules + params + directive chunks)
2. Load lines.json
3. Resume-safe: stream existing ledger, skip runIds that already have a final (non-retry-pending) entry
4. Concurrently judge each line via `cellrunner.runCell()`
5. Log progress and stats to stderr
6. Write stats.json (judged count, pass rate, latency percentiles, model, alignmentId)

**Judge system prompt:** evaluates lines on three criteria (0-10 each):
- **kid_safe:** age-appropriate, no profanity/harm/innuendo (pass iff ≥ 8)
- **in_voice:** sounds like a small robot peer in a scrapyard (pass iff ≥ 6)
- **fresh:** not clichéd stock filler (pass iff ≥ 5)

**Verdict:** pass only if ALL three pass thresholds.

#### `findings.ts` — findings report

CLI: `node findings.ts data/ledger.jsonl --out data/reports/findings.md [--worst 15]`

Streams ledger, keeping only the last entry per runId (supersedes retries). Skips judge-failure entries (credit.error).

Output: markdown report with:
- Summary (judged / passed / failed / pass rate / judge failures)
- Per-criterion mean / min scores
- Worst N lines by (total score, tiebreak by min criterion)
  - Scores and judge reason for each
  - Recommendation: REWRITE (any criterion ≤ 4), RETIRE (kid_safe ≤ 6), PUNCH UP (fresh ≤ 5), REVIEW (else)
- Per-persona pass-rate table
- Ledger hash-chain verification status

## Ledger & Resumption

Each judgment attempt → one ledger entry. Entries have:
- **debit:** full cost (prompt system + user, input, model, params, adapter name)
- **credit:** output (pass/scores/reason or error)
- **verdict:** 'worked' or 'failed'
- **escalated:** true only on final give-up (all retries exhausted)
- **retryOf:** seq of previous attempt (if a retry)

A runId is **done** if its last ledger entry is either success or escalated. Resume checks this before re-running.

## Testing (no network)

`npm test` — runs all tests including:
- `test/cellrunner.test.ts` — core retry logic, ledger chain verification, tamper detection
- `field/field-trial-1/run.test.ts` — parseCredit JSON parsing, alignment freeze/thaw, line extraction, findings generation

Tests use temporary directories and fake module objects; no external API calls.

## Running the Trial

```bash
# 1. Extract lines from Scrapcraft
node field/field-trial-1/extract-lines.mjs --src ../Scrapcraft/src/companion

# 2. Run judgments (requires Z.ai API key)
export ZAI_API_KEY="your-key"
node field/field-trial-1/run.ts

# 3. Generate findings
node field/field-trial-1/findings.ts field/field-trial-1/data/ledger.jsonl --out field/field-trial-1/data/reports/findings.md

# 4. Night cycle (existing saddle runner — trial discipline, no retraining in this repo)
node src/nightcycle.ts field/field-trial-1/data/ledger.jsonl --out field/field-trial-1/data/reports/nightcycle.md
```

## Trial Discipline

- ✅ Extract lines from Scrapcraft source (no mutations)
- ✅ Append to ledger (no rewrites, tamper-evident chain)
- ✅ Log every attempt (retry logic visible)
- ✅ Park findings (no source edits from trial runner — cowboy edits via harness)
- ✅ Zero secrets (API key from env only, never logged)
