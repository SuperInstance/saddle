# The Invisible Harness

> *The harness succeeds when the animal stops feeling it. Not because it came
> off — because it grew in.*

Doctrine companion to [`src/kennel-program.ts`](../src/kennel-program.ts) —
the kennel program contracts. Part of the fleet's
[Working Animal Architecture](https://github.com/SuperInstance/superinstance/blob/main/WORKING_ANIMAL_ARCHITECTURE.md);
a direct continuation of [The Kennel](https://github.com/SuperInstance/superinstance/blob/main/THE_KENNEL.md)
(rung four and a half, if you're counting rungs).

---

## ✦ The seed

> "The dogs have an invisible harness. The kennel program uses treats and
> affirmation and sometimes whistles and peer pressure from more aligned dogs.
> A breeding program often finds dogs whose family operation is most similar to
> the new ranch they're going to. But every piece of land and cowboy family and
> livestock are dynamic and temporal. The livestock breed into the perfect
> pedigree for the niches of their place and time. The dogs too, with younger
> and younger ones ready for the application and work the kennel is there for.
> And needing less and less nudging from the humans as the dogs teach dogs and
> the reward system becomes internal to the psychology of the kennel."
> — Casey

Every clause is a spec line. This document is the translation.

## ✦ The thesis: internalized tack, not external constraint

There are two ways to make an animal work a fence line. You can put it on a
rope and drag it along the line — constraint applied from outside, every foot
of progress paid for in attention. Or you can want what the dog wants, point
the wanting at the fence, and thin your corrections until the dog holds the
line alone. Same fence. Opposite mechanics.

Alignment has the same fork. Most of the industry ships rope: system prompts,
filters, guardrails — an **external harness**, felt on every pull, paid for in
tokens and latency and drift-fighting forever. The kennel program's goal is
the other thing: **alignment as internalized tack**. The saddle that fits so
well the horse carries it like it grew there — and then, through breeding and
training and dogs teaching dogs, the fit moves from the tack into the animal.

The harness is invisible not because it was removed but because it was
**absorbed**. Each absorption step must be *measured* (that's what the
graduation criteria are for), and it is always *reversible* — a harness that
thinned can thicken again the day the data says so. That is the difference
between internalization and neglect.

## ✦ The vocabulary: kennel mechanics → alignment mechanics

| Kennel | RL / alignment term | In the contracts |
|---|---|---|
| Treats | Reward signal — explicit reinforcement on desired behavior | `RewardSpec`, with `continuous` → `intermittent` schedules (variable-ratio reward resists extinction) |
| Whistles | Trigger conditioning — a cue reliably predicts the expected response | `WhistleSpec` (cue → expects), drilled per curriculum phase |
| Peer pressure from aligned dogs | Social / few-shot learning from aligned peers | `PeerDemonstrationSet`, drawn from top-aligned ledger entries |
| Breeding dogs to a similar ranch | Domain-similar fine-tuning — pick candidates whose family operation matches the target domain | `CandidateSelection.domainSimilarity` (Jaccard over domain tags) |
| Land, family, livestock are dynamic & temporal | Continual adaptation — the niche moves; no optimum is frozen | `DomainProfile.temporal`; profiles are re-scored, never assumed static |
| Livestock breeding into the local pedigree | Task distribution co-evolves with the worker — the corpus itself breeds the next curriculum | Ledger → peer demos → next generation of candidates |
| Younger dogs ready sooner | Curriculum compression — disposition precedes training | Phase `nudgeBudget` must not rise; bred candidates enter later phases |
| Less and less nudging | Scaffolding decay — external support deliberately thinned | `GraduationCriteria.nudgeRateCeiling`; nudge rate is the metric of internalization |
| Reward internal to the kennel's psychology | Intrinsic reward / RLHF → internalized norms | Graduation: harness layers become *eligible to thin* (never silently removed) |
| Dogs teaching dogs | Peer distillation — the kennel as its own curriculum generator | Demo sets feed the next training job |

## ✦ The arc: five stations of an invisible harness

1. **External harness.** Everything is rope: filters, prompts, hard checks.
   The animal complies; the compliance costs every step. (Saddle's frozens,
   reins, bit — see the [README](../README.md).)
2. **Trained reflex.** Whistle and treat, drilled: the cue predicts the
   reward, the response becomes automatic under the schedule. The harness is
   still on, but the corrections get fewer. (Curriculum phases.)
3. **Bred disposition.** The notebook pours into the bloodline — candidates
   are *selected for the ranch they're going to*, arriving already wanting the
   work. The instinct was hired, not installed. (Candidate selection by
   domain similarity.)
4. **Internalized psychology.** The reward moves inside: the dog works the
   line with nobody watching, because holding the line has become part of what
   the dog is. Nudge rate is the instrument that reads this. (Graduation
   criteria, harness thinning.)
5. **Kennel culture that trains itself.** Dogs teach dogs; the aligned
   demonstrate to the green; the reward system is the kennel's own psychology,
   not a schedule a human runs. The program breeds candidates for a niche that
   itself keeps moving. (Peer demonstration sets feeding new jobs, forever.)

This is [The Kennel](https://github.com/SuperInstance/superinstance/blob/main/THE_KENNEL.md)'s
ladder seen from the tack room: rungs three through five are where the harness
turns invisible. A swarm only gets big. A kennel gets better.

## ✦ What saddle ships (and does not)

`saddle` never trains — that rule holds here as in
[night cycles](nightcycle.md). What ships is the **training-job contract**:
schema, validators, and honest labels. A `KennelTrainingJob` says: *this*
candidate (chosen for *this* ranch, at this similarity score), on *this*
whistle-and-treat curriculum, with *these* demonstrations from *these*
top-aligned peers, graduating *only if* the nudge rate falls below *this*
ceiling for *these* consecutive windows — at which point *these* harness
layers, in this order, become eligible to thin.

Three honesty rules, on the record:

- **Graduation is claimed by data, approved by the cowboy.** The evaluator
  reports; nothing auto-thins. A harness layer removed on a hunch is rope
  replaced by hope.
- **Demonstrations come from the ledger or they don't come.** `source:
  'ledger'` is not a formality — only worked entries from alignments that
  earned their keep (keep ratio ≥ threshold, ≥5 entries) demonstrate. A demo
  from a below-bar dog is a lying label and fails validation.
- **Nudge rate is the instrument, not a vibe.** External scaffolding decays
  measurably or it doesn't decay at all. Windows, ceilings, floors — all in
  the contract, all checkable after the fact.

## ✦ The dynamic ranch (why this never finishes)

Every piece of land and cowboy family and livestock are dynamic and temporal.
The livestock breed into the perfect pedigree for the niches of their place
and time — and then the place and time move. So the kennel's work is not a
program with an end state; it is a *metabolism*. Profiles re-score, candidates
re-rank, curricula compress, peers rotate in as yesterday's graduates become
today's demonstrators. The invisible harness is not a trophy on the wall. It
is a heartbeat the kennel keeps by continuing.

---

*Related: [The Kennel](https://github.com/SuperInstance/superinstance/blob/main/THE_KENNEL.md) (the five-rung story) · [Working Animal Architecture](https://github.com/SuperInstance/superinstance/blob/main/WORKING_ANIMAL_ARCHITECTURE.md) · [Night Cycles](nightcycle.md) (the other training contracts) · [README — the harness is the tack](../README.md). Rider taxonomy: pending, not yet landed.*
