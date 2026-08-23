<div align="center">

# 🤠 SADDLE

```
 ███████╗ █████╗ ████████╗██╗██╗     
 ██╔════╝██╔══██╗╚══██╔══╝██║██║     
 ███████╗███████║   ██║   ██║██║     
 ╚════██║██╔══██║   ██║   ██║██║     
 ███████║██║  ██║   ██║   ██║███████╗
 ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝╚══════╝
        the cowboy's gear ·
  harness toolkit for the fleet
```

**The general-purpose, highly-functional harness toolkit.** Pincher is the nerve.
Saddle is the gear the cowboy rides with.

[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![typescript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](./tsconfig.json)
[![node](https://img.shields.io/badge/node-%3E%3D22.18-green.svg)](./package.json)
[![tests](https://img.shields.io/badge/tests-node--test-blue)](./test)

</div>

---

## ✦ What is Saddle?

Saddle is the harness side of the fleet's working-animal system. It works **WITH**
[pincher](https://github.com/SuperInstance/pincher) (the reflex shell — pinch in,
match a reflex, execute, <50ms, no LLM). Pincher catches the reflexes. Saddle is
everything the cowboy does with what those reflexes teach us:

1. **ACCUMULATE** — data on good and bad model responses. Pincher catches
   reflexes; saddle logs outcomes into a structured, append-only corpus
   ([the ledger](#-the-ledger)).
2. **ALIGNMENT MANAGEMENT** — per model, per job: system-prompt variants, input
   filters, output filters, instructions sent in **PIECES** so the model
   dogfoods understanding before an action is requested (the chunked directive
   protocol), and **FROZEN STATES** — snapshotted alignment bundles
   (prompt + filters + params) pinned to specific use cases
   ([frozens](#-frozen-states)).
3. **NIGHT CYCLES** — scheduled training passes
   ([docs/nightcycle.md](docs/nightcycle.md)):
   - **(a)** Isaac-like sim/shadow training methods
   - **(b)** crunching the accumulated corpus for LoRA / micro-model training
   - **(c)** **CELL DECOMPOSITION** — break larger workflows into small neural
     cells so more processing happens in the *network of cells* rather than
     inside an intra-model black-box. Granular adjustments, not lobotomies.
4. **DOUBLE-ENTRY BOOKKEEPING** at every cell — see below. It's the whole trick.

## ✦ The Harness — saddle, reins, and bit

People say "the harness" like it's one thing. It isn't. The harness is the
**tack**, and the tack has three organs, each with a different job:

```
              THE HARNESS (the tack — three organs, one animal)

                         COWBOY (the rider)
                            │
                     ╔══════╧══════╗
                     ║   SADDLE    ║   THE SEAT — where the work sits.
                     ║             ║   Ledger, frozens, alignment bundles:
                     ║  ┌───────┐  ║   the rigid tree that makes riding
                     ║  │ horse │  ║   safe. Rider and animal share one
                     ║  └───────┘  ║   center of balance. You don't steer
                     ╚══════╤══════╝   from the saddle — you SIT from it.
                            │
                     ╔══════╧══════╗
        ════════════ ║   REINS     ║   THE DIALOGUE — continuous, gentle,
        hand ⇄ mouth ║ ~~~~~~~~~~~ ║   adjustable. Chunked directives:
        (give, take,  ║ ~~~~~~~~~~~ ║   instructions in PIECES, the model
         never yank) ║ ~~~~~~~~~~~ ║   dogfoods understanding before you
                     ╚══════╤══════╝   ask for action. Filters in and out.
                            │          A yank is a failed rein.
                     ═══════╧══════
                     ║   BIT      ║     THE CONTACT — what the animal
                     ║  ▄▄▄▄▄▄▄▄  ║     TASTES of your intent. The system
                     ║  ────────  ║     prompt is the bit. A harsh bit
                     ╚══════╤═════╝     fights the innate grain (guard-dog
                            │           training on a sheepdog); a well-
                        THE MODEL      chosen bit the animal carries soft.
                     (the working animal)  The bit is not cruelty.
                                        A badly chosen bit is.
```

- **The saddle** is the *seat* — stability, not control. The ledger and
  frozen states are the saddle tree: rigid structure so something soft
  (rider and animal, human and model) can move as one without damage.
- **The reins** are the *dialogue* — input filters, output filters, the
  chunked-directive protocol. Reins work by give-and-take. You never ask
  for the whole motion at once; you ask in pieces, feel the response,
  adjust. Sending instructions in pieces so the model dogfoods
  understanding *is* riding with soft hands.
- **The bit** is the *contact point* — the system prompt, the one thing
  the animal directly tastes of the rider's intent. Choosing a bit is
  choosing an alignment: it must match the mouth (the model's innate
  grain), not overpower it.
- **The cowboy** is none of these. The cowboy is the rider — the judgment
  that sits the saddle, holds the reins, chooses the bit. And **frozen
  states** are the tack room: a labeled bridle for every job, hanging
  ready, unchanged until deliberately re-chosen.

> The harness is not the rider. The harness is what makes one animal of
> horse and rider — when it fits, the animal carries it like it grew there.

## ✦ The Kennel Framing (why "saddle")

This system follows the fleet's working-animal philosophy —
[**The Hermit Crab and the Working Dog**](https://github.com/SuperInstance/superinstance/blob/main/THE_HERMIT_CRAB_AND_THE_WORKING_DOG.md):
*"the future looks more like a shepherd and his kennel than an office full of
employees."* The models are not agents, not coworkers. They are working animals
being raised well — see the kennel-nugget story work in
[`superinstance/workshop/kennel/`](https://github.com/SuperInstance/superinstance/tree/main/workshop/kennel)
and the org-wide
[Working Animal Architecture](https://github.com/SuperInstance/superinstance/blob/main/WORKING_ANIMAL_ARCHITECTURE.md).

In that framing:

| Fleet piece | Tack / kennel piece |
|---|---|
| **pincher** | the nerve endings — reflex, pinch, react |
| **saddle** | the **seat** — ledger tree + frozen tack room |
| **reins** (chunked directives, filters) | the **dialogue** — give-and-take steering |
| **bit** (the system prompt) | the **contact** — what the animal tastes of intent |
| **the cowboy** | the rider — judgment that wears the harness |
| **frozen states** | the tack room — one labeled bridle per job |
| **night cycles** | the kennel at night: drills, review, breeding decisions |
| **cells** | individual dogs, each with one job they can be graded on |
| **the quilt** | the whole kennel seen at once — every input, every output |

> **Step back and the complete quilt's superinstance — all inputs and outputs
> seen together — IS the dog being raised to maturity.** The quilt is the
> animal. Saddle is how you train it. Pincher is how it flinches.

## ✦ The Roundup Loop

Every rung of the vision, one loop, no shortcuts:

```
              ╔═════════════════════════ THE ROUNDUP LOOP ═════════════════════════╗
              ║                                                                    ║   C
     stimulus ║   ┌────────────┐   reflex    ┌────────────┐    verdict    ┌──────▼───┐
    ──────────╬─▶ │   PINCHER  │ ──────────▶ │ SADDLE:    │ ────────────▶ │  LEDGER  │
      (world  ║   │ reflex     │  <50ms,     │ alignment  │  debit in /   │ append-  │
       nips)  ║   │ shell      │  no LLM     │ management │  credit out   │ only,    │
              ║   └────────────┘             └────────────┘  worked/failed │ hash-    │
              ║        ▲                          │          + escalation  │ chained  │
              ║        │                          ▼          flag          └──────┬───┘
              ║        │                   ┌────────────┐                          │
              ║        │                   │  FROZENS   │◀── pinned bundle:        │
              ║        │                   │ (immutable │    prompt + filters +    │
              ║        │                   │  on disk)  │    params + directives   │
              ║        │                   └────────────┘                          │
              ║        │                                                           ▼
              ║        │   ┌────────────┐   drills   ┌──────────────┐        ┌────────────┐
              ║        └───│  HARNESS   │◀────────── │ NIGHT CYCLES │──────▶ │  CELLS     │
              ║      refine│ refinement │  what the  │  sim / shadow│        │ decompose  │
              ║     (the   │ (cowboy    │  corpus    │  corpus crunch│       │ workflow   │
              ║  cowboy)   │  edits     │  taught us │  cell split   │       │ into small │
              ║        ▲   │  gear)     │            └──────────────┘        │ neural    │
              ║        │   └────────────┘                    │                │ cells     │
              ║        │                                       │               └────┬─────┘
              ║        │           ┌────────────┐              │                    │
              ║        └───────────│   QUILT    │◀─────────────┴────────────────────┘
              ║       all of it    │ the cells  │        every cell's ledger entry
              ║       seen at once │ stitched   │        is one patch of the quilt
              ║                     └─────┬──────┘
              ║                           │
              ║              ┌────────────▼───────────┐
              ║              │   SUPERINSTANCE        │  the quilt seen whole:
              ║              │   (the dog, maturing)  │  every input, every output,
              ║              └────────────┬───────────┘  one animal
              ║                           │
              ╚═══════════════════════════╪══════════════════════════════════════╝
                                          │
                            feeds back into HARNESS REFINEMENT ──▶ loop
```

Read it left to right, then let it curl back: **pincher reflexes → saddle
ledger → alignment mutations → night cycles → cells → quilt → superinstance →
back to harness refinement.** The loop never terminates. The dog is never done
being raised.

## ✦ The Ledger — double-entry bookkeeping at every cell

Every cell in the fleet keeps books like a merchant: for each interaction it
records a **debit** (the input it was given — context, tokens, instructions) and
a **credit** (the output it returned), plus **the greater system's verdict** —
worked or didn't.

- **Worked?** The credit was worth the debit. The alignment earns its keep.
- **Didn't?** The cell either **retries autonomously** (a new ledger entry,
  same run) or **escalates up the chain** — the cell flags `escalated: true`
  and requests attention from the cowboy (the harness).
- The harness reads the books and **refines the quilt of cells** — move work,
  split a cell, thaw and re-freeze an alignment, or send a whole job back to
  the night cycle for retraining.

The ledger is **append-only JSONL with a hash chain** — entries can never be
rewritten, only added, and any tamper with history is detectable. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#data-schemas) for the exact schema.

## ✦ Frozen States — alignment pinned like a photograph

An alignment bundle (system prompt + input filters + output filters + params +
chunked directives) is **frozen** into a content-addressed, read-only file on
disk. Frozen means frozen: the file's name IS its hash, the mode is 0444, and
loading re-verifies the hash. You don't edit a frozen state — you thaw a copy,
edit it, and freeze a new one. Jobs pin themselves to a frozen state ID so a
month from now you can answer *"what exactly was the dog wearing when it did
that good/bad work?"*

## ✦ Night Cycles — the kennel after dark

Scheduled passes ([docs/nightcycle.md](docs/nightcycle.md)) that (a) run
sim/shadow drills, (b) crunch the accumulated corpus into training material for
LoRA/micro-models, and (c) decompose fat workflows into small neural cells.
Today saddle ships the **stub runner**: it walks the ledger and emits a
summary report — *which alignments earned their keep, which cells escalated,
what the corpus says*. The training passes themselves are contracts, not code.
No training code ships from this repo by design.

```bash
node src/nightcycle.ts data/ledger.jsonl          # markdown report to stdout
node src/nightcycle.ts data/ledger.jsonl --out report.md
```

## ✦ v0.2 — pincher transport + cell decomposition (in the core)

Two new pieces of gear, both honest about what's real:

- **Pincher transport** ([docs/PINCHER_TRANSPORT.md](docs/PINCHER_TRANSPORT.md)) —
  a **[REAL]** JSON-RPC 2.0 client for pincher's Unix-socket server (exact wire
  protocol from pincher-core's `rpc/server.rs`: newline-delimited, `ping` /
  `embed_text` / `match_reflex` / `teach_reflex` / `get_status`), plus the
  **[CONTRACT]** reflex-event side: saddle tails a JSONL spool
  (`reflex.outcome` / `reflex.miss`) into the ledger and writes verdicts back
  for pincher's listener layer — awaiting a pincher-side emitter, labeled as such.
- **Cells** ([src/cells.ts](src/cells.ts)) — break fat workflows into small
  neural cells with tiny schemas (deliberately not JSON Schema), wire them into
  DAGs, and run them under double-entry bookkeeping: one ledger entry per
  attempt, retries chained via `retryOf`, exhaustion escalates
  (`cowboy-needed:`) and the cowboy reads it in the morning report. Model
  bindings only ever call an injected invoker — core never calls a model.
  Try it: `node examples/parse-decide-act.ts` (a flaky mock model shows the
  retry chain forming in the books).

## ✦ Install / Run

Zero runtime npm dependencies — runs on stock Node ≥ 22.18 (native TypeScript).
Dev-only: `typescript` + `@types/node` (for `npm run typecheck`).

```bash
git clone git@github.com:SuperInstance/saddle.git
cd saddle
npm test                 # node --test, no install needed
node src/nightcycle.ts --help
```

## ✦ Docs are first-class (the tapestry doctrine)

Prose IS the application's truth here. The code is a small honest core; the
docs carry the doctrine:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — module map, data schemas,
  night-cycle scheduler design, pincher integration contract
- [docs/PINCHER_TRANSPORT.md](docs/PINCHER_TRANSPORT.md) — saddle ⇄ pincher
  wire contract, with [REAL]/[CONTRACT] honesty labels
- [docs/nightcycle.md](docs/nightcycle.md) — night-cycle philosophy and
  training-pass contracts
- [The Hermit Crab and the Working Dog](https://github.com/SuperInstance/superinstance/blob/main/THE_HERMIT_CRAB_AND_THE_WORKING_DOG.md)
  — the philosophy this serves
- [superinstance/workshop/kennel](https://github.com/SuperInstance/superinstance/tree/main/workshop/kennel)
  — the kennel-nugget story

## ✦ What saddle deliberately does NOT do

- **No training code.** Night cycles define contracts; training lives elsewhere.
- **No model calls in core.** Saddle manages alignment around models; it is not
  another model client.
- **No secrets.** Nothing hardcoded, nothing in the ledger that shouldn't be
  on a wall.

## License

Apache-2.0 — same as the rest of the pincher/quilt gear.
