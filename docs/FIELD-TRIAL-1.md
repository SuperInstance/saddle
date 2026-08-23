# Field Trial 1 — Companion Banter Line QC

**Date:** 2026-08-23 · **Branch:** `field-trial` · **Cell:** `ft1/banter-qc-judge`
**Alignment:** `b51e0ea3c59090ad` (frozen, 0444) · **Model:** `glm-5-turbo` (thinking disabled, temp 0.1)

Saddle's first real workload. The harness managed alignment of a QC-judge cell
end-to-end: a frozen judge state scored the entire Scrapcraft companion line
bank against three criteria (kid-safe, in-voice, not-clichéd), every judgment
double-entered into a hash-chained ledger, and the nightcycle + findings
reports generated from the corpus. **Scrapcraft source untouched** — findings
only.

## The workflow, as run

```
extract-lines.ts ──▶ data/lines.json (506 lines, 4 personas, 108 banks)
        │
freeze(judge draft) ──▶ data/frozens/b51e0ea3c59090ad.json (0444, hash-verified)
        │
run.ts (cellrunner + zai adapter, concurrency 8)
   per line: debit = prompt + line + model + params
             credit = {pass, scores, worst, reason, latencyMs, attempts}
             verdict: pass→worked / fail→failed · give-up→escalated
        │
data/ledger.jsonl (506 entries, hash chain verified end-to-end)
        ├──▶ src/nightcycle.ts ──▶ reports/nightcycle.md (earned-keep)
        └──▶ findings.ts ───────▶ reports/findings.md (worst lines flagged)
```

## Corpus stats

| Metric | Value |
|---|---|
| Lines judged | **506** (rivet 118, bolt 132, magma 127, juno 129) |
| Passed / failed | 457 / 49 (**90.3% pass rate**) |
| Judge-cell failures (unparseable/transport) | 0 |
| Escalations (gave up) | 0 |
| Retries consumed | 0 (100% first-attempt parse rate) |
| Judge latency | p50 **2.68s** · p95 3.47s · mean 2.72s |
| Wall time | ~3.5 min at concurrency 8 |
| Ledger | 506 entries · 1.39 MB · chain verify ✅ |
| Criterion means (min) | kid_safe 9.9 (0¹) · in_voice 8.5 (0¹) · fresh 7.5 (0¹) |

¹ mins are dragged to 0 by L0072 — an intentionally-empty `{ tier: 0, line: '' }`
placeholder that lives in `banter.js`'s `tier_up` pool (source comment: "handled
below"). Extraction is faithful, so the judge saw it and correctly scored it
0/0/0. Treat that record as a source-hygiene finding, not a voice failure.

Two runs happened. The first (494 lines) was **discarded and re-run from a
fresh ledger** after the trial itself surfaced a walker bug (see foreman bug 7)
— the committed corpus is the clean 506-line run. Discarding was cheap because
the corpus is regenerable; the ledger discipline (never rewrite, start a new
book) was exercised for real.

## Headline findings for Scrapcraft (details in `field/field-trial-1/data/reports/findings.md`)

- **magma drifts "fantasy sage"** — worst persona at **81.1%** pass. Rain
  reveries, "the book grows wiser," greeting-card repair talk. The judge
  consistently flags missing hardware specificity.
- **bolt drifts "grizzled soldier/sports coach"** — 88.6% pass. "Stay on my
  flank," "sightlines," "wounds close faster than reputations."
- **rivet (94.9%) and juno (96.9%) are healthy.** Rivet's fails are generic
  praise filler ("Nice find!…"), not voice breaks.
- One line scored **kid_safe 7** (L0202, bolt, melodrama-not-menace) — nothing
  unsafe anywhere in the bank. The bank is clean; the failures are *voice*
  failures.
- 15 worst lines are flagged `REWRITE`/`RETIRE`/`PUNCH UP` with judge reasons
  in the findings report.

## The foreman pattern — CLI coder contributions

Heavy passes ran as tmux CLI coders under foreman direction (this trial was
executed in an isolated git worktree, `saddle-ft`, because parallel coders were
active in the main checkout — that isolation is itself a trial lesson).

| Pass | Coder | Contribution |
|---|---|---|
| 1 | `claude -p` (Sonnet) | Built `src/cellrunner.ts` + tests, full `field/field-trial-1/` harness (extract/walk, zai adapter, run, findings), 24 tests. Stopped once to ask sharp spec questions (answered headless on re-dispatch). |
| 2 | `opencode run --auto` | Hardening: all 6 foreman bugs fixed + own review found 4 more (findings escalations mislabel, all-done rerun requiring a key, test/import drift, `npm test` glob never running field tests). 55 tests. Also fixed pre-existing `tsc` errors in `ledger.ts`/`nightcycle.ts` source. |
| 3 | foreman (this agent) | Found + fixed walker bug 7 post-trial (textless records / dropped string banks), added regression test, re-ran the corpus clean. Ran the real API trial (only the foreman touches secrets). Wrote this doc. |

Bugs the field caught that unit tests didn't (each now has a regression test):

1. `escalated` conflated QC-fail with give-up — a failed *line* was marked as a
   failed *cell* (double-entry semantics bug, pass 2).
2. Valid-but-failing verdicts were re-judged on retry — double-spend (pass 2).
3. Resume logic re-judged every QC-failed line on rerun (pass 2).
4. Latency stats were dead code — never populated (pass 2).
5. Path resolution one level off — extractor wrote outside the repo (pass 2).
6. `buildUserPrompt` read the module constant, not the frozen state (pass 2).
7. Walker emitted a textless record for string banks and deduped the other 13
   objection lines away on `undefined` (foreman, post-trial — the *corpus*
   caught it: the judge scored a phantom line 0/0/0, which is how it surfaced).

## Honest gaps — the Saddle v3 feed

What the harness **lacked**, in rough priority order:

1. **Verdict semantics are overloaded.** `verdict: failed` means both "the line
   failed QC" (a *successful* judgment) and "the cell failed to judge"
   (distinguished only by `credit.error`). Worked, but implicit — v3 wants an
   explicit outcome split (cell-outcome vs judgment-outcome) or a documented
   credit contract per cell type.
2. **Earned-keep doesn't mean earned-keep for a judge cell.** Nightcycle's
   keepRatio measures the *bank's* quality, not the *alignment's* — a 90.3%
   pass rate says Scrapcraft's lines are good, not that the judge alignment is
   good. Different cell kinds need different earned-keep semantics (declare the
   metric in the frozen state).
3. **No token accounting.** The API returns `usage`; we drop it. The "cost
   side" of double-entry should carry real token counts (and eventually $), or
   the books understate the debit.
4. **Single judge, single opinion.** No quorum/cross-check judge, no
   temperature variance study — 90.3% is one model's reading. The corpus is
   built so a second judge can be run against the same frozen inputs and
   compared (that's the nightcycle's job).
5. **Chunked directive protocol degenerates single-shot.** Chunks 0–1 are
   prose restatements folded into the system prompt; the "dogfood the
   understanding before the action" turn doesn't exist for one-shot cells.
   Fine here; the protocol needs a single-shot profile.
6. **Resume done-ness requires credit inspection.** A runId is "done" iff its
   last credit parses without `error` — the completion state is inferred, not
   declared. v3: a cell-run status marker on entries.
7. **No cross-process ledger lock.** Single-writer-per-file held (one process),
   but two concurrent `run.ts` would interleave. Also no fsync — a crash can
   lose the tail. Fine for a cowboy, noted for the fleet.
8. **Typed walkers over untyped JS banks are fragile** (bug 7). v3:
   schema-validate extracted banks, and auto-flag structural surprises
   (textless records, empty strings) at extraction time instead of letting the
   judge discover them.
9. **`response_format: json_object` unused** — portability chosen over
   strictness; 100% parse rate made it moot this time. Worth a frozen param.
10. **Repo hygiene at trial start:** `npm test` glob didn't run field tests
    (fixed in pass 2), and `tsc --noEmit` was not green on main (source fixed
    in pass 2; two test-file errors remain, out of scope). A trial should start
    from a green baseline — add a preflight.

## Did the harness earn its keep?

Yes, by its own doctrine: the corpus is **regenerable, tamper-evident, and
reproducible** — the frozen judge can be re-thawed and any line re-judged with
byte-identical inputs; the ledger answers "what was the dog wearing when it
did that work" for all 506 judgments; and the trial *paid for itself in bug
finds* (7 real harness bugs, every one now regression-tested). The corpus
(1.39 MB, 506 double-entries) is the seed the night cycles will crunch.

## Reproduce

```bash
npm test
node field/field-trial-1/extract-lines.ts
ZAI_API_KEY=… node field/field-trial-1/run.ts --concurrency 8   # resume-safe
node src/nightcycle.ts field/field-trial-1/data/ledger.jsonl --out field/field-trial-1/data/reports/nightcycle.md
node field/field-trial-1/findings.ts field/field-trial-1/data/ledger.jsonl --out field/field-trial-1/data/reports/findings.md
```
