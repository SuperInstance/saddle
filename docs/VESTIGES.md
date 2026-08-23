# Vestiges — The Stirrups We Still Ride With

*Doctrine, 2026-08-23 · branch `doctrine` · seed: Casey*

> "The mechanics of a horse's harness still contain vestiges of technologies
> from other needs in the past. The stirrup was part of lance technology for
> a knight. Cart technology grew around the advancing needs of more and more
> horses in their harness."

---

## I. The tack room, after dark

The cowboy takes the harness off the peg and holds it up to the lamp, and
does what any good gear-maker eventually does: inventories the parts nobody
chose. The stirrup hangs there — a loop of iron whose whole purpose was to
anchor a knight's lance charge. The knight is five hundred years gone. The
stirrup is still on every saddle in the rack, because by the time anyone
built a saddle *for riding*, the stirrup had already calcified into what a
saddle *is*.

Tonight we hold our own tack up to the lamp. Not the metaphor — the metal.
Every claim below is a real artifact in this repository, file and line,
greppable.

## II. The two-slot bit (`src/cellrunner.ts:24`)

```ts
prompt: { system: string; user: string };
```

There it is, cast into the type itself: exactly two strings, named *system*
and *user*. This is the chat-window of 2019, poured into TypeScript like iron
into a mold. One voice of authority, one voice of request, one answer —
single rider, single turn. It is the shape GPT-2-era playgrounds made
load-bearing, and every model API since has kept the casting because
refactoring the mold costs more than the stirrup's drag.

But our own doctrine says the bit is chosen per mouth (`README.md`, *The
Harness — saddle, reins, and bit*): the system prompt is *contact*, the
dialogue is *give-and-take*. A give-and-take does not fit in two slots. The
type still assumes the lance charge.

## III. The reins that never reached the wire

Here is the sharpest vestige in the repo, and it is ours. The frozen-state
manifest carries the chunked-directive protocol — the fleet's own doctrine
of instructions delivered in PIECES, the model dogfooding understanding
before action:

```ts
directiveChunks: string[];          // src/frozens.ts:49
```

Now look at what actually travels to the animal — `CellRequest`
(`src/cellrunner.ts:21–26`): `model`, `params`, `input`, and that same
two-slot `prompt`. **The chunks are manifest only; never on the wire.** The
protocol that justifies the whole reins metaphor exists in the manifest, is
guarded by an input filter (`docs/ARCHITECTURE.md:98`: *"block directive
chunks delivered out of order"*), and then has to be flattened — smuggled —
into the `user` string because the wire shape has nowhere else to put it.
We built a lance, and the stirrup we inherited has no socket for it. The
filter defending a protocol the transport cannot express is the tell:
doctrine outgrew the artifact, and the artifact won.

## IV. The gait knobs (`src/frozens.ts:43`)

```ts
/** sampling params: temperature, top_p, ... */
params: Record<string, number | string | boolean>;
```

`docs/ARCHITECTURE.md:107` shows the canonical example:
`"temperature": 0.8`. Temperature and top_p are stirrups in the purest
sense: controls invented to manage a *single completion's* dice-roll. Count
what the fleet actually judges: not a roll but a run of them — every
attempt already lands in the books as a `worked` / `failed` verdict
(`src/ledger.ts:26`), and the nightcycle reads whole ledgers to ask whether
an alignment *earned its keep*. The judgment lives in the books now; the
knobs only ever steered one throw. Yet the knob tray is still the 2020
single-roll tray, still first in the example, still the thing a new
engineer reaches for first.

## V. The one-pass pipeline (`src/cells.ts:175`)

```ts
/** Static check: unique ids, resolvable refs, existing fields, no cycles. */
```

Workflows must be acyclic. That is the batch-ETL assumption: data flows one
direction, once, and the job ends. But read this repo's own front door.
The README's roundup diagram ends: *"pincher → saddle ledger → alignment
mutations → night cycles → cells → quilt → superinstance → back to harness
refinement. **The loop never terminates.**"* The doctrine is a loop; the
topology checker we wrote forbids loops — in the same repository, in the
same commit, without either side noticing the other. (The sister repo that
fixed this is worth one line: the quilt engine deliberately allows cycles
for effectful feedback — `sensor → formula → listener → actuator → sensor`
— but that is its essay, not this one.)

## VI. The single rider (`src/ledger.ts:19`)

```ts
* Single-writer assumption: one process appends to a ledger file at a time.
```

Said plainly, in the source: one rider per book. The whole fleet doctrine
is many animals, many cowboys, the quilt seen at once — and the ledger, the
seat itself, is shaped for exactly one writer per file. It is honest (the
comment admits it), which makes it the best vestige of all: a stirrup that
knows it's a stirrup. Cart technology, Casey says, grew around *more and
more horses*; our books still assume one horse.

The same assumption appears again at the call site. The retry loop
(`src/cellrunner.ts:66`, `maxAttempts ?? 2`) retries a failed call by
sending the *identical* debit again — same prompt, same params — because
the stateless completion taught us that every request is an island, with no
room on the wire for "you said X, it failed for Y." In the corral, when a
horse refuses a jump, the rider adjusts the approach; we send the identical
prompt again. One writer, one attempt, no memory between them: the
single-rider shape, stamped twice.

## VII. Tack designed for THIS animal

Strip the inherited iron and draw it again, for the animal we actually ride:

- **The bit as a rolling transcript, not two slots.** Replace
  `{ system, user }` with a frame the runtime appends to — the bit seats on
  a conversation the ledger already chains via `retryOf` (`src/ledger.ts:35`).
- **Chunks on the wire.** `CellRequest` grows `chunks: string[]` with
  acknowledgment between pieces — the reins become protocol, not packaging.
- **Retry as continuation.** A failed attempt's credit (even a parse error)
  becomes the next attempt's input; the books already link attempts, let
  the wire do what the books already do.
- **Loops as first-class topology.** Allow bounded cycles in workflows the
  way quilt does, with the hash chain as the tripwire.
- **Many hands on the books.** A multi-writer ledger (per-cell files merged
  at night, or an append-lock) so the seat fits the herd we actually run.

The stirrup was excellent technology — for a knight. Everything above was
excellent technology — for a single chat completion with no memory. The
cowboy's discipline is not to despise the inherited iron, but to know, each
time he lifts the harness from the peg, which loops of it are holding a
lance that was demobilized years ago.

---

*Colophon: drafted by Lucineer (GLM-5.3) from a code audit of
SuperInstance/saddle; passes — Claude Code (structural/mythic) + OpenCode
(engineering grounding); see commit for pass log.*
