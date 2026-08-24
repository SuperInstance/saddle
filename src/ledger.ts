/**
 * ledger.ts — append-only double-entry store for the fleet's cells.
 *
 * Every cell keeps books like a merchant:
 *   debit  = the input it was given       (cost side)
 *   credit = the output it returned       (value side)
 *   verdict = the greater system's judgment — worked or didn't
 *   escalated = the cell gave up on autonomy and asked the cowboy for attention
 *
 * Storage: one JSON object per line (JSONL), hash-chained — each entry commits
 * to the hash of the one before it. Append-only: history is never rewritten.
 * Tamper-evident, not tamper-proof.
 *
 * Critical-path rules honored here:
 *   - reads STREAM line by line (memory O(chunk), never O(corpus))
 *   - appends touch only the last line (O(1) tail)
 *   - no subprocess use at all
 *
 * Single-writer assumption: one process appends to a ledger file at a time.
 * Nightcycle and other readers may stream concurrently — appends are atomic
 * line writes.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { hashValue } from './hash.ts';

export type Verdict = 'worked' | 'failed';

/**
 * v3 verdict semantics — the old `verdict: 'failed'` was overloaded: it meant
 * both "the line failed QC" (a SUCCESSFUL judgment) and "the cell failed to
 * judge". The kinds split those explicitly:
 *
 *   worked          — the cell produced a passing judgment/output
 *   judgment-fail   — the cell produced a REAL judgment and the judgment was
 *                     a fail. A completed judgment: never retried, never
 *                     escalated. Retrying it would double-spend the run.
 *   execution-error — the cell failed to produce anything (adapter threw,
 *                     output unparseable). Retryable.
 *   escalated       — execution errors exhausted maxAttempts; the cell gave
 *                     up and the cowboy must look.
 *
 * Legacy fields (`verdict`, `escalated`) stay and stay consistent for old
 * readers: worked→worked/false; judgment-fail→failed/false;
 * execution-error→failed/false (retryable); escalated→failed/true.
 */
export type VerdictKind = 'worked' | 'judgment-fail' | 'execution-error' | 'escalated';

/**
 * v4 orthogonal outcome facts (SEAM-REPORT §1.4): process-level facts about
 * HOW an attempt ended, reported flat and independent — a process can time
 * out AND exit 0. Absent on all pre-v4 entries (they parse and hash-verify
 * unchanged). Never nested inside error strings.
 */
export interface OutcomeFact {
  timedOut?: boolean;
  signal?: number;
  exitCode?: number;
}

export interface LedgerEntry {
  seq: number;
  ts: string;
  cellId: string;
  runId: string;
  alignmentId: string;
  /** input given — JSON-encoded string (the cost side of the books) */
  debit: string;
  /** output returned — JSON-encoded string (the value side of the books) */
  credit: string;
  verdict: Verdict;
  escalated: boolean;
  /**
   * v3 explicit outcome kind. OPTIONAL so pre-v3 ledgers still parse and still
   * hash-verify (the field is simply absent there); new entries always carry
   * it, and it participates in the entry hash like every other field.
   */
  verdictKind?: VerdictKind;
  note?: string;
  /** seq of the entry this one retried; retries are new entries, never rewrites */
  retryOf?: number;
  /** v4 orthogonal process facts (see OutcomeFact); absent on pre-v4 entries */
  outcome?: OutcomeFact;
  /** hash of the previous entry ('' for the genesis entry) */
  prevHash: string;
  /** FNV-1a64 of this entry minus the `hash` field */
  hash: string;
}

/** What a caller provides to `append` — everything else is derived. */
export interface NewEntry {
  cellId: string;
  runId: string;
  alignmentId: string;
  /** input given — any JSON-serializable value; stored encoded */
  debit: unknown;
  /** output returned — any JSON-serializable value; stored encoded */
  credit: unknown;
  verdict: Verdict;
  escalated: boolean;
  /** v3 outcome kind; omit only when writing legacy-shape entries on purpose */
  verdictKind?: VerdictKind;
  note?: string;
  retryOf?: number;
  /** v4 outcome facts; omit when writing pre-v4-shape entries on purpose */
  outcome?: OutcomeFact;
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  badSeq?: number;
  reason?: string;
}

/** Compute an entry's chain hash (everything but the `hash` field itself). */
export function entryHash(entry: Omit<LedgerEntry, 'hash'>): string {
  const { hash: _ignored, ...rest } = entry as LedgerEntry;
  return hashValue(rest);
}

/**
 * Migration reader: derive the v3 VerdictKind for any entry, including the
 * pre-v3 ledgers that predate the field. New entries return their stamped
 * `verdictKind` as-is; legacy entries are classified by what the old writers
 * actually put in the books:
 *
 *   escalated                  → 'escalated'  (give-up always marked itself)
 *   verdict 'worked'           → 'worked'
 *   verdict 'failed'           → 'execution-error' when the credit is/contains
 *     an error — a credit OBJECT with an `error` key (field-trial style) or a
 *     STRING credit starting `parse failed:` / `adapter error:` (the old core
 *     cellrunner wrote those) — else 'judgment-fail' (a clean credit under a
 *     failed verdict is a completed QC judgment).
 */
export function resolveVerdictKind(entry: LedgerEntry): VerdictKind {
  if (entry.verdictKind !== undefined) return entry.verdictKind;
  if (entry.escalated) return 'escalated';
  if (entry.verdict === 'worked') return 'worked';
  // verdict 'failed', not escalated: the credit decides judgment vs error
  let credit: unknown;
  try {
    credit = JSON.parse(entry.credit);
  } catch {
    return 'judgment-fail'; // unreadable credit carries no error signature we know
  }
  if (typeof credit === 'string') {
    if (credit.startsWith('parse failed:') || credit.startsWith('adapter error:')) return 'execution-error';
    return 'judgment-fail';
  }
  if (credit !== null && typeof credit === 'object' && !Array.isArray(credit) && 'error' in credit) {
    return 'execution-error';
  }
  return 'judgment-fail';
}

const TAIL_WINDOW = 64 * 1024; // bytes to inspect from the end for O(1) tail

export class Ledger {
  readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** Append one double-entry. Returns the full, hash-chained entry. */
  append(input: NewEntry): LedgerEntry {
    const last = this.tailEntry();
    const entry: Omit<LedgerEntry, 'hash'> = {
      seq: last ? last.seq + 1 : 1,
      ts: new Date().toISOString(),
      cellId: input.cellId,
      runId: input.runId,
      alignmentId: input.alignmentId,
      debit: JSON.stringify(input.debit ?? null),
      credit: JSON.stringify(input.credit ?? null),
      verdict: input.verdict,
      escalated: input.escalated,
      ...(input.verdictKind !== undefined ? { verdictKind: input.verdictKind } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.retryOf !== undefined ? { retryOf: input.retryOf } : {}),
      ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
      prevHash: last ? last.hash : '',
    };
    const full: LedgerEntry = { ...entry, hash: entryHash(entry) };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.appendFileSync(this.filePath, JSON.stringify(full) + '\n', 'utf8');
    return full;
  }

  /**
   * O(1) tail: read only the last window of bytes, return the last entry.
   * This is why appends stay cheap as the ledger grows.
   */
  tailEntry(): LedgerEntry | null {
    if (!fs.existsSync(this.filePath)) return null;
    const fd = fs.openSync(this.filePath, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      if (size === 0) return null;
      const window = Math.min(size, TAIL_WINDOW);
      const buf = Buffer.alloc(window);
      fs.readSync(fd, buf, 0, window, size - window);
      const lines = buf.toString('utf8').split('\n').filter((l) => l.trim());
      if (lines.length === 0) return null;
      const last = lines[lines.length - 1];
      return last !== undefined ? (JSON.parse(last) as LedgerEntry) : null;
    } finally {
      fs.closeSync(fd);
    }
  }

  /**
   * Stream every entry, line by line. Memory stays O(chunk) no matter how
   * many entries the ledger holds. Use this — never readFileSync a corpus.
   */
  async *stream(): AsyncGenerator<LedgerEntry> {
    if (!fs.existsSync(this.filePath)) return;
    const rl = readline.createInterface({
      input: fs.createReadStream(this.filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (trimmed) yield JSON.parse(trimmed) as LedgerEntry;
    }
  }

  /** Stream and count entries — O(1) memory. */
  async count(): Promise<number> {
    let n = 0;
    for await (const _entry of this.stream()) n++;
    return n;
  }

  /**
   * Verify the hash chain end to end, streaming. Detects rewritten history
   * (a stale prevHash), forged entries (hash mismatch), and out-of-order seq.
   */
  async verify(): Promise<VerifyResult> {
    let checked = 0;
    let prevHash = '';
    let expectedSeq = 1;
    for await (const entry of this.stream()) {
      if (entry.seq !== expectedSeq) {
        return { ok: false, checked, badSeq: entry.seq, reason: `expected seq ${expectedSeq}, found ${entry.seq}` };
      }
      if (entry.prevHash !== prevHash) {
        return { ok: false, checked, badSeq: entry.seq, reason: `broken chain link at seq ${entry.seq}` };
      }
      const recomputed = entryHash(entry);
      if (recomputed !== entry.hash) {
        return { ok: false, checked, badSeq: entry.seq, reason: `hash mismatch at seq ${entry.seq} (entry was rewritten?)` };
      }
      prevHash = entry.hash;
      expectedSeq++;
      checked++;
    }
    return { ok: true, checked };
  }
}
