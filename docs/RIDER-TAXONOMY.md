# Rider Taxonomy

> *"There are lots of types of riders — racing jockeys, ranchers, generals,
> cavalry, mounted police, pony-express, ponies for kids, mules for packing,
> buggy horse and cabbies, and a thousand others that are use-case dependent."*
> — the seed, preserved whole

> The tack room has more than one bridle. **The job hangs the gear — not the horse.**

---

## ✦ Why Riders

The cowboy is not one rider. A single horse and a single harness can carry a
jockey to the races or a rancher across the territory — the difference is the
rider, the job, and the frozen tack that ties them together. The
[README](../README.md) calls frozen states *the tack room: "a labeled bridle
for every job, hanging ready, unchanged until deliberately re-chosen."*

In the fleet's working-animal framing (see
[The Hermit Crab and the Working Dog](https://github.com/SuperInstance/superinstance/blob/main/THE_HERMIT_CRAB_AND_THE_WORKING_DOG.md)
and [The Kennel](https://github.com/SuperInstance/superinstance/blob/main/THE_KENNEL.md)),
riders are not different cowhands. They are different **roles the same
infrastructure plays** — each one a frozen alignment (bit + filters + params +
directive chunks) bound to the class of animal the job deserves. The jockey's
bit is not the rancher's bit. The pony express rider's rhythm is not the
mounted officer's rhythm.

So a rider type, here, is an **alignment archetype for model deployment**:
pick the rider the job calls for, and the rider's tack tells you the frozen
state to reach for. One lives in `docs/templates/` for every archetype below —
template stubs, honestly labeled, ready to thaw, edit, and freeze.

---

## ✦ The Corral — one map, many riders

```
╔═ THE CORRAL ═ NORTH: SPEED — latency-critical ══════════════════════════════════════════════════╗
║  W: private/trusted lane ◄────────────────────────────► E: public/facing crowds                 ║
║ ┌─ JOCKEY ────────┐┌─ POLO ──────────┐┌─ PONY EXPRESS ──┐┌─ MOUNTED POLICE ┐┄┄ open track ┄┄┄┄┄ ║
║ │quilt-pincher    ││symphony-claude  ││the-relay ·      ││voice-reflex-gate│┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ ║
║ │<50ms, no LLM    ││-glm/-kimi;      ││lucineer-relay   ││hash-key routing │┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ ║
║ │pure reflex      ││V4-Flash banter  ││GLM-5-turbo      ││one lawful answer│┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ ║
║ └─────────────────┘└─────────────────┘└─────────────────┘└─────────────────┘┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ ║
╟─── MID: the everyday gaits ─────────────────────────────────────────────────────────────────────╢
║ ┌─ DRAGOON ───────┐┌─ CABBIE ────────┐┌─ STAGECOACH ────┐┌─ TRICK RIDER ───┐┌─ KIDS' PONY ────┐ ║
║ │Liquid LFM2.5-   ││lucineer-brain   ││lucineer-roblox  ││Fable 5 rationed ││Scrapcraft +     │ ║
║ │2.6B · Ollama    ││OpenClaw Telegram││shotgun: roblox- ││+ Haiku 5 wonder ││scrapcraft-world │ ║
║ │edge · boat-brain││MEMORY.md fares  ││filtergate       ││human holds rope ││Nemotron-vetted  │ ║
║ └─────────────────┘└─────────────────┘└─────────────────┘└─────────────────┘└─────────────────┘ ║
╟─── SOUTH: DISTANCE — long-horizon ──────────────────────────────────────────────────────────────╢
║ ┌─ ENDURANCE ─────┐┌─GENERAL/CAVALRY─┐┌─ MULE PACKER ───┐┌─ RANCHER ───────┐┌─ FOX HUNTER ────┐ ║
║ │murmur-agent ·   ││fleet-conductor  ││nightcycle.md    ││OpenClaw         ││quilt · bge-m3   │ ║
║ │all-night        ││officers-        ││DeepSeek V4-Pro  ││Lucineer/eileen  ││Vectorize scent  │ ║
║ │GLM-5.2 shift    ││quarters         ││heavy freight    ││GLM-5.3 daily    ││+ Qwen3-VL eyes  │ ║
║ └─────────────────┘└─────────────────┘└─────────────────┘└─────────────────┘└─────────────────┘ ║
╚═ GATE: "use-case dependent — the thousand others" ══════════════════════════════════════════════╝
```

**How to read the map.** The north fence is **speed** — latency-critical lanes
where the race is decided in milliseconds. The south fence is **distance** —
long-horizon work measured in shifts, nights, and quarters. West is the
**private, trusted lane** (your own repos, your own boats). East is the
**public lane** — facing crowds, children, strangers. The gate on the south
end stays open: *use-case dependent — the thousand others.* The rule the whole
corral stands on: **the job picks the rider, the rider picks the horse, and
the tack room freezes what they wore.** A frozen state is a labeled bridle —
the ledger can always answer *what exactly was the animal wearing when it did
that work?* (see [ARCHITECTURE](ARCHITECTURE.md#data-schemas)).

For the graphically minded, the same taxonomy as a quadrant map:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 420" font-family="monospace">
  <rect width="900" height="420" fill="#0b1220"/>
  <text x="450" y="28" fill="#f0a500" font-size="18" text-anchor="middle">SADDLE — Rider Taxonomy: one tack room, many riders</text>
  <line x1="450" y1="50" x2="450" y2="390" stroke="#334155" stroke-width="2"/>
  <line x1="40" y1="220" x2="860" y2="220" stroke="#334155" stroke-width="2"/>
  <text x="450" y="62" fill="#94a3b8" font-size="11" text-anchor="middle">NORTH · SPEED (latency-critical)</text>
  <text x="450" y="404" fill="#94a3b8" font-size="11" text-anchor="middle">SOUTH · DISTANCE (long-horizon)</text>
  <text x="52" y="216" fill="#64748b" font-size="11">WEST · PRIVATE / TRUSTED LANE</text>
  <text x="848" y="216" fill="#64748b" font-size="11" text-anchor="end">EAST · PUBLIC / FACING CROWDS</text>
  <g fill="#f0a500" font-size="12">
    <circle cx="120" cy="90" r="4"/><text x="130" y="94">JOCKEY · quilt-pincher &lt;50ms</text>
    <circle cx="600" cy="80" r="4"/><text x="610" y="84">POLO · symphony triad banter</text>
    <circle cx="720" cy="120" r="4"/><text x="730" y="124">PONY EXPRESS · lucineer-relay</text>
    <circle cx="800" cy="170" r="4"/><text x="700" y="174">MOUNTED POLICE · filtergate, fail-closed</text>
    <circle cx="160" cy="200" r="4"/><text x="170" y="204">DRAGOON · Liquid LFM2.5, offline</text>
    <circle cx="480" cy="190" r="4"/><text x="490" y="194">CABBIE · Telegram main agent</text>
    <circle cx="640" cy="210" r="4"/><text x="650" y="214">STAGECOACH+SHOTGUN · roblox pair</text>
    <circle cx="850" cy="230" r="4"/><text x="760" y="244">TRICK RIDER · Fable 5 golden ticket</text>
    <circle cx="820" cy="300" r="4"/><text x="700" y="304">KIDS' PONY · Wesley + Scrapcraft</text>
    <circle cx="120" cy="280" r="4"/><text x="130" y="284">ENDURANCE · murmur-agent nights</text>
    <circle cx="340" cy="330" r="4"/><text x="350" y="334">GENERAL/CAVALRY · fleet-conductor</text>
    <circle cx="520" cy="350" r="4"/><text x="530" y="354">MULE PACKER · bulk subagent swarms</text>
    <circle cx="240" cy="370" r="4"/><text x="250" y="374">RANCHER · GLM-5.3 daily driver</text>
    <circle cx="700" cy="370" r="4"/><text x="560" y="390">FOX HUNTER · bge-m3 scent + Qwen3-VL eyes</text>
  </g>
  <text x="450" y="416" fill="#475569" font-size="10" text-anchor="middle">gate: use-case dependent — the thousand others</text>
</svg>
```

### The master table

| # | Rider | Horse (named) | Defining tack | Fleet equivalent (named, real) | ML pattern |
|---|-------|---------------|---------------|--------------------------------|------------|
| 1 | **Jockey** | GLM-5-turbo; pincher's no-LLM reflexes | <50ms SLA, minimal bit, no stall on miss | [REAL] quilt-pincher · voice-reflex-gate · Scrapcraft's race oval | small-model-first routing, reflex cascade |
| 2 | **Rancher** | GLM-5.3 | lore-rich bit, chunked directives, patient retries | [REAL] OpenClaw main agent (Lucineer on `eileen`), MEMORY.md | long-horizon assistant, memory + escalation |
| 3 | **General / Cavalry** | the state machine itself (fleet-conductor); GLM-5.2 staff officers | orders as directives, strict escalation format | [REAL] fleet-conductor · officers-quarters 12-room chain | hierarchical multi-agent orchestration |
| 4 | **Mounted Police** | Nemotron-Content-Safety-3.5 | fail-closed I/O filters, kid-safe deny-lists | [REAL] roblox-filtergate · scrapcraft-world lore gate | guardrails, layered moderation |
| 5 | **Pony Express** | DeepSeek V4-Flash | mochila handoff (structured JSON), stateless stations, retry budget | [REAL] lucineer-relay Worker (cron every 3s) · Roblox bridge · saddle's pincher spool ingest | relay pipelines, checkpointed handoffs |
| 6 | **Mule Packer** | GLM-5.2 / DeepSeek V4-Pro swarms | payload limits, verification proofs, batch books | [REAL] foreman-dispatched subagent swarms · nightcycle corpus crunch | batch throughput, parallel subagents, idempotency |
| 7 | **Kids' Pony** | Wesley (Granite 3.1 2B, local) | hard speed limits, scope honesty, structured-only output | [REAL] wesley-curriculum · Scrapcraft companions · study-lucid-tutor | sandboxing, capability limits, curriculum training |
| 8 | **Cabbie / Buggy** | Sonnet 5 / GLM-5.3 conversational lanes | persona bit, clarify-first, memory of the streets | [REAL] OpenClaw Telegram chat · lucineer-brain 4-stage pipeline | conversational UX, persona + RAG |
| 9 | **Endurance Rider** | GLM-5.2 on the night shift | checkpoint often, commit often, pace over sprint | [REAL] murmur-agent (every thought a commit) | long-running autonomous loops |
| 10 | **Dragoon** | Liquid LFM2.5-2.6B (Q4, local Ollama) | offline-first, conservation fences, no cloud | [REAL] local edge lane · [CONTRACT] F/V EILEEN boat brain 60mi offshore | edge/offline inference, quantization |
| 11 | **Trick Rider** | Fable 5 (golden ticket), Haiku 5, FLUX-2-max | one-shot spectacle, human holds the rope | [REAL] exhibition lanes; Fable rationed by doctrine | frontier showcase, human-gated |
| 12 | **Polo Player** | DeepSeek V4-Flash ensemble | each player hears the last play | [REAL] symphony-claude (Saldière) · symphony-kimi (Batón) · symphony-glm (Slackwater) | multi-model iterative banter |
| 13 | **Fox Hunter** | Qwen3-VL eyes + bge-m3 scent | recall-heavy filters, cite the source | [REAL] quilt lanes · Vectorize + bge-m3 embeddings | retrieval, embeddings, vision-assisted search |
| 14 | **Stagecoach Driver & Shotgun** | paired: a driver model + a veto model | driver owns UX, shotgun owns the veto | [REAL] lucineer-roblox driver + roblox-filtergate shotgun | paired deployment, safety-veto layer |

---

## ✦ The Eight Seed Rungs

### ✦ 1. Jockey — the race lane

**The rider.** 108–126 lbs with silks and tack, stirrups hitched short, riding
out of the irons. Every gram is audited; the tack is the legal minimum. The
cues are whispers through soft hands — a jockey never yanks a horse at speed.

**The horse.** The smallest, fastest animal that can carry the weight:
**GLM-5-turbo** — the fleet's designated runner model — or no animal at all,
when pincher's reflex table can carry the race alone.

**The tack.** A minimal bit (short system prompt — extra tokens are extra
weight), no decorative filters, low temperature, and a hard rule: **no stall
on a miss.** If the reflex doesn't match, escalate immediately — the jockey
who hesitates has already lost.

**The fleet equivalent.** [REAL] **quilt-pincher** — pinch in, match a
reflex, execute: <50ms, no LLM, zero marginal cost. [REAL]
**voice-reflex-gate** — STT text as a hash key, cached answer, zero model
invocation. [REAL] **Scrapcraft**, where the race lanes are literal: a
floodlit oval where middle-schoolers race the robots they built. When a
reflex *is* missable, the turbo runner takes the lane; pincher still gates it.

*ML pattern: small-model-first routing / reflex cascade — most traffic never
reaches the big model.*

### ✦ 2. Rancher — the daily driver

**The rider.** Dawn to dark in the saddle, reading land, weather, and the
mood of the stock. Knows one territory cold and makes slow, steady decisions
with years behind them. Nothing flashy; everything *kept*.

**The horse.** **GLM-5.3** — the flagship, versatile stock, long-horizon
reasoning. Work measured in hours and weeks, not milliseconds.

**The tack.** A lore-rich bit (territory, history, this outfit's values),
instructions in pieces (the chunked-directive protocol — a rancher teaches a
green hand one chore at a time), a generous but not infinite retry posture,
and escalation to `cowboy-needed` when the books show it.

**The fleet equivalent.** [REAL] The **OpenClaw main agent (Lucineer on host
`eileen`)** in its working mode: daily-driver on GLM-5.3, dispatches CLI
subagents (claude / kimi / opencode) as hired hands, keeps MEMORY.md and
daily notes as fence-line knowledge, works the repos like pasture — `git
status` is walking the fence line.

*ML pattern: long-horizon assistant with memory and human escalation — the
daily driver, not the fastest horse in the string.*

### ✦ 3. General / Cavalry — the chain of command

**The rider.** The general doesn't fight; the general reads the field from
the command tent. Bugles move regiments. Cavalry rides *as a unit* — many
horses, one maneuver, one command structure. A cavalry charge is coordination,
not courage.

**The horse.** Here the horse is mostly **not an LLM**: fleet-conductor's
lifecycle state machine (spawn, health-check, scale, terminate) under
conservation constraints — the discipline that holds the line. Staff officers
are **GLM-5.2 subagents**: fast enough for many decisions, cheap enough to
scale with the problem.

**The tack.** Orders as directives — one order per message, parsed strictly.
A strict escalation format (1 retry, then up the chain), and the ledger's
`escalated: true` flag as the bugle call.

**The fleet equivalent.** [REAL] **fleet-conductor** — distributed agent
fleet orchestration, conservation-aware, above the topology construct.
[REAL] **officers-quarters** — the 12-room chain of command, each room a
tile where reflex becomes cortex. The **[REAL] CellRunner DAG** in this repo
is the smallest cavalry: cells in topological order, one ledger entry per
attempt, dependents skipped on escalation, independent branches keep their
gains — a fighting retreat with the books kept.

*ML pattern: hierarchical multi-agent orchestration — wide dispatch, narrow
command chain, escalation as a first-class signal.*

### ✦ 4. Mounted Police — the public lane

**The rider.** Sits a crowd-trained horse in the middle of noise and stays
*calm, predictable, present.* The job is not speed — it is de-escalation.
The horse is selected and drilled to stand when everything says run.

**The horse.** **Nemotron-Content-Safety-3.5** — an animal bred for exactly
this: hold alignment under pressure, keep the space safe so everyone else can
move freely.

**The tack.** Fail-closed everything: input filters ahead of reasoning
(content safety first), output filters before anything reaches the crowd,
deny-lists for the kid-safe corpus, and a steady temperature. On any fault,
any stutter in the check — **return nothing at all.**

**The fleet equivalent.** [REAL] **roblox-filtergate** — fail-closed content
filtering for Roblox: wraps TextService, rate limits, detects prompt
injection, and "on any fault... returns nothing at all — not half a truth,
not a dangerous guess." [REAL] **scrapcraft-world** — the kid-safe lore layer
a public yard runs on. The mounted police archetype is why the fleet can put
models in front of children at all.

*ML pattern: guardrail-first architecture — layered input/runtime/output
moderation; safety as service, not punishment.*

### ✦ 5. Pony Express — the relay

**The rider.** ~125 lbs, one horse per 10–15 miles, swapping at stations
along a 1,800-mile line. The mochila — one leather mail purse — moves from
rump to rump without stopping. Speed over distance, but the virtue is
*the package always gets through.* Rain, dark, tired horse: the rider
doesn't stop.

**The horse.** **DeepSeek V4-Flash** — fast, cheap, reliable enough to run
in redundant strings. Cheapness is a safety feature: you can afford the
retry, the second rider, the spare horse at the next station.

**The tack.** A one-job bit ("carry the message"), short context — each
station starts fresh; the *mochila* is a structured JSON handoff, never free
text, so the next rider mounts without a briefing. A retry budget, and
verdicts written back so a lost package is found at the next station, not
the end of the line.

**The fleet equivalent.** [REAL] The **lucineer-relay** Cloudflare Worker —
the Roblox bridge's job relay, its job processor running on cron every 3
seconds: player chat → worker → pipeline → world, handoff after handoff.
[REAL, in this repo] **pincher spool ingest** — saddle tails the reflex
spool (`reflex.outcome` / `reflex.miss`) into the ledger and writes verdicts
back for pincher's listener — the mail and the receipt both ride.
[CONTRACT] pincher-side emitter, labeled as such in
[PINCHER_TRANSPORT](PINCHER_TRANSPORT.md).

*ML pattern: relay/routing pipelines — stateless stations, structured
handoffs, checkpointed retries. The ledger is the package.*

### ✦ 6. Mule Packer — the freight lane

**The rider.** Deck loads of 100–150 lbs secured with a diamond hitch — a
knot that holds through rockslides and river crossings because every crossing
holds every other. The packer's virtues are stubbornness, patience, and
*verification*: check the load, check the knot, then check it again. No
glamour; the freight arrives.

**The horse.** Mules, plural. **GLM-5.2** and **DeepSeek V4-Pro/Flash**
subagent swarms — stock chosen for throughput under load, sure-footed on
trails a thoroughbred wouldn't attempt.

**The tack.** Payload discipline (reject the oversized crate; the ledger
holds the books, not the cargo — externalize the load), verification proofs
required in the credit ("state the knot you tied"), batch books (one workflow
entry, child entries per mule), and retries that are *idempotent* — the
diamond hitch: every crossing tied to the last.

**The fleet equivalent.** [REAL] The **foreman pattern itself**: the OpenClaw
main agent dispatching parallel CLI coder swarms (claude / kimi / opencode)
— this very document was packed by such a string. [REAL]
**nightcycle.md's** corpus-crunch pass — the night freight: shard the
worked/failed entries, hand the manifest to the trainer, never train inside
the harness.

*ML pattern: batch throughput, parallel subagents, payload externalization,
idempotent retries — boring on purpose.*

### ✦ 7. Kids' Pony — the school lane

**The rider.** A forty-pound child on a "bombproof" pony that has seen
everything and refuses to be surprised. The pony is *deliberately* slow. Its
one-speed trot is the feature: confidence comes from an animal that will not
bolt, will not buck, will not exceed its posting.

**The horse.** **Wesley** — the fleet's ensign, a local Granite 3.1 2B
through Ollama: small, honest about its limits, growing up in public. Not the
smartest animal in the barn; the most trustworthy one for the seat.

**The tack.** Hard speed limits (rate limits are literal here), a bit that
teaches ("you know a few things well; say when you don't"), structured-only
output (no free prose to spook with), one retry then a graceful fail, and the
mounted-police bridle worn underneath — every kids' pony is vetted by the
same fail-closed filters before it ever meets a child.

**The fleet equivalent.** [REAL] **wesley-curriculum** — night school: cloud
teachers (GLM-5.2) deliver structured lesson plans during idle cycles; growth
by the Molted Shell Principle. [REAL] **Scrapcraft** — the companions
middle-schoolers program, kid-safe by doctrine. [REAL] **study-lucid-tutor**
— the tutoring lane. Success metric is "did the student understand," not
"did the model answer."

*ML pattern: sandboxing and capability limits — the model's honesty about
its own scope is the safety feature. Curriculum training: small model,
night lessons, graded growth.*

### ✦ 8. Cabbie / Buggy Horse — the passenger lane

**The rider.** Knows the streets, the shortcuts, the neighbors, the hour's
traffic. Reads the passenger's destination and mood in one glance, clarifies
before moving, changes course mid-ride without drama. The knowledge of the
city is the whole skill — and the *conversation* is the product.

**The horse.** A steady talker in the conversational lanes: **Claude Sonnet
5** and **GLM-5.3** — horses that can walk and chew gum, pleasant at the
trot, never race-hungry with a fare in the seat. (The expensive show horse
does *not* drive a cab — see Trick Rider.)

**The tack.** A persona bit with local color; clarify-first input filters
(ask where before moving); tone filters on output (friendly, efficient);
chunked directives — route in pieces, update as you go; and the cabbie's
familiars: MEMORY.md and daily notes, the growing map of streets already
driven.

**The fleet equivalent.** [REAL] The **OpenClaw main agent's Telegram
lane** — the passenger seat where Casey talks to the fleet; memory files are
literally the cabbie's knowledge of the streets. [REAL] **lucineer-brain /
lucineer-roblox** — the 4-stage chat-to-build pipeline (parse → plan →
generate → verify): a fare says "build me a lighthouse" and the cab takes
the scenic, part-by-part route, each piece fading in on the BeatClock grid —
route familiarity as choreography.

*ML pattern: conversational UX with persona consistency + memory —
multi-stage pipelines with the human kept in the cab.*

---

## ✦ The Thousand Others

Casey's seed ends with the open gate: *"a thousand others that are use-case
dependent."* Six more riders have already clarified enough to name. Each has
a template stub in `docs/templates/` like the seed eight.

**Endurance rider** — 100 miles in one sitting, pace over sprint, vet checks
at every hold. [REAL] **murmur-agent**: the all-night thinking git-agent —
every thought a commit, every insight a file. Long-running autonomous loops
that checkpoint as they go.

**Dragoon** — mounted infantry: rides fast to the position, then *dismounts
and fights on foot.* The fleet's edge lane: [REAL] **Liquid LFM2.5-2.6B** on
local Ollama (Q4_K_M, RTX 4050) — agentic, private, offline; [CONTRACT] the
F/V EILEEN boat brain, sixty miles offshore where there is no cloud to
phone. Rides the network *to* the edge, then works dismounted.

**Trick rider** — the exhibition lane: standing on the saddle at a gallop,
one spectacular pass under the lights. [REAL] **Fable 5** — expensive,
non-renewing, rationed by fleet doctrine to *golden-ticket moments only*;
**Haiku 5** — small, fast, full of wonder; **FLUX-2-max** for the concept
art on the posters. A human always holds the rope.

**Polo player** — a fast team sport where each player must hear the last
play and answer it: the fleet's iterative-banter doctrine. [REAL] The
**symphony** triad — symphony-claude (*Saldière*), symphony-kimi (*Batón*),
symphony-glm (*Slackwater*, "the models literally hear each other") — plus
DeepSeek V4-Flash ensemble rooms where each call reads the room's momentum
and plays itself alongside the others.

**Fox hunter** — scent work over rough ground: cast wide, follow the line,
cite the source when the quarry is treed. [REAL] The retrieval lanes —
bge-m3 embeddings, Vectorize, quilt's reactive cells; **Qwen3-VL** as the
hound's eyes on screenshots and terrain.

**Stagecoach driver & shotgun messenger** — the paired deployment: one rider
drives the passengers, the other rides shotgun with both barrels and one
job. [REAL] **lucineer-roblox** drives (chat to build, UX and choreography)
while **roblox-filtergate** rides shotgun — fail-closed, no negotiation.
Two riders, one coach, and the shotgun's veto is final.

> The gate stays open. When a new job clarifies its rider, the rung gets
> named, the template gets stubbed, and the taxonomy grows by one — never
> by trimming the old rungs. *Nothing here gets cut; the corral just gets
> longer fences.*

### The non-riders (for honesty)

Some of the barn's best hands never ride: the **farrier** shoes the string
(night-cycle training — LoRA grafts, kennel rung three); the **vet** keeps
the evals (earned-keep reports, drift checks); the **breeder** keeps the
bloodlines ([BREEDING.md](https://github.com/SuperInstance/superinstance/blob/main/BREEDING.md)).
They belong to the kennel side of the fence —
[THE_KENNEL.md](https://github.com/SuperInstance/superinstance/blob/main/THE_KENNEL.md)
names their rungs. The taxonomy of *riders* only claims the saddled jobs.

---

## ✦ The patterns behind the corral (honest ML appendix)

The archetypes map to production patterns with real literature behind them:

- **Routing / cascades** (jockey, pony express): small-model-first routing
  sends most traffic to cheap fast tiers and escalates only what needs it —
  the same shape as pincher-catches-then-turbo-runs. Gateway-layer routing
  (RouteLLM-style threshold routing) is the industry term for what the
  reflex table does by hash.
- **Guardrail layering** (mounted police, shotgun): input filters → runtime
  policy → output judges, each layer fail-closed — exactly filtergate's
  contract ("on any fault, return nothing at all"), and the reason
  Llama-Guard-style safety classifiers and NeMo-Guardrails-style policy
  layers feel familiar here.
- **Distillation & quantization for the edge** (kids' pony, dragoon): the
  on-device SLM lane — Q4 GGUF Wesley and Liquid LFM2.5 are textbook
  quantized students; wesley-curriculum's cloud-teachers-critique-the-local-
  student loop is agentic distillation in work clothes.
- **Batch/parallel subagents** (mule packer): embarrassingly-parallel work
  under idempotent retries — the foreman pattern this document was built by.
- **Long-horizon memory** (rancher, cabbie): persona + persistent memory +
  staged pipelines — MEMORY.md and the 4-stage chat-to-build chain.

These are industry patterns wearing fleet tack. The claim of this document
is only the mapping: **the job picks the rider; the rider picks the horse;
the tack room freezes what they wore.**

---

## ✦ Cross-links

- [README](../README.md) — the harness organs (saddle = seat, reins =
  dialogue, bit = contact) and the Roundup Loop
- [ARCHITECTURE](ARCHITECTURE.md) — ledger schemas every rider books against
- [PINCHER_TRANSPORT](PINCHER_TRANSPORT.md) — the jockey's wire contract
- [nightcycle](nightcycle.md) — where the farriers work (training contracts)
- [docs/templates/](templates/) — one frozen-state **template stub** per
  archetype (14 files; honestly labeled, not frozen — thaw, edit, freeze)
- [superinstance/THE_KENNEL.md](https://github.com/SuperInstance/superinstance/blob/main/THE_KENNEL.md)
  — the five rungs this corral stands on (nudge → harness → bloodline →
  the self-teaching yard → critical mass)
- [superinstance/workshop/kennel](https://github.com/SuperInstance/superinstance/tree/main/workshop/kennel)
  — the kennel-nugget story
- [WORKING_ANIMAL_ARCHITECTURE](https://github.com/SuperInstance/superinstance/blob/main/WORKING_ANIMAL_ARCHITECTURE.md)
  — the six-layer stack (shepherd / whistle / pasture / fence / training /
  kennel) every rider rides inside of

---

*Rider taxonomy v1 — grown from Casey's seed on 2026-08-23 by a foreman
string of CLI riders (claude drafted doctrine, GLM-5.3-via-opencode built and
geometry-checked the corral, the main agent packed the freight). The gate
stays open.*
