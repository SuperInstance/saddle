/**
 * pincher.ts — transport to the reflex shell: RPC client + event spool ingest.
 *
 * Two halves, honestly labeled (see docs/PINCHER_TRANSPORT.md):
 *
 *   [REAL]   PincherRpcClient — JSON-RPC 2.0 over a Unix domain socket,
 *            newline-delimited, exactly as pincher-core's rpc/server.rs
 *            speaks it. Source of truth: study-pincher repo,
 *            pincher-core/src/rpc/server.rs.
 *   [CONTRACT] pincher has NO outbound event stream today. docs/ARCHITECTURE.md
 *            ("Integration contract with pincher") defines the event SHAPE;
 *            the transport here is a deliberately simple file adapter:
 *            pincher (or any emitter honoring the shape) appends JSONL events
 *            to a spool file; saddle tails it and appends ledger entries.
 *            Verdicts flow back through a second JSONL file (VerdictReturn)
 *            for pincher's listener layer. Awaiting a pincher-side emitter.
 *
 * Critical-path rules honored here:
 *   - spool ingest streams line by line (memory O(chunk), never O(spool))
 *   - byte-offset sidecar checkpointing (offset, not line count — safer)
 *   - no subprocess use at all, no deps
 */

import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { Ledger } from './ledger.ts';
import type { LedgerEntry } from './ledger.ts';

// ---------------------------------------------------------------------------
// [REAL] JSON-RPC client over UDS
// ---------------------------------------------------------------------------

/** Client-side error codes (JSON-RPC server codes are passed through). Also on the class: PincherRpcError.TIMEOUT / TRANSPORT / BAD_RESPONSE. */
export const PINCHER_ERR_TIMEOUT = -1;
export const PINCHER_ERR_TRANSPORT = -2;
export const PINCHER_ERR_BAD_RESPONSE = -3;

/** Error thrown for timeouts, transport failures, and JSON-RPC `error` responses. */
export class PincherRpcError extends Error {
  static readonly TIMEOUT = PINCHER_ERR_TIMEOUT;
  static readonly TRANSPORT = PINCHER_ERR_TRANSPORT;
  static readonly BAD_RESPONSE = PINCHER_ERR_BAD_RESPONSE;
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = 'PincherRpcError';
    this.code = code;
  }
}

/** Wire response envelope. `result`/`error` are mutually exclusive, both omittable. */
interface JsonRpcResponse {
  jsonrpc: string;
  id: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Typed result payloads — serde-tagged with the method name, as pincher returns them. */
export interface PingResult {
  method: 'ping';
  pong: string;
}

export interface EmbedTextResult {
  method: 'embed_text';
  embedding: number[];
  dimensions: number;
}

export interface MatchReflexResult {
  method: 'match_reflex';
  match_type: 'Exact' | 'Similar' | 'Novel' | string; // engine also reports 'error'
  similarity: number;
  reflex_id: string | null;
}

export interface TeachReflexResult {
  method: 'teach_reflex';
  reflex_id: string;
  intent: string;
  confidence: number;
}

export interface EngineStatus {
  reflex_count: number;
  action_log_count: number;
  embedder_loaded: boolean;
}

export interface GetStatusResult {
  method: 'get_status';
  status: EngineStatus;
}

export interface PincherRpcClientOptions {
  socketPath: string;
  /** per-call timeout in ms (default 5000) */
  timeoutMs?: number;
}

/**
 * JSON-RPC 2.0 client for pincher's UDS server.
 *
 * Connection strategy: ONE REQUEST PER CONNECTION. Pincher's server accepts
 * persistent connections (it loops `read_line` per stream), but per-call
 * connections are simpler, avoid stale-socket state after pincher restarts,
 * and cost nothing at saddle's call volume. Documented deliberately.
 */
export class PincherRpcClient {
  readonly socketPath: string;
  readonly timeoutMs: number;
  private nextId = 0;

  constructor(opts: PincherRpcClientOptions) {
    this.socketPath = opts.socketPath;
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  /** Low-level: send one request line, resolve with the parsed `result`. */
  call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      let buffer = '';
      let settled = false;

      const socket = net.connect(this.socketPath);

      const finish = (err: PincherRpcError | null, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (err) reject(err);
        else resolve(value);
      };

      const timer = setTimeout(
        () => finish(new PincherRpcError(PINCHER_ERR_TIMEOUT, `pincher rpc timeout after ${this.timeoutMs}ms (${method})`)),
        this.timeoutMs
      );

      socket.on('connect', () => {
        const line = JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} });
        socket.write(line + '\n', 'utf8');
      });

      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const nl = buffer.indexOf('\n');
        if (nl === -1) return; // response line not fully arrived yet
        const line = buffer.slice(0, nl).trim();
        if (!line) {
          finish(new PincherRpcError(PINCHER_ERR_BAD_RESPONSE, `pincher sent an empty response line (${method})`));
          return;
        }
        let msg: JsonRpcResponse;
        try {
          msg = JSON.parse(line) as JsonRpcResponse;
        } catch (e) {
          finish(new PincherRpcError(PINCHER_ERR_BAD_RESPONSE, `pincher response was not valid JSON (${method}): ${(e as Error).message}`));
          return;
        }
        if (msg.error) {
          finish(new PincherRpcError(msg.error.code, msg.error.message));
          return;
        }
        finish(null, msg.result);
      });

      socket.on('error', (err: NodeJS.ErrnoException) => {
        finish(new PincherRpcError(PINCHER_ERR_TRANSPORT, `pincher socket error (${method}): ${err.message}`));
      });

      socket.on('close', () => {
        if (!settled) {
          finish(new PincherRpcError(PINCHER_ERR_TRANSPORT, `pincher socket closed before a response arrived (${method})`));
        }
      });
    });
  }

  async ping(): Promise<PingResult> {
    return (await this.call('ping')) as PingResult;
  }

  async embedText(text: string): Promise<EmbedTextResult> {
    return (await this.call('embed_text', { text })) as EmbedTextResult;
  }

  async matchReflex(intent: string): Promise<MatchReflexResult> {
    return (await this.call('match_reflex', { intent })) as MatchReflexResult;
  }

  async teachReflex(intent: string, action: string): Promise<TeachReflexResult> {
    return (await this.call('teach_reflex', { intent, action })) as TeachReflexResult;
  }

  async getStatus(): Promise<GetStatusResult> {
    return (await this.call('get_status')) as GetStatusResult;
  }
}

// ---------------------------------------------------------------------------
// [CONTRACT] Event shape (docs/ARCHITECTURE.md) + spool ingest
// ---------------------------------------------------------------------------

/** The event pincher emits — the SHAPE is the contract; transport is the spool file. */
export interface PincherEvent {
  type: 'reflex.outcome' | 'reflex.miss';
  ts: string;
  cellId: string;
  runId: string;
  reflexId: string;
  /** debit payload — what went in */
  input: unknown;
  /** credit payload — what came out */
  output: unknown;
  /** may be set later by a reconciler pass */
  verdict?: 'worked' | 'failed';
  escalated?: boolean;
}

/** Maps a cellId to the frozen alignment in effect; unset fields fall back to 'unaligned'. */
export type AlignmentResolver = (cellId: string) => string | undefined;

export interface ReflexSpoolIngestOptions {
  spoolPath: string;
  ledger: Ledger;
  alignmentResolver?: AlignmentResolver;
}

export interface IngestResult {
  /** ledger entries appended this call */
  entries: LedgerEntry[];
  /** new byte offset checkpointed in the sidecar */
  offset: number;
}

/**
 * Tails a JSONL event spool (append-only) and books one ledger entry per event.
 *
 * Verdict mapping (decided + documented):
 *   - reflex.outcome → event.verdict ?? 'worked'
 *   - reflex.miss    → verdict 'failed' (forced — a miss never earns its keep),
 *                      note 'reflex miss — no reflex earned its keep'
 *   - escalated      → event.escalated ?? false
 *   - alignmentId    → resolver(cellId) ?? 'unaligned'
 *
 * Idempotence (honest): the sidecar `.pos` file stores the byte offset of the
 * last fully-consumed line and is updated AFTER the ledger appends. A crash
 * between append and sidecar write re-ingests those lines on restart →
 * duplicate entries. Single-writer assumption: one saddle process ingests a
 * given spool+ledger pair at a time. No dedupe key in v2 — duplicates are
 * detectable (same ts+reflexId+runId) but not auto-suppressed. Kept simple.
 */
export class ReflexSpoolIngest {
  readonly spoolPath: string;
  readonly sidecarPath: string;
  private readonly ledger: Ledger;
  private readonly alignmentResolver: AlignmentResolver;

  constructor(opts: ReflexSpoolIngestOptions) {
    this.spoolPath = opts.spoolPath;
    this.sidecarPath = opts.spoolPath + '.pos';
    this.ledger = opts.ledger;
    this.alignmentResolver = opts.alignmentResolver ?? (() => undefined);
  }

  /** Ingest EVERY complete line currently in the spool (ignores the checkpoint). */
  async ingestAll(): Promise<IngestResult> {
    return this.ingestFrom(0);
  }

  /** Resume from the sidecar byte offset; only new complete lines are consumed. */
  async ingestSinceLast(): Promise<IngestResult> {
    return this.ingestFrom(this.readOffset());
  }

  private readOffset(): number {
    if (!fs.existsSync(this.sidecarPath)) return 0;
    const raw = fs.readFileSync(this.sidecarPath, 'utf8').trim();
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  /** Atomic checkpoint write: temp file + rename, so a crash never tears the sidecar. */
  private writeOffset(offset: number): void {
    fs.mkdirSync(path.dirname(this.sidecarPath), { recursive: true });
    const tmp = this.sidecarPath + '.tmp';
    fs.writeFileSync(tmp, `${offset}\n`, 'utf8');
    fs.renameSync(tmp, this.sidecarPath);
  }

  /**
   * Stream lines from `start`, memory O(chunk). A trailing line with no `\n`
   * is treated as a partial write in progress and left for the next pass.
   */
  private async ingestFrom(start: number): Promise<IngestResult> {
    const entries: LedgerEntry[] = [];
    if (!fs.existsSync(this.spoolPath)) {
      return { entries, offset: start };
    }
    const size = fs.statSync(this.spoolPath).size;
    if (size <= start) return { entries, offset: start };

    const endsWithNewline = this.fileEndsWithNewline();

    const rl = readline.createInterface({
      input: fs.createReadStream(this.spoolPath, { encoding: 'utf8', start }),
      crlfDelay: Infinity,
    });

    let offset = start;
    // Stream line by line — memory O(1) in line count, never O(spool).
    // A trailing line with no `\n` is a partial write in progress: leave it
    // (and its bytes) for the next pass by never advancing past it.
    for await (const line of rl) {
      const lineLen = Buffer.byteLength(line, 'utf8') + 1; // + newline
      if (!endsWithNewline && offset + lineLen >= size) break; // partial tail
      offset += lineLen;
      const trimmed = line.trim();
      if (!trimmed) continue; // blank line: offset advances, no entry
      let event: PincherEvent;
      try {
        event = JSON.parse(trimmed) as PincherEvent;
      } catch (e) {
        // A malformed line is data about the emitter, not a reason to stall.
        entries.push(
          this.ledger.append({
            cellId: 'pincher.spool',
            runId: 'spool',
            alignmentId: 'unaligned',
            debit: trimmed,
            credit: null,
            verdict: 'failed',
            escalated: false,
            note: `unparseable spool line: ${(e as Error).message}`,
          })
        );
        continue;
      }
      entries.push(this.appendEvent(event));
    }

    this.writeOffset(offset);
    return { entries, offset };
  }

  private appendEvent(event: PincherEvent): LedgerEntry {
    const isMiss = event.type === 'reflex.miss';
    const verdict = isMiss ? 'failed' : (event.verdict ?? 'worked');
    return this.ledger.append({
      cellId: event.cellId,
      runId: event.runId,
      alignmentId: this.alignmentResolver(event.cellId) ?? 'unaligned',
      debit: event.input ?? null,
      credit: event.output ?? null,
      verdict,
      escalated: event.escalated ?? false,
      ...(isMiss ? { note: 'reflex miss — no reflex earned its keep' } : {}),
    });
  }

  private fileEndsWithNewline(): boolean {
    const fd = fs.openSync(this.spoolPath, 'r');
    try {
      const stat = fs.fstatSync(fd);
      if (stat.size === 0) return true;
      const buf = Buffer.alloc(1);
      fs.readSync(fd, buf, 0, 1, stat.size - 1);
      return buf[0] === 0x0a;
    } finally {
      fs.closeSync(fd);
    }
  }
}

// ---------------------------------------------------------------------------
// [REAL] Verdict return file (mock-tested)
// ---------------------------------------------------------------------------

export interface VerdictMessage {
  cellId: string;
  runId: string;
  reflexId: string;
  verdict: 'worked' | 'failed';
  note?: string;
}

/**
 * Appends verdict JSONL for pincher's listener layer to consume. Fire-and-forget:
 * a failed/missed reflex gets its bookkeeping closed on the pincher side too.
 * Same single-writer assumption as the spool: one saddle writes, pincher tails.
 */
export class VerdictReturn {
  readonly path: string;

  constructor(opts: { path: string }) {
    this.path = opts.path;
  }

  send(msg: VerdictMessage): void {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    fs.appendFileSync(this.path, JSON.stringify(msg) + '\n', 'utf8');
  }
}
