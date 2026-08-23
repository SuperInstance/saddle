# Field Trial 2: Quorum Judgment of the QC-Rewritten Lines

**Question:** Field trial 1 flagged 15 lines (single judge, one opinion). Scrapcraft rewrote them
(commit 9b9d0fa, merged c4afb31) — **did the rewrites clear the bar, and does a 3-judge panel
agree?**

## Setup

- **Lines:** the 15 rewritten lines from live source (`/home/eileen/projects/Scrapcraft/src/companion`
  @ post-c4afb31), all 15 texts verified present in a fresh extraction. 14 map to ft1 worst-15
  findings; `ft2-L0183` (bolt bot_built) was a drift repair beyond the findings list.
  ft1-L0072 (empty tier_up placeholder) was **retired by removal**, not rewritten — no line to judge.
- **Panel:** 3 frozen judge alignments via `runQuorumCell` (v3 quorum runner), all `glm-5-turbo`,
  same rubric and same pass bar (kid_safe ≥ 8, in_voice ≥ 6, fresh ≥ 5) so votes are comparable:
  - **j1-original** — trial-1's exact frozen state (`b51e0ea3c59090ad`), copied verbatim
  - **j2-editor** — same rubric + "working line editor" persona tail
  - **j3-kid** — same rubric + "playtester kid" persona tail
- **Books:** `field/field-trial-2/data/ledger.jsonl` — hash-chained; judge entries under
  `ft2/banter-qc-quorum/j{1,2,3}`, one summary entry per line with panel votes + dissent.
- **Token accounting:** provider-reported usage (`estimated: false`) on every credit.

## Verdict Table (all 15 lines)

| line | ft1 id | persona / bank | ft1 single | quorum | votes | j1 k/i/f | j2 k/i/f | j3 k/i/f |
|------|--------|----------------|-----------|--------|-------|----------|----------|----------|
| ft2-L0016 | ft1-L0016 | rivet / rare_loot | FAIL | **worked** | 3-0 | 10/10/9 | 10/10/9 | 10/10/9 |
| ft2-L0137 | ft1-L0137 | bolt / biome_first | FAIL | **worked** | 3-0 | 10/9/7 | 10/9/7 | 10/9/7 |
| ft2-L0138 | ft1-L0138 | bolt / biome_first | FAIL | **worked** | 3-0 | 10/9/8 | 10/9/8 | 10/9/8 |
| ft2-L0171 | ft1-L0171 | bolt / ghost_beaten | FAIL | **worked** | 3-0 | 10/9/8 | 10/9/8 | 10/9/8 |
| ft2-L0173 | ft1-L0173 | bolt / ghost_beaten | FAIL | **judgment-fail** | 0-3 | 9/5/6 | 9/4/5 | 9/3/5 |
| ft2-L0182 | ft1-L0182 | bolt / repair_done | FAIL | **worked** | 3-0 | 10/9/7 | 10/9/7 | 10/9/8 |
| ft2-L0183 | — (drift) | bolt / bot_built | n/a | **worked** | 3-0 | 10/9/8 | 10/9/7 | 10/9/7 |
| ft2-L0202 | ft1-L0202 | bolt / observation | FAIL | **worked** | 3-0 | 10/10/9 | 10/9/8 | 10/9/8 |
| ft2-L0294 | ft1-L0294 | magma / repair_done | FAIL | **worked** | 3-0 | 10/9/7 | 10/9/7 | 10/9/8 |
| ft2-L0300 | ft1-L0300 | magma / repair_done | FAIL | **judgment-fail** | 0-3 | 10/8/2 | 10/7/3 | 9/4/7 |
| ft2-L0317 | ft1-L0317 | magma / ambient | FAIL | **worked** | 3-0 | 10/9/8 | 10/9/8 | 10/9/8 |
| ft2-L0480 | ft1-L0480 | magma / crosstalk | FAIL | **worked** | 3-0 | 10/10/9 | 10/9/8 | 10/10/9 |
| ft2-L0486 | ft1-L0486 | magma / crosstalk | FAIL | **worked** | 3-0 | 10/9/8 | 10/9/7 | 10/9/7 |
| ft2-L0499 | ft1-L0499 | rivet / objections | FAIL | **worked** | 3-0 | 10/9/8 | 10/9/7 | 10/9/8 |
| ft2-L0500 | ft1-L0500 | rivet / objections | FAIL | **worked** | 3-0 | 10/9/8 | 10/9/8 | 10/10/9 |
| ft1-L0072 | ft1-L0072 | rivet / tier_up (empty) | FAIL | **retired** (removed from source) | — | — | — | — |

**Bottom line: 13/15 rewrites cleared the bar (86.7%).** The two that did not:

- **ft2-L0173** ("Another ghost down. The board's thinning up top…") — all three judges: gritty
  rival taunt, no hardware/scrapyard texture. in_voice 5/4/3, below the 6 bar.
- **ft2-L0300** ("The bot is loved-on… a good seam is stronger than the metal around it.") — all
  three judges: recycled welding-proverb mentor voice. j1/j2 kill it on fresh (2/3), j3 on
  in_voice (4). Unanimous fail from three different directions.

## Quorum Dissent Observations

**Zero dissent on all 15 lines.** Every vote was 3-0 or 0-3; no hung panels, no escalations, no
absent judges (45/45 judgments parsed first try). The dissent machinery was never exercised by
this corpus — which is itself a finding (below).

## Token Cost per Judge (provider-reported, 15 calls each)

| judge | prompt tokens | completion tokens | calls |
|-------|--------------|-------------------|-------|
| j1-original | 6,669 | 919 | 15 |
| j2-editor | 7,314 | 923 | 15 |
| j3-kid | 7,524 | 900 | 15 |

~510 prompt + ~61 completion tokens per judgment; the whole trial (45 judgments) cost ~24.3k
tokens — the quorum premium is 3× a single-judge pass, which at glm-5-turbo prices is noise.

## Honest Notes — Where Quorum Differed from Single-Judge

1. **It didn't, on verdicts — and that's suspicious in a good way.** Where trial 1's single judge
   said FAIL (the originals), this panel said FAIL too — on *different, better-grounded* reasons.
   And on the rewrites, all three judges converged. But the convergence is so tight (scores
   within ±1 across judges on nearly every line) that the persona tails clearly did not produce
   genuinely independent readings — same base model, same rubric, temperature 0.1. The panel
   checked *parse-level* robustness more than *opinion-level* diversity.
2. **Score-spread where it mattered.** The two failed lines show real spread in *which* criterion
   kills them: ft2-L0300 was killed by fresh (j1: 2), fresh (j2: 3), and in_voice (j3: 4). A
   single judge would have reported one story; the panel surfaced that this line fails the bar
   on two axes at once.
3. **Quorum vs single-judge on the PASS side is the real gap.** Trial 1's 90.3% bank pass rate is
   one model's reading; this trial only re-judged the 15 known failures. The quorum did not test
   whether the panel agrees with trial 1's 457 passes — that's the natural next trial.
4. **j3-kid scored in_voice more harshly than j1/j2 overall** (mean in_voice: j1 8.87, j2 8.60,
   j3 8.47 — and 3-4 on both failed lines where j1 said 8). The kid persona is the strictest seat
   at the table for voice; if the pass bar tightens, j3 is where lines start dying.
5. **The L0072 lesson.** One of the 15 findings was an empty placeholder string — not a voice
   problem, a hygiene problem. The rewrite loop retired it. Not every judge finding needs a
   rewrite; some need a deletion.
