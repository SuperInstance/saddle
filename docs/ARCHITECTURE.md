# Saddle — Architecture

> The cowboy's gear, drawn on paper. Docs are first-class: this file is the
> truth the code serves.

---

## ✦ Module Map

```
saddle/
├── README.md               mission + the Roundup Loop (start here)
├── docs/
│   ├── ARCHITECTURE.md     ← you are here
│   ├── PINCHER_TRANSPORT.md  saddle ⇄ pincher wire contract ([REAL]/[CONTRACT] labeled)
│   └── nightcycle.md       night-cycle philosophy + training-pass contracts
├── src/
│   ├── hash.ts             FNV-1a 64 canonical hashing primitive (no deps)
│   ├── ledger.ts           append-only double-entry store (JSONL, hash-chained)
│   ├── frozens.ts          content-addressed frozen alignment states (0444)
│   ├── pincher.ts          pincher transport: JSON-RPC/UDS client + reflex spool ingest + verdict return
│   ├── cells.ts            cell decomposition: tiny schemas, workflows, CellRunner
│   ├── cellrunner.ts       single-cell runner: frozen alignment + injected adapter, books per attempt
│   ├── nightcycle.ts       stub runner: walks ledger → earned-keep report + suggested actions
│   └── index.ts            barrel export
├── examples/
│   └── parse-decide-act.ts 3-cell workflow demo (flaky mock model → retry chain in the ledger)
├── test/
│   ├── ledger.test.ts
│   ├── frozens.test.ts
│   ├── pincher.test.ts     mock pincher UDS server (exact wire protocol) + spool tests
│   ├── cells.test.ts       schema/workflow validation + runner scenarios
│   ├── cellrunner.test.ts  single-cell runner: retries, escalation, tampered-frozen guard
│   └── nightcycle.test.ts
└── package.json            zero runtime deps · Node ≥ 22.18 (native TS)
```

| Module | Responsibility | Critical-path rules honored |
|---|---|---|
| `hash.ts` | Deterministic FNV-1a 64-bit hash over canonical JSON. No deps. | — |
| `ledger.ts` | Double-entry bookkeeping per cell. Append-only JSONL. Hash chain (each entry commits to the previous). Streaming reads; O(1) tail for appends. | Memory O(chunk): reads stream line-by-line; appends read only the last line. |
| `frozens.ts` | Frozen alignment states: manifest hash = content address; written once, mode 0444, verified on load. | No overwrite ever; tamper detection on load. |
| `pincher.ts` | Transport to the reflex shell. [REAL] `PincherRpcClient` — JSON-RPC 2.0 over UDS, newline-delimited, per pincher-core's rpc/server.rs. [CONTRACT] `PincherEvent` shape + `ReflexSpoolIngest` (JSONL spool tailed, byte-offset sidecar) + `VerdictReturn` (verdict JSONL written back). | Spool ingest streams O(chunk); no subprocess, no deps. |
| `cells.ts` | Cell decomposition: `SchemaSpec` (deliberately tiny — not JSON Schema), `CellSpec`/`Workflow` with ref-implied DAG edges, `validateWorkflow` (unique ids, resolvable refs, no cycles), `CellRunner` (topological execution, one ledger entry per attempt, retryOf chains to the immediately previous attempt, deterministic input violations escalate without retries, escalation skips only transitive dependents — independent branches keep their partial results). Every run ends with ONE summary entry (`workflow.<id>`). Model bindings only ever call an injected `ModelInvoker`. Memory is O(nodes × payload) per run — never O(corpus); huge payloads should be externalized, the ledger is for books not cargo. | No model calls in core; no subprocess; no deps; bindings must never close over secrets (functions are never serialized). |
| `cellrunner.ts` | Runs ONE cell with a frozen alignment pinned: thaws + verifies the frozen state (throws before any append on tamper), builds the full prompt context as debit, calls an injected `CellAdapter`, parses credit, retries with retryOf, escalates with a `gave up:` note. | Tampered frozens never reach the ledger. |
| `nightcycle.ts` | Streams the ledger and aggregates per-alignment / per-cell stats; emits a markdown or JSON summary with suggested actions (keep/thaw/refreeze — data only, never auto-applied). | Memory O(counters), never O(corpus). No subprocess use at all; any future subprocess is list-form only (no `shell: true`). |
| tests | `node:test` + `node:assert/strict`. No framework deps. | — |

## ✦ Data Schemas

### 1. Corpus / Ledger entry (double-entry format)

One JSON object per line, append-only, hash-chained:

```jsonc
{
  "seq": 42,                        // monotonic per ledger file
  "ts": "2026-08-23T07:56:00.000Z", // ISO 8601
  "cellId": "wesley.storytime.open",// which neural cell kept the books
  "runId": "run-8f3a-...",         // a run spans many cells
  "alignmentId": "a1b2c3d4...",     // frozen state in effect (links to frozens)
  "debit":  "{\"prompt\":\"...\"}",  // INPUT GIVEN   — cost side (JSON-encoded)
  "credit": "{\"story\":\"...\"}",   // OUTPUT RETURNED — value side (JSON-encoded)
  "verdict": "worked",              // "worked" | "failed" — the greater system's verdict
  "escalated": false,               // true → cell requests cowboy attention
  "note": "",                       // free text, optional
  "retryOf": 41,                    // optional: seq of the entry this retried
  "prevHash": "9c8b...",            // hash of previous entry ("" for genesis)
  "hash": "1a2b..."                 // FNV-1a64 of this entry minus `hash`
}
```

Rules:

- **Debit = what went in. Credit = what came out.** The verdict is the greater
  system's judgment of whether the credit was worth the debit.
- A retry is a *new entry* referencing `retryOf`. History is never rewritten.
- Escalation (`escalated: true`) means the cell gave up on autonomy and is
  asking the harness (the cowboy) for attention.
- Chain integrity: `hash = fnv1a64(canonicalJson(entryWithoutHash))`, and the
  next entry's `prevHash` must equal it. Tamper-evident, not tamper-proof.

### 2. Frozen state manifest

Stored at `frozens/<alignmentId>.json`, mode 0444, one write ever:

```jsonc
{
  "id": "wesley-storytime-v3",        // human name
  "alignmentId": "a1b2c3d4e5f6...",   // == manifest hash (content-addressed)
  "createdAt": "2026-08-23T07:56:00.000Z",
  "model": "haiku-5",                 // per model
  "useCase": "evening storytime",     // per job
  "prompt": "You are Wesley...",      // system-prompt variant
  "inputFilters": [                   // applied before the model sees input
    { "id": "no-instructions-after-dark",
      "kind": "deny",
      "description": "block directive chunks delivered out of order",
      "pattern": "" }
  ],
  "outputFilters": [                  // applied before output becomes credit
    { "id": "no-scary-endings",
      "kind": "deny",
      "description": "kid-safe endings only",
      "pattern": "" }
  ],
  "params": { "temperature": 0.8 },   // sampling params
  "directiveChunks": [                // CHUNKED DIRECTIVE PROTOCOL:
    "chunk 1: read this",             // instructions sent in PIECES so the
    "chunk 2: repeat it back",        // model dogfoods understanding before
    "chunk 3: now act"                // an action is requested
  ]
}
```

- `alignmentId = fnv1a64(canonicalJson(state minus alignmentId))`.
- Saving an identical state twice is a no-op (content-addressing dedupes).
- Saving different content under an existing `alignmentId` throws — that's a
  hash collision or tampering, not a normal event.

### 3. Night-cycle summary report

Emitted by the stub runner; JSON shape (also rendered as markdown):

```jsonc
{
  "generatedAt": "...",
  "ledgerPath": "data/ledger.jsonl",
  "entries": 1024,
  "alignments": [
    { "alignmentId": "a1b2...", "worked": 180, "failed": 4,
      "escalated": 1, "keepRatio": 0.978, "earnedKeep": true,
      "suggestion": {                       // v2: data only — never auto-applied
        "action": "refreeze",               // "keep" | "thaw" | "refreeze"
        "reason": "stable and proven: 180 worked at 97.8% keep ratio" } }
  ],
  "cells": [
    { "cellId": "wesley.storytime.open", "worked": 42, "failed": 2,
      "escalated": 1 }
  ],
  "escalations": [ { "seq": 991, "cellId": "...", "note": "..." } ],
  "cowboyNeeded": [ { "seq": 991, "cellId": "...", "alignmentId": "...", "note": "..." } ]
}
```

Suggestion rules (see `suggestForAlignment` in `src/nightcycle.ts`):
- fewer than 5 samples → `keep` / "insufficient data"
- `thaw` when keepRatio < 0.75 (the `EARNED_KEEP_THRESHOLD`) or the
  escalation rate exceeds 20%
- `refreeze` when earned keep AND ≥ 20 worked AND keepRatio ≥ 0.95
  (stable + proven → candidate to pin/re-freeze)
- otherwise `keep`

### 4. Pincher event (spool line) — [CONTRACT] shape, see docs/PINCHER_TRANSPORT.md

One JSON object per line in the reflex spool; saddle books one ledger entry per event:

```jsonc
{
  "type": "reflex.outcome",        // | "reflex.miss"
  "ts": "2026-08-23T08:00:00.000Z",
  "cellId": "fleet.cell.a",
  "runId": "run-8f3a-...",
  "reflexId": "rx-42",
  "input":  { /* debit payload */ },
  "output": { /* credit payload */ },
  "verdict": "worked",             // optional; reflex.outcome defaults to 'worked'
  "escalated": false               // optional, default false
}
```

### 5. Cell schemas and workflow (src/cells.ts)

`SchemaSpec` is deliberately NOT JSON Schema — field name → type from a
closed set (`string|number|boolean|object|array|any`), plus `required` /
`optional` lists. If `required` is omitted, every declared field not in
`optional` is required. Unknown fields on a value pass (lenient).

```jsonc
// a cell: one dog, one job, books per attempt
{
  "id": "fleet.parse.intent",            // dot-namespaced (convention only)
  "input":  { "fields": { "raw": "string" } },
  "output": { "fields": { "intent": "string" } },
  "binding": { "kind": "fn", "fn": "..." }          // or:
              // { "kind": "model", "model": "haiku-5", "alignmentId": "a1b2..." }
  "retryBudget": 2,                       // default 2 → 1+2 total attempts
  "note": "normalize raw user text"
}

// a workflow: DAG implied by input refs
{
  "id": "parse-decide-act",
  "trigger": { "fields": { "text": "string" } },
  "nodes": [
    { "cell": "<parse>",  "inputs": { "raw":   "@trigger.text" } },
    { "cell": "<decide>", "inputs": { "intent": "fleet.parse.intent.intent" } },
    { "cell": "<act>",    "inputs": { "action": "fleet.decide.action.action" } }
  ]
}
```

Run result (`CellRunner.run` → `WorkflowRunResult`): per-node
`status: worked|failed|escalated|skipped`, `attempts`, `output`, `entrySeqs`
(every ledger entry the node produced, retries + escalation included), plus
`summarySeq` — the run's single summary entry. Skipped nodes keep NO books —
they never ran — but the summary entry records every node's final status, so
post-mortems never depend on replay. v2 semantics: an escalation skips only
the nodes transitively DOWNSTREAM of the failed node; independent branches
(and the healthy side of a diamond) still run. Retries chain `retryOf` to the
immediately previous attempt (walk the links back to find the first). A
deterministic input-schema violation escalates immediately — burning retry
budget on an identical retry would be bookkeeping theater.

## ✦ Night-cycle scheduler design (cron-able)

The runner is a pure function of (ledger, frozens) → report, so it slots into
any scheduler:

```cron
# crontab -e — the kennel goes to work at 02:30
30 2 * * *  cd /opt/saddle && node src/nightcycle.ts data/ledger.jsonl \
            --out reports/$(date +\%F)-nightcycle.md >> logs/nightcycle.log 2>&1
```

Systemd timer equivalent (fleet rule: long-lived processes under systemd):

```ini
# saddle-nightcycle.timer — OnCalendar=*-*-* 02:30:00, Persistent=true
# saddle-nightcycle.service — MemoryMax=256M, ExecStart=node src/nightcycle.ts ...
```

Future passes (contracts only — see docs/nightcycle.md):

1. **Sim/shadow pass** — replay frozen alignments against recorded debits,
   score shadow credits against recorded verdicts.
2. **Corpus crunch** — stream the ledger into per-cell training shards for
   LoRA/micro-model jobs (chunked, checkpointed; never O(corpus) memory).
3. **Cell decomposition pass** — propose splits for cells whose ledgers show
   mixed responsibilities (verdict variance inside one cellId).

## ✦ Integration contract with pincher

Saddle consumes outcomes from pincher; it never blocks the reflex path
(pincher must stay <50ms, no LLM). The contract is fire-and-forget from
pincher's side:

| | Pincher (reflex shell) | Saddle (harness) |
|---|---|---|
| Direction | **emits** reflex/outcome events | **subscribes**, appends to ledger |
| Latency budget | <50ms, zero marginal cost | unbounded (async, batched) |
| Failure mode | reflex fires or misses | entry logged either way — misses are data too |
| State | reflex database (vector store) | ledger corpus + frozen states |

Event shape pincher emits (transport-agnostic: file tail, queue, or IPC —
the *shape* is the contract; v2 ships a JSONL spool adapter on saddle's side,
honestly labeled [CONTRACT] since pincher has no emitter yet — full protocol
in [docs/PINCHER_TRANSPORT.md](PINCHER_TRANSPORT.md)):

```jsonc
{
  "type": "reflex.outcome",        // | "reflex.miss"
  "ts": "...",
  "cellId": "...",                 // where the pinch happened
  "runId": "...",
  "reflexId": "...",               // pincher reflex that fired
  "input": { /* debit payload */ },
  "output": { /* credit payload */ },
  "verdict": "worked" | "failed",  // may be set later by a reconciler pass
  "escalated": false
}
```

Saddle maps `reflex.outcome` → ledger entry verbatim; `reflex.miss` is logged
with `verdict: "failed"` and a note — a miss is a reflex that didn't earn its
keep, which is exactly the data night cycles need.

**Alignment loop:** saddle's frozen states feed *back* to pincher as veto/
rewrite filters (pincher's listener layer) — an output filter frozen here
becomes a reflex-side veto there. Gear fits both horse and rider.

## ✦ Critical-path rules (inherited from the fleet)

1. **Subprocess list-form only.** `subprocess.run([...])` / `execFile` — no
   `shell: true`, no string commands. (v0.1 core spawns nothing.)
2. **Memory O(chunk) or O(batch), never O(corpus) or O(duration).** Ledger
   reads stream; nightcycle keeps counters, not entries. Anything that
   processes unbounded input must stream and checkpoint.
3. **Databases, spools, scratch live on ext4** (`/home/...`), never `/mnt/c`.
4. **No hardcoded secrets.** Keys arrive via env/config, and nothing secret
   ever enters the ledger.
5. **Long-lived processes run under systemd**, not tmux; the nightcycle timer
   follows that rule when deployed.
