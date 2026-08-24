/**
 * saddle — the cowboy's gear. Harness toolkit for the fleet.
 *
 * Small honest core: ledger (double-entry bookkeeping per cell),
 * frozens (immutable alignment bundles), pincher transport (RPC client +
 * reflex spool), cells (decomposition + workflow runner), nightcycle (the
 * report runner). The doctrine lives in the docs.
 */

export { Ledger, entryHash, resolveVerdictKind } from './ledger.ts';
export { WorkflowValidationError } from './cells.ts';
export type { LedgerEntry, NewEntry, OutcomeFact, Verdict, VerdictKind, VerifyResult } from './ledger.ts';

export { freeze, thaw, listFrozen, verifyFrozen, manifestHash } from './frozens.ts';
export type { AlignmentDraft, FrozenState, FilterSpec, FilterKind } from './frozens.ts';

export { PincherRpcClient, PincherRpcError, ReflexSpoolIngest, VerdictReturn } from './pincher.ts';
export { PINCHER_ERR_TIMEOUT, PINCHER_ERR_TRANSPORT, PINCHER_ERR_BAD_RESPONSE } from './pincher.ts';
export type {
  PincherEvent,
  AlignmentResolver,
  PincherRpcClientOptions,
  PingResult,
  EmbedTextResult,
  MatchReflexResult,
  TeachReflexResult,
  GetStatusResult,
  EngineStatus,
  ReflexSpoolIngestOptions,
  IngestResult,
  VerdictMessage,
} from './pincher.ts';

export { validateAgainstSchema, validateWorkflow, requiredFields, CellRunner } from './cells.ts';
export type {
  FieldType,
  SchemaSpec,
  SchemaCheck,
  CellBinding,
  CellSpec,
  WorkflowNode,
  Workflow,
  ModelInvoker,
  CellRunnerOptions,
  NodeRunResult,
  WorkflowRunResult,
} from './cells.ts';

export { runNightCycle, renderReport, suggestForAlignment, EARNED_KEEP_THRESHOLD } from './nightcycle.ts';
export type { NightCycleReport, AlignmentStat, AlignmentSuggestion, AlignmentTokens, CellStat } from './nightcycle.ts';

// quorum — N frozen judge alignments, one strict-majority verdict, one summary
// entry in the books (field-trial-1 gap 4: single judge, single opinion).
export { runQuorumCell } from './quorum.ts';
export type {
  QuorumJudgeSpec,
  QuorumJudgeOutcome,
  QuorumMajority,
  QuorumVotes,
  QuorumDissent,
  QuorumResult,
  RunQuorumCellOptions,
} from './quorum.ts';

export { canonicalJson, fnv1a64, hashValue } from './hash.ts';

// cellrunner — run ONE pinned cell (frozen alignment) against an injected
// adapter. Companion to CellRunner (workflows of many cells): different seam
// on purpose — CellAdapter returns RAW transport output + parseCredit decides
// the verdict, because a pinned cell's books must show the raw credit.
export { runCell, estimateUsage } from './cellrunner.ts';
export type { CellAdapter, CellRequest, RunCellOptions, RunCellResult, Usage } from './cellrunner.ts';
