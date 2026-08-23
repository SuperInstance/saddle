/**
 * frozens.ts — frozen alignment states, content-addressed and immutable on disk.
 *
 * A frozen state is a complete alignment bundle pinned to a use case:
 *   system prompt + input filters + output filters + params + chunked directives
 *
 * Freeze semantics:
 *   - the manifest hash IS the content address: frozens/<alignmentId>.json
 *   - written ONCE, mode 0444 (read-only) — saddle never overwrites a frozen state
 *   - re-freezing identical content is a no-op (content addressing dedupes)
 *   - loading always re-verifies the hash; a mismatch throws
 *   - you don't edit a frozen state — thaw a copy, edit, freeze a new one
 *
 * Jobs (and ledger entries) pin themselves to alignmentId so the cowboy can
 * always answer: "what exactly was the dog wearing when it did that work?"
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { hashValue, canonicalJson } from './hash.ts';

export type FilterKind = 'deny' | 'allow' | 'transform';

export interface FilterSpec {
  id: string;
  kind: FilterKind;
  description: string;
  /** optional pattern (regex/glob/keyword — interpreted by the harness side) */
  pattern?: string;
}

/** The writable form — alignmentId and createdAt are derived on freeze. */
export interface AlignmentDraft {
  id: string;
  model: string;
  useCase: string;
  /** system-prompt variant */
  prompt: string;
  /** applied before the model sees input */
  inputFilters: FilterSpec[];
  /** applied before output becomes credit */
  outputFilters: FilterSpec[];
  /** sampling params: temperature, top_p, ... */
  params: Record<string, number | string | boolean>;
  /**
   * Chunked directive protocol: instructions sent in PIECES so the model
   * dogfoods understanding before an action is requested.
   */
  directiveChunks: string[];
  /**
   * Declared earned-keep metric for this cell kind (v3, field-trial-1 gap 2):
   *   - 'production'      — judgmentsProduced / final runs. The JUDGE metric:
   *                          a strict judge that fails bad subjects still earned its keep.
   *   - 'task-approval'   — worked / (worked + failed). The ACTOR metric: a cell
   *                          whose job is to succeed at its task, not to judge others.
   * Defaults to 'production' (omitted in old frozens reads the same as before).
   * Declaring it here means the frozen state itself says what "earned its keep"
   * means for this kind of cell — the nightcycle reads the declaration.
   */
  earnedKeepMetric?: 'production' | 'task-approval';
}

/** A frozen state as it lives on disk. */
export interface FrozenState extends AlignmentDraft {
  /** == manifest hash (content-addressed filename) */
  alignmentId: string;
  createdAt: string;
}

/** Compute the manifest hash of a draft (content address). */
export function manifestHash(draft: AlignmentDraft): string {
  const { ...payload } = draft;
  return hashValue(payload);
}

function statePath(dir: string, alignmentId: string): string {
  return path.join(dir, `${alignmentId}.json`);
}

/**
 * Freeze a draft. Immutability rules:
 *   - new content  → write once, chmod 0444
 *   - identical content already frozen → no-op, returns the existing state
 *   - same alignmentId, different content → throws (collision/tamper)
 */
export function freeze(dir: string, draft: AlignmentDraft): FrozenState {
  const alignmentId = manifestHash(draft);
  const file = statePath(dir, alignmentId);
  const state: FrozenState = { ...draft, alignmentId, createdAt: new Date().toISOString() };

  if (fs.existsSync(file)) {
    const existing = verifyFile(file); // throws if the existing file was tampered with
    const { alignmentId: _a, createdAt: _c, ...existingPayload } = existing;
    if (canonicalJson(existingPayload) !== canonicalJson(draft)) {
      throw new Error(`hash collision at ${file}: same alignmentId, different content — refusing to freeze`);
    }
    return existing; // identical content: freeze is a no-op, createdAt preserved
  }

  fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', mode: 0o444 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o444); // belt and suspenders: rename preserves mode, but be explicit
  } catch {
    // non-fatal on filesystems that reject chmod; hash verification still guards content
  }
  return state;
}

/** Load a frozen state, verifying its hash. Throws on mismatch or missing. */
export function thaw(dir: string, alignmentId: string): FrozenState {
  const file = statePath(dir, alignmentId);
  return verifyFile(file);
}

/** List frozen alignment ids in a directory (sorted). */
export function listFrozen(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

/** Check that a file on disk still matches its own manifest hash. */
function verifyFile(file: string): FrozenState {
  const state = JSON.parse(fs.readFileSync(file, 'utf8')) as FrozenState;
  const { alignmentId, createdAt, ...payload } = state;
  const recomputed = hashValue(payload);
  if (recomputed !== alignmentId) {
    throw new Error(`frozen state ${file} failed verification: manifest says ${alignmentId}, content hashes to ${recomputed}`);
  }
  return state;
}

/** Verify without loading into caller hands — returns null if invalid. */
export function verifyFrozen(dir: string, alignmentId: string): FrozenState | null {
  try {
    return thaw(dir, alignmentId);
  } catch {
    return null;
  }
}
