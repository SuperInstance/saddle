/**
 * saddle — the cowboy's gear. Harness toolkit for the fleet.
 *
 * Small honest core: ledger (double-entry bookkeeping per cell),
 * frozens (immutable alignment bundles), nightcycle (the report runner).
 * The doctrine lives in the docs.
 */

export { Ledger, entryHash } from './ledger.ts';
export type { LedgerEntry, NewEntry, Verdict, VerifyResult } from './ledger.ts';

export { freeze, thaw, listFrozen, verifyFrozen, manifestHash } from './frozens.ts';
export type { AlignmentDraft, FrozenState, FilterSpec, FilterKind } from './frozens.ts';

export { runCell } from './cellrunner.ts';
export type { CellAdapter, CellCallInput, CellCallOutput, RunCellOptions, RunCellResult } from './cellrunner.ts';

export { runNightCycle, renderReport, EARNED_KEEP_THRESHOLD } from './nightcycle.ts';
export type { NightCycleReport, AlignmentStat, CellStat } from './nightcycle.ts';

export { canonicalJson, fnv1a64, hashValue } from './hash.ts';
