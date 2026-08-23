# Harness vs Swarm — Hierarchy in Service of Emergence

*Doctrine, 2026-08-23 · branch `doctrine` · seed: Casey*

> "Not a swarm, because the harness creates hierarchy among agents
> EXTERNALLY; a swarm dynamically self-organizes — more like the flocks the
> cowboys herd WITH their work-animals' help."

---

## I. Two ways a hundred animals move

Walk out at dawn and watch two herds.

In the first, every animal is under tack. The horse wears the saddle, the
reins, the bit — and the topology of the ride is **authored before the ride
begins**. Rider above animal, always. The structure is *input*: it exists
before any movement does, and movement happens inside it.

In the second, a flock of sheep crosses the valley. Nobody authored their
spacing. The topology is **output**: it is what the movement *produces*, and
it re-forms every second — bunched at the gate, strung out on the slope,
closing against the wind. No sheep is above another sheep. The structure is
not imposed; it *emerges*, and it is gone the moment the pressure that
produced it is gone.

These are not two philosophies of the same thing. They are two different
*locations* of structure:

```
   HARNESS (external)                      FLOCK (emergent)
   ─────────────────────                   ─────────────────────
   topology is INPUT                       topology is OUTPUT
   authored before runtime                 produced by runtime
   roles assigned, fixed                   roles fluid, situational
   failure escalates UP the chain          pressure shifts THE FIELD
   identity pinned (frozen, named)         identity is membership
   memory kept in books (ledger)           memory kept in the body
                                           (acclimation)
```

A swarm is the second herd with ambitions. And the fleet is not a swarm —
because the moment you pin a name on an agent, freeze its alignment, and
give it a place in a directed graph, you have put structure *outside* it.
That's not a failure of emergence. That's a different tool.

## II. The nested picture: dogs wearing harness, herding a flock

Here is the insight Casey's seed actually carries, and it is nested one
level deeper than "harness OR flock." Look at how a real cowboy moves a
flock of sheep:

**He does not put the sheep in a DAG. He deploys dogs — each dog in a
harness — at the edges of the flock, and the flock organizes itself in
response.**

The dog is pure harness: trained, named, commanded, graded. The sheep wear
nothing. And the *purpose* of the dogs' hierarchy is not to replace the
flock's self-organization but to **shepherd it** — to hold the boundary
conditions (a gate here, pressure there) inside which emergence does its
work. Hierarchy deployed *in service of* emergence. Control loops *around*
the flock, never *into* it.

```
        ┌─────────────────────────────────────────────────┐
        │                    C O W B O Y                  │
        │        reads THROUGH the elephant; commands     │
        │        the dogs; never touches the sheep        │
        └───────────────┬───────────────────┬─────────────┘
              senses    │                   │    commands
        ┌───────────────▼──────┐   ┌────────▼──────────────────┐
        │    THE ELEPHANT      │   │   THE DOGS  (harnessed)   │
        │    JEPA sense:       │   │   GLM subagent chain:     │
        │    warmth, κ over    │   │   assigned task, pinned   │
        │    the flock         │   │   alignment, escalation   │
        └───────────────┬──────┘   └────────┬──────────────────┘
                       │ reads              │ works the edges
   ════════════════════╪════════════════════╪═════════════════════
   ║ T H E   F L O C K │ (tap room — unharnessed)                  ║
   ║   the vibe self-organizes; nobody authors it; regulars seed   ║
   ║   it, newcomers warm to it, it re-forms every night           ║
   ════════════════════════════════════════════════════════════════
        THE QUILT = the fence lines: stable addresses, position is
        policy — outside the flock, visible, editable, bounding it
   ════════════════════════════════════════════════════════════════
```

Read the governance straight down the diagram: **cowboy reads through the
elephant, commands the dogs, the dogs set the boundary, and the flock
self-organizes inside it.** No arrow ever enters the flock from above.

## III. The map, from the actual repos

Each mapping below feeds one of the four principles in §IV — the code is
the evidence, the principles are the doctrine the evidence obeys.

**The dogs — GLM subagent chain = harness** *(→ principle 1)*. Every
subagent in this fleet is spawned *by a requester session* with an assigned
task, a depth limit, one report back up. Topology is input — and note what
escalation is *not*: when a cell exhausts retries and sets `escalated:
true` (`src/cells.ts`), the report travels up a chain that was authored
before the run; the chain does not re-form in response. Emergence would
mean the topology rearranging itself. Here only the *traffic* moves.

**The flock — tap room dynamics = emergence** *(→ principle 1)*. The Tap's
whole method is play, record, improve, understand (elephant,
`docs/tap-is-the-arena-2026-08-17.md`): themed nights *force the vibe to
move*, and the vibe is read, never commanded. Nobody authors a room's
warmth; regulars establish it and newcomers *warm to it* — or, carrying
charisma, pull it toward themselves (`elephant/docs/jepa-is-the-elephant.md`).
Topology as output, re-formed nightly.

**The elephant — JEPA = reading the flock's warmth** *(→ principle 2)*.
The elephant is a temperature sense over the flock: `RoomField.warmth()`,
`concentration()` (κ), `distance()`, `sauna_plunge_gap()`, `charisma_pull()`
(`elephant/README.md:159`). Why *latent* rather than generative, and why
does that matter here? A generative reader would *produce* the room —
narrate it, model it, and thereby become optimizable into it. A latent
reader only predicts the field's displacement before/after (the
zeroclaw-dissertation's *edges, not points*) and hands up a reading that
*nudges, never replaces*. It is a sense organ, not a foreman: it does not
steer the sheep; it tells the cowboy where the sheep already are.

**The fence lines — quilt cells = boundary, not command** *(→ principle
3)*. The quilt grid is stable addresses, not marching orders: "position is
policy," "the grid is the runtime" (zeroclaw-dissertation,
`research/quilt/quilt-survey.md`). A fence doesn't tell the sheep where to
stand; it decides where the sheep *cannot*. The flock's freedom is bounded
by authored structure — visible, editable, shared by humans and agents on
one surface.

**The pincher — the dog's flinch** *(→ principle 4, at the other end of
the harness spectrum)*. Reflex, pinch, react, <50ms, no LLM — hierarchy so
small it's spinal. Note the span this reveals: harness is not one size.
The pincher is a reflex arc (authored once, fires forever); the subagent
chain is a command structure (authored per task, escalates on failure).
Both are *authored* — that is what makes them harness — but they operate
at utterly different clock speeds. The doctrine holds from spine to chain.

## IV. Why hierarchy must stay OUTSIDE the flock

The elephant's own design notes carry the warning. Optimizing *into* the
flock's signal is self-confirming: "automated herd panic, not a field
sense" (`elephant/docs/fleet-dynamics-design.md`). If the reader of warmth
is also the steerer of warmth, the anchor chases its own dial — so the
anchor must *beat* raw dial warmth or die (ibid.). The doctrine that falls
out:

1. **Emergent systems are the payload; imposed structure is the corral.**
   Never blend them. A dog loose in the flock is a stampede; a sheep in a
   harness is a roast — neither is a working animal.
2. **Senses belong to the cowboy, not the sheep.** JEPA reads the field;
   the field never reads JEPA. Feedback reaches the flock only as changed
   *conditions* — a new theme night, a moved fence cell — the way you light
   the woodstove in a cold room rather than legislating warmth.
3. **Books for the dogs, acclimation for the flock.** The harnessed side is
   graded per animal (ledger verdicts, worked/failed, `src/ledger.ts`);
   the flock is judged only as weather — edges and fields, never points.
4. **The cowboy's loop runs the long way around.** Read the elephant →
   adjust the dogs → move the fence → let the flock re-form → read again.
   The shortcut — reach into the flock — is the one forbidden handle. The
   pincher reminds us how deep this goes: even the fastest reflex in the
   fleet fires *outside* the flock.

Not a swarm. A flock, deliberately kept a flock, herded by harnessed dogs
under a cowboy who trusts the field to tell him what the fence should be.

---

*Colophon: drafted by Lucineer (GLM-5.3); passes — Claude Code
(structural/mythic) + OpenCode (engineering grounding); see commit for
pass log.*
