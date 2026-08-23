# Saddle ⇄ Pincher Transport

> How the gear talks to the nerve. Every claim below is labeled for honesty:
> what is REAL (verified against pincher's code), what is a CONTRACT (agreed
> shape, transport adapter on our side), and what is MOCK-TESTED.

Status labels used throughout:

| Label | Meaning |
|---|---|
| **[REAL]** | Verified against the pincher source. Source of truth: `study-pincher` repo, `pincher-core/src/rpc/server.rs`. |
| **[CONTRACT]** | The event SHAPE from docs/ARCHITECTURE.md ("Integration contract with pincher"). Pincher has NO outbound event stream today; the emitter side is awaited. |
| **[REAL]** (file transports) | The spool ingest / verdict-return file protocols are implemented and mock-tested on the saddle side; they need a pincher-side emitter/listener to go live. |

---

## 1. [REAL] JSON-RPC over a Unix domain socket

Pincher-core exposes an RPC server (its Python-sidecar channel). Verified
facts from `pincher-core/src/rpc/server.rs`:

- **Transport**: JSON-RPC 2.0 over a **Unix domain socket** (mode **0600**,
  owner-only).
- **Framing**: **newline-delimited** — one JSON request per line `\n`, one
  JSON response per line. The server loops `read_line` per connection and
  accepts persistent connections.
- **Request**:

  ```json
  {"jsonrpc":"2.0","id":<any>,"method":"...","params":{...}}
  ```

- **Response** (`result`/`error` mutually exclusive; both omittable when `None`):

  ```json
  {"jsonrpc":"2.0","id":<same>,"result":<value>}
  {"jsonrpc":"2.0","id":<same>,"error":{"code":-32601,"message":"..."}}
  ```

- **Parse error**: an unparseable request line gets `id: null` and
  `code: -32700`. Unknown method → `-32601`. Engine unavailable → `-32603`.

### Methods (exact strings) and result payloads

Results are serde-tagged with the method name (`#[serde(tag = "method")]`):

| Method | Params | `result` |
|---|---|---|
| `ping` | — | `{"method":"ping","pong":"pong"}` |
| `embed_text` | `{text}` | `{"method":"embed_text","embedding":[...],"dimensions":384}` |
| `match_reflex` | `{intent}` | `{"method":"match_reflex","match_type":"Exact"\|"Similar"\|"Novel","similarity":0.87,"reflex_id":"..." \| null}` |
| `teach_reflex` | `{intent, action}` | `{"method":"teach_reflex","reflex_id":"...","intent":"...","confidence":0.5}` |
| `get_status` | — | `{"method":"get_status","status":{"reflex_count":N,"action_log_count":N,"embedder_loaded":bool}}` |

Notes: `match_type` may also come back as `"error"` (engine-side match
failure is reported in-band, not as a JSON-RPC error). A failed `teach_reflex`
likewise returns empty fields rather than an error object.

### Saddle's client: `src/pincher.ts` → `PincherRpcClient`

```ts
const client = new PincherRpcClient({ socketPath: '/run/pincher/rpc.sock', timeoutMs: 5000 });
const m = await client.matchReflex('open the gate');   // typed result
const raw = await client.call('get_status');           // low-level: parsed `result`
```

- **Connection strategy: one request per connection.** Pincher's server
  accepts persistent connections, but saddle opens a fresh socket per call:
  simpler, immune to stale sockets across pincher restarts, and free at
  saddle's call volume. (Documented decision, not a protocol requirement.)
- Rejects on: socket error, timeout, response-not-JSON, or a JSON-RPC
  `error` field → throws `PincherRpcError { code, message }`. Server codes
  pass through (`-32700`, `-32601`, `-32603`); client-side codes are
  `-1` timeout, `-2` transport, `-3` bad response (exported constants).
- Zero deps — `node:net` only. No shell, no subprocess.

---

## 2. [CONTRACT] Reflex events (outbound from pincher)

**Honesty point: pincher emits NO event stream today.** docs/ARCHITECTURE.md
defines the event *shape* with the transport deliberately unnailled. Saddle
v2 ships the ingest side so the loop can close the moment pincher grows an
emitter. Shape (one JSON object per line):

```jsonc
{
  "type": "reflex.outcome",        // | "reflex.miss"
  "ts": "2026-08-23T08:00:00.000Z",
  "cellId": "fleet.cell.a",
  "runId": "run-8f3a-...",
  "reflexId": "rx-42",
  "input":  { /* debit payload */ },
  "output": { /* credit payload */ },
  "verdict": "worked",             // optional — may arrive later via reconciler
  "escalated": false               // optional, default false
}
```

---

## 3. [REAL] Spool ingest + verdict return (file transports, mock-tested)

Until pincher nails its outbound transport, the adapter is two JSONL files —
the same shape a file-tail/queue transport would carry:

```
<pool>/reflex-events.jsonl        pincher (or any emitter honoring the shape) appends
<pool>/reflex-events.jsonl.pos    saddle's byte-offset sidecar (checkpoint)
<pool>/verdicts.jsonl             saddle appends; pincher's listener layer tails
```

### Ingest: `ReflexSpoolIngest` (streams, O(chunk) memory)

```ts
const ingest = new ReflexSpoolIngest({
  spoolPath: '/pool/reflex-events.jsonl',
  ledger,                                     // saddle Ledger
  alignmentResolver: (cellId) => alignments.get(cellId),
});
await ingest.ingestAll();        // consume every complete line (bootstrap)
await ingest.ingestSinceLast();  // resume from the sidecar byte offset
```

- **Checkpoint = byte offset** in the `.pos` sidecar (safer than a line
  count), written *after* the ledger appends of that pass, atomically
  (temp file + rename — a crash never tears the sidecar itself).
- A trailing line without `\n` is treated as a torn write and left for the
  next pass; only complete lines are consumed.
- **Verdict mapping** (decided + documented):
  - `reflex.outcome` → `event.verdict ?? 'worked'`
  - `reflex.miss` → verdict `failed` (forced — a miss never earns its keep),
    note `reflex miss — no reflex earned its keep`
  - `escalated` → `event.escalated ?? false`
  - `alignmentId` → `alignmentResolver(cellId) ?? 'unaligned'`
  - debit/credit → `event.input` / `event.output` verbatim
- **Idempotence (honest limits)**: single-writer assumption — one saddle
  process ingests a given spool+ledger pair. A crash between the ledger
  appends and the sidecar write re-ingests those lines → duplicate entries
  (detectable: same `ts`+`reflexId`+`runId`; not auto-suppressed — kept
  simple in v2, no dedupe key).
- An unparseable spool line does not stall the tail: it is booked as a
  failed entry on `pincher.spool` with the parse error in the note.

### Verdict return: `VerdictReturn` (fire-and-forget)

```ts
const verdicts = new VerdictReturn({ path: '/pool/verdicts.jsonl' });
verdicts.send({ cellId, runId, reflexId, verdict: 'failed', note: 'cowboy says no' });
```

Closes the loop in the other direction: the books saddle kept flow back so
pincher's listener layer can reinforce/extinguish reflexes. Same
single-writer assumption (one saddle writes, pincher tails).

---

## 4. What must still land (the honest TODO)

1. **Pincher-side event emitter** — append `reflex.outcome` / `reflex.miss`
   JSONL to the spool (or nail a different transport; saddle's ingest adapter
   is the only thing behind that seam).
2. **Pincher-side verdict listener** — tail `verdicts.jsonl`.
3. Neither blocks saddle's ledger: pincher's RPC client ([REAL]) works today
   against a running pincher-core.
