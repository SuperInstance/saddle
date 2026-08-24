/**
 * grants.ts — v4 monotonic permission policy (SEAM-REPORT §1.7).
 *
 * Grants only TIGHTEN within a run. A run starts with an initial capability
 * set; each frozen-state activation intersects (shrinks) the effective set.
 * A frozen state whose declared grants are not a subset of the current
 * effective set is refused at load — before any ledger append.
 *
 * Policy direction is a type: 'tighten-only' is the only direction, and the
 * API has no widen/restore method AT ALL. Monotonicity by construction —
 * a later listener cannot undo an earlier deny because there is no verb for
 * it. This is the saddle analogue of DSH's `ctx.tools.guard()` (a monotonic
 * deny later listeners cannot undo; permission can only tighten).
 */

/** The only policy direction saddle knows. Absence of others is the point. */
export type PolicyDirection = 'tighten-only';

/** Refusal thrown when a frozen state needs a grant the run tightened away. */
export class GrantLoosenedError extends Error {
  readonly direction: PolicyDirection = 'tighten-only';
  readonly missing: string[];
  readonly held: string[];
  constructor(missing: string[], held: string[]) {
    const heldText = held.length > 0 ? `[${held.join(', ')}]` : 'the empty set';
    super(
      `tighten-only violation: frozen state requires [${missing.join(', ')}] but run grants tightened to ${heldText} — grants only tighten within a run`
    );
    this.name = 'GrantLoosenedError';
    this.missing = [...missing].sort();
    this.held = [...held].sort();
  }
}

export class GrantLedger {
  readonly direction: PolicyDirection = 'tighten-only';
  private readonly _effective: Set<string>;

  constructor(initial: Iterable<string>) {
    this._effective = new Set(initial);
  }

  /** capabilities still in effect (sorted snapshot) */
  get effective(): readonly string[] {
    return [...this._effective].sort();
  }

  /**
   * Tighten for a frozen-state activation. `declared` undefined or absent →
   * no declaration → pass through UNCHANGED (pre-v4 frozens back-compat).
   * Empty array [] → tightens to the empty set (a pure cell).
   * Throws GrantLoosenedError listing missing grants when `declared` is not
   * a subset of the current effective set. NEVER grows the set.
   */
  tightenFor(declared: readonly string[] | undefined): void {
    if (declared === undefined) return;
    const held = this._effective;
    const missing = [...new Set(declared)].filter((g) => !held.has(g));
    if (missing.length > 0) {
      throw new GrantLoosenedError(missing, [...held]);
    }
    // intersection: keep only the declared capabilities (tighten)
    const next = new Set(declared);
    this._effective.clear();
    for (const g of next) this._effective.add(g);
  }

  /** snapshot the current effective set (sorted copy) */
  snapshot(): readonly string[] {
    return [...this._effective].sort();
  }
}
