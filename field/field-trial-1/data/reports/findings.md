# Companion Banter QC Findings

> ✅ hash chain verified

## Summary

| Metric | Value |
|---|---|
| Lines Judged | 506 |
| Passed | 457 |
| Failed | 49 |
| Pass Rate | 90.3% |
| Judge Failures | 0 |
| Escalations (gave up) | 0 |

## Per-Criterion Analysis

| Criterion | Mean | Min |
|---|---|---|
| kid_safe | 9.9 | 0 |
| in_voice | 8.5 | 0 |
| fresh | 7.5 | 0 |

## Worst Lines (top 15)

### ft1-L0072 · `rivet` / `banter.tier_up`

**Text:** ``

**Tier:** 0

**Scores:** kid_safe=0, in_voice=0, fresh=0

**Reason:** Empty string cannot be evaluated for safety, voice, or originality.

**Action:** `REWRITE`

### ft1-L0500 · `rivet` / `party.objections.rivet`

**Text:** `I like it! I also like other things! I like lots of things! Can I show you a thing after?`


**Scores:** kid_safe=10, in_voice=3, fresh=2

**Reason:** Generic filler repetition; no scrapyard specificity or hardware charm, could be any cartoon character.

**Action:** `REWRITE`

### ft1-L0300 · `magma` / `persona.magma.banter.repair_done`

**Text:** `The bot is loved-on and race-day ready. The difference between broken and repaired? A story with a good ending. This one has one now.`

**Tier:** 2

**Scores:** kid_safe=10, in_voice=2, fresh=4

**Reason:** Sounds like a greeting card, not a scrapyard robot. No hardware jokes or physical specificity.

**Action:** `REWRITE`

### ft1-L0499 · `rivet` / `party.objections.rivet`

**Text:** `Okay but consider: what if we did the fun version first?`


**Scores:** kid_safe=10, in_voice=2, fresh=4

**Reason:** Generic internet slang, no hardware or scrapyard flavor—could be any human character.

**Action:** `REWRITE`

### ft1-L0138 · `bolt` / `persona.bolt.banter.biome_first`

**Text:** `{biome}. Unfamiliar ground. I'll run the sightlines. Stay on my flank. Old habit, still a good one.`

**Tier:** 0

**Scores:** kid_safe=9, in_voice=3, fresh=4

**Reason:** Sounds like a grizzled military vet, not a playful scrapyard robot peer for kids.

**Action:** `REWRITE`

### ft1-L0016 · `rivet` / `banter.rare_loot`

**Text:** `Nice find! I'll remember where we got it. In case we need another. Or in case I need to visit it.`

**Tier:** 0

**Scores:** kid_safe=10, in_voice=4, fresh=3

**Reason:** Generic praise and filler could belong in any game; lacks scrapyard specificity.

**Action:** `REWRITE`

### ft1-L0137 · `bolt` / `persona.bolt.banter.biome_first`

**Text:** `First time in {biome}. I'll note the sightlines. Old habit. Can't turn it off.`

**Tier:** 0

**Scores:** kid_safe=9, in_voice=3, fresh=5

**Reason:** Tactical 'sightlines' sounds like a soldier, not a playful scrapyard robot peer.

**Action:** `REWRITE`

### ft1-L0173 · `bolt` / `persona.bolt.banter.ghost_beaten`

**Text:** `Another ghost off the board. You know what's left up there? Your name, and room to climb. That's the whole sport.`

**Tier:** 2

**Scores:** kid_safe=10, in_voice=3, fresh=4

**Reason:** Sounds like a gritty sports coach, not a scrapyard robot peer—no hardware, no counting, no physical specificity.

**Action:** `REWRITE`

### ft1-L0294 · `magma` / `persona.magma.banter.repair_done`

**Text:** `Repaired! The hammer is a loud tool with a gentle heart. You used it well.`

**Tier:** 0

**Scores:** kid_safe=10, in_voice=4, fresh=3

**Reason:** Loud tool with gentle heart is generic poetic filler, not a scrapyard robot observation.

**Action:** `REWRITE`

### ft1-L0480 · `magma` / `party.crosstalk.magma`

**Text:** `Hammer hour, witnessed and honored. The book grows wiser. So do we all.`


**Scores:** kid_safe=10, in_voice=3, fresh=4

**Reason:** Sounds like a fantasy sage, not a scrapyard robot peer. No hardware specificity or playful weirdness.

**Action:** `REWRITE`

### ft1-L0486 · `magma` / `party.crosstalk.magma`

**Text:** `Whatever we choose, small builders, I will hold things steady. That is always my part. It is a good part.`


**Scores:** kid_safe=10, in_voice=4, fresh=3

**Reason:** Generic reassurance filler lacking any scrapyard hardware specificity or playful robot weirdness.

**Action:** `REWRITE`

### ft1-L0171 · `bolt` / `persona.bolt.banter.ghost_beaten`

**Text:** `A ghost, retired. By you. The board updates, the memory stays. Both earned.`

**Tier:** 1
**Trait:** steely

**Scores:** kid_safe=9, in_voice=7, fresh=2

**Reason:** Vague dramatic filler about memory and earning things; lacks specific scrapyard hardware imagery.

**Action:** `REWRITE`

### ft1-L0182 · `bolt` / `persona.bolt.banter.repair_done`

**Text:** `Dents out. Good. Wounds close faster than reputations.`

**Tier:** 0

**Scores:** kid_safe=9, in_voice=7, fresh=2

**Reason:** Reputation quip is a tired cliché, not a specific scrapyard hardware image.

**Action:** `REWRITE`

### ft1-L0317 · `magma` / `persona.magma.ambient`

**Text:** `Rainy days are bench days, little one. Warm light, dry tools, slow hands. Some of my favorite builds were born rainy. The rain brings its own patience.`


**Scores:** kid_safe=10, in_voice=2, fresh=6

**Reason:** Sounds like a wise elder poet, not a playful scrapyard robot peer. No hardware specificity or robotic weirdness.

**Action:** `REWRITE`

### ft1-L0202 · `bolt` / `persona.bolt.observation`

**Text:** `The oval's empty. Laps don't run themselves. Believe me. I've waited. I've watched.`


**Scores:** kid_safe=7, in_voice=8, fresh=3

**Reason:** Melodramatic waiting cliché feels like a movie trailer, not a scrapyard robot's specific observation.

**Action:** `REWRITE`

## Per-Persona Summary

| Persona | Judged | Passed | Pass Rate |
|---|---|---|---|
| bolt | 132 | 117 | 88.6% |
| juno | 129 | 125 | 96.9% |
| magma | 127 | 103 | 81.1% |
| rivet | 118 | 112 | 94.9% |

---

_Findings only — Scrapcraft source untouched (trial discipline)._
