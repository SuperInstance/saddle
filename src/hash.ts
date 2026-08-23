/**
 * hash.ts — FNV-1a 64-bit over canonical JSON. Zero dependencies.
 *
 * The only hashing primitive in saddle. Used to chain ledger entries and to
 * content-address frozen states. Not cryptographic — tamper-evident, not
 * tamper-proof. That's the right tool for a ledger a cowboy owns.
 */

/** Sort keys recursively so equivalent objects hash identically. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return (
    '{' +
    keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') +
    '}'
  );
}

/** FNV-1a 64-bit, hex-encoded (16 chars). Deterministic across runs. */
export function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i) & 0xff);
    // multiply by FNV prime (0x100000001b3) mod 2^64
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

/** Hash any JSON-serializable value canonically. */
export function hashValue(value: unknown): string {
  return fnv1a64(canonicalJson(value));
}
