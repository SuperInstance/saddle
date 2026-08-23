# Vestiges — The Stirrups We Still Ride With

*Doctrine, 2026-08-23 · branch `doctrine` · seed: Casey*

> "The mechanics of a horse's harness still contain vestiges of technologies
> from other needs in the past. The stirrup was part of lance technology for
> a knight. Cart technology grew around the advancing needs of more and more
> horses in their harness."

---

## I. The tack room, after dark

The cowboy lifts the harness from the peg and holds it to the lamp,
inventorying the parts nobody chose.
The stirrup hangs there — a loop of iron whose whole purpose was to anchor
a knight's lance charge. The knight is five hundred years gone. The stirrup
is still on every saddle in the rack, because by the time anyone built a
saddle *for riding*, the stirrup had calcified into what a saddle
*is*.

Tonight we hold our own tack up to the lamp. Not the metaphor — the metal.
Every claim below is a real artifact in this repository, file and line,
greppable.

## II. The two-slot bit (`src/cellrunner.ts:24`)

```ts
prompt: { system: string; user: string };
```

There it is, cast into the type itself: exactly two strings, named *system*
and *user*. This is the chat-window of 2019, poured into TypeScript like
iron into a mold. One voice of authority, one voice of request, one
answer — single rider, single turn. GPT-2-era playgrounds made that shape
load-bearing, and every API since kept the casting because refactoring
the mold costs more than the stirrup's drag.

But the repo's own doctrine says the bit is chosen per mouth (`README.md`, *The
Harness — saddle, reins, and bit*): the system prompt is *contact*, the
dialogue is *give-and-take*. A give-and-take does not fit in two slots.
The type still assumes the lance charge.

## III. The reins that never reached the wire

The sharpest vestige in the repo, and it is ours. The frozen-state
manifest carries the chunked-directive protocol — the fleet's own doctrine
of instructions delivered in PIECES, the model dogfooding understanding
before action:

```ts
directiveChunks: string[];          // src/frozens.ts:49
```

Now look at what travels to the animal — `CellRequest`
(`src/cellrunner.ts:22–27`): `model`, `params`, `input`, and that same
two-slot `prompt`. **The chunks are manifest only; never on the wire.**
Not even smuggled: `buildUserPrompt` (`src/cellrunner.ts:42`) receives
only the domain input — the chunks cannot reach the animal unless the
caller thaws the frozen itself, outside the harness. Not packaged; stranded. And the guard meant to keep their ORDER
honest — *"block directive chunks delivered out of order"*
(`docs/ARCHITECTURE.md:98`) — is a schema illustration only:
`inputFilters` are declared in the frozen spec (`src/frozens.ts:40`) and
applied by no code in this repository. A paper guard over a protocol the
wire cannot carry: doctrine outgrew the artifact, and the artifact won.

## IV. The gait knobs (`src/frozens.ts:43`)

```ts
/** sampling params: temperature, top_p, ... */
params: Record<string, number | string | boolean>;
```

`docs/ARCHITECTURE.md:107` canonical example:
`"temperature": 0.8`. Temperature and top_p are pure stirrups:
controls for a *single completion's* dice-roll.
Count what the fleet actually judges: not a roll but a run of them —
every attempt lands in the books as a `worked` / `failed` verdict
(`src/ledger.ts:29`), and the nightcycle reads ledgers to ask
whether an alignment *earned its keep*. The judgment lives in the books
now; the knobs only ever steered one throw. Yet the knob tray is still
the 2020 single-roll tray — still what a new engineer reaches for first.

## V. The one-pass pipeline (`src/cells.ts:175`)

```ts
/** Static check: unique ids, resolvable refs, existing fields, no cycles. */
```

Workflows must be acyclic — the batch-ETL assumption: data flows one
direction, once, the job ends. But read the repo's own front door. The
roundup diagram ends: *"pincher → saddle ledger →
alignment mutations → night cycles → cells → quilt → superinstance →
back to harness refinement. **The loop never terminates.**"*
(`README.md:184`) The loop was doctrine first; the cycle ban landed
commits later — and neither commit noticed the other. Next door, the
quilt engine casts a cell as "a value, a formula, a listener, an API
call, an AI call, a sensor" (`quilt/README.md:33`) — reactive cells
where feedback loops are the native topology. The iron was available;
we cast the checker from the old mold anyway.

## VI. The single rider (`src/ledger.ts:19`)

```ts
* Single-writer assumption: one process appends to a ledger file at a time.
```

One rider per book, said plainly in the source. The fleet doctrine is
many animals, many cowboys — and the seat itself
is shaped for one writer. It is honest about it — the best
vestige of all: a stirrup that knows it's a stirrup. Cart technology,
Casey says, grew around *more and more horses*; our books still assume
one horse.

The same assumption appears again at the call site. The
retry loop (`src/cellrunner.ts:66`, `maxAttempts ?? 2`) resends the
*identical* debit — same prompt, same params — because the stateless
completion taught us that every request is an island; the wire has no
slot for "you said X, it failed for Y." In the corral, when a horse
refuses a jump, the rider walks the line, shortens the approach, tries a
different angle. The books already link the attempts (`retryOf`,
`src/ledger.ts:45`); the wire never learns they are related. One writer,
one attempt, no memory between them: the single-rider shape, stamped
twice.

## VII. Tack designed for THIS animal

Five needs, five shapes, five honest costs:

- **Contact that accumulates.** The bit becomes a frame the runtime
  appends to, seated on the chain the books already keep (`retryOf`,
  `src/ledger.ts:45`) — the transcript held by reference, because "the
  ledger is for books, not cargo" (`src/cells.ts:29–31`).
- **Chunks on the wire.** `CellRequest` grows `chunks: string[]` —
  additive; the frozen spec and its hash untouched. The cost is the
  adapter: acknowledgment-between-pieces is multi-turn, and today's
  `call()` is one request, one response. The bit becomes stateful, not
  stateless.
- **Retry as continuation.** Blocked by a real gap: on parse failure the
  raw output never reaches the books (`src/cellrunner.ts:95–99` keeps
  the error, discards the response) — nothing to continue from. Retain
  first; then let the failed attempt ride into the next debit.
- **Loops with a bridle.** The runner is batch (Kahn order, one-shot
  outputs map); quilt is reactive — a runtime change, not a validation
  tweak. And the hash chain is a tamper tripwire, not a termination
  guard: bounded cycles need a runner-enforced budget.
- **Many hands, one chain.** Per-cell ledgers merged nightly would break
  `verify()` (`src/ledger.ts:161–181` — one linear chain, monotonic
  seq). The honest widening is an append-lock over the whole
  tail-read→hash→append window (`src/ledger.ts:90–108`).

The stirrup was excellent technology — for a knight. Everything above
was excellent technology — for a single chat completion with no memory.
The cowboy's discipline is not to despise the inherited iron, but to
know which loops of it still hold a lance that was demobilized years
ago.

---

*Colophon: Lucineer — revived from a dead first run, citation-audited and
revised on the GLM-5.2 retry. Passes — Claude Code 2.1.241
(structural/mythic), OpenCode 1.18.16 (engineering grounding), both
completed; findings folded into §III, §V–§VII. Pass log in the commit
message.*
