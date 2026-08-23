/**
 * cells.ts — cell decomposition: small schemas, workflows, and the runner.
 *
 * A cell is one dog with one job: it takes an input, does something, returns
 * an output, and keeps books (one ledger entry per attempt). A workflow wires
 * cells into a DAG by mapping each cell's input fields to the trigger or to
 * another cell's output fields.
 *
 * Deliberately tiny schemas — NOT JSON Schema. `SchemaSpec` names each field's
 * type from a closed set; that's the whole language. If you need more, the
 * schema is the wrong place for it.
 *
 * Model bindings never call a real model: the runner is handed a
 * `ModelInvoker` (injected). Core stays a harness, not a model client.
 *
 * v2 semantics (documented simplifications):
 *   - an escalation skips only the nodes transitively DOWNSTREAM of the
 *     failed node; independent branches still run (partial results are
 *     worth keeping — a diamond keeps its healthy side)
 *   - skipped nodes get NO ledger entry — they never ran — but the run ends
 *     with ONE summary entry (cellId `workflow.<id>`) recording every node's
 *     final status, so a post-mortem can always reconstruct what happened
 *   - every attempt (success, failure, invalid output) is a ledger entry;
     *     retries chain via retryOf → the IMMEDIATELY PREVIOUS attempt's seq
 *     (walk retryOf links backward to find the first attempt)
 *   - an INVALID INPUT is deterministic — identical retry, identical failure —
 *     so it escalates immediately without burning retry budget
 *
 * Memory: the runner retains each node's output until the run ends — that is
 * O(nodes × payload) per RUN, not O(corpus). Cells with huge payloads should
 * externalize blobs and pass references; the ledger is for books, not cargo.
 *
 * Critical-path rules honored here:
 *   - no subprocess use, no deps, no model calls in core
 */

import { randomUUID } from 'node:crypto';
import { Ledger } from './ledger.ts';
import type { LedgerEntry } from './ledger.ts';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any';

/**
 * Deliberately tiny: field name → type, plus required/optional lists.
 *   - `required` given → exactly those fields are required.
 *   - `required` omitted → every declared field not listed in `optional` is required.
 *   - unknown fields on a value PASS (lenient, forward-compatible).
 */
export interface SchemaSpec {
  fields: Record<string, FieldType>;
  required?: string[];
  optional?: string[];
}

export interface SchemaCheck {
  ok: boolean;
  errors: string[];
}

const FIELD_TYPES: ReadonlySet<string> = new Set(['string', 'number', 'boolean', 'object', 'array', 'any']);

function typeMatches(value: unknown, type: FieldType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'any':
      return true;
  }
}

/** Names of the fields `schema` requires (see SchemaSpec for the rules). */
export function requiredFields(schema: SchemaSpec): string[] {
  if (schema.required !== undefined) return schema.required;
  const optional = new Set(schema.optional ?? []);
  return Object.keys(schema.fields).filter((f) => !optional.has(f));
}

/** Validate a plain object against a SchemaSpec. */
/** See {@link SchemaSpec}. Caveat: 'object'/'array' field types are SHAPE-BLIND —
 * they check the container kind, never the contents. Structurally mismatched
 * payloads between wired cells are caught downstream as output-validation
 * failures, not at wiring time. Deliberate: tiny schemas, honest limits. */
export function validateAgainstSchema(value: unknown, schema: SchemaSpec): SchemaCheck {
  const errors: string[] = [];

  for (const [field, type] of Object.entries(schema.fields)) {
    if (!FIELD_TYPES.has(type)) errors.push(`field '${field}' declares unknown type '${type}'`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: [...errors, 'value must be a plain object'] };
  }

  const obj = value as Record<string, unknown>;
  for (const field of requiredFields(schema)) {
    if (!(field in obj)) errors.push(`missing required field '${field}'`);
  }
  for (const [field, type] of Object.entries(schema.fields)) {
    if (field in obj && !typeMatches(obj[field], type)) {
      errors.push(`field '${field}' expected ${type}, got ${describeType(obj[field])}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

// ---------------------------------------------------------------------------
// Cells and workflows
// ---------------------------------------------------------------------------

export type CellBinding =
  | { kind: 'model'; model: string; alignmentId: string }
  | { kind: 'fn'; fn: (input: unknown) => Promise<unknown> | unknown };

export interface CellSpec {
  /** dot-namespaced by convention, e.g. 'fleet.parse.intent' (convention only) */
  id: string;
  input: SchemaSpec;
  output: SchemaSpec;
  binding: CellBinding;
  /** retries after the first attempt (default 2 → 1+2 total attempts) */
  retryBudget?: number;
  note?: string;
}

/**
 * Maps each input field of the cell to `'@trigger.<field>'` or
 * `'<otherCellId>.<field>'` (a field of that cell's output object).
 * Edges are implied by these references.
 */
export interface WorkflowNode {
  cell: CellSpec;
  inputs: Record<string, string>;
}

export interface Workflow {
  id: string;
  trigger: SchemaSpec;
  nodes: WorkflowNode[];
}

export type InputRef =
  | { kind: 'trigger'; field: string }
  | { kind: 'cell'; cellId: string; field: string };

/**
 * Resolve an input reference against the known cell ids. Cell ids are
 * dot-namespaced, so a ref like 'fleet.parse.intent.raw' is ambiguous until
 * matched against known ids — we take the LONGEST matching id prefix.
 */
function resolveRef(ref: string, knownIds: string[]): InputRef | null {
  if (ref.startsWith('@trigger.')) return { kind: 'trigger', field: ref.slice('@trigger.'.length) };
  for (const id of [...knownIds].sort((a, b) => b.length - a.length)) {
    if (ref.startsWith(id + '.')) return { kind: 'cell', cellId: id, field: ref.slice(id.length + 1) };
  }
  return null;
}

/** Static check: unique ids, resolvable refs, existing fields, no cycles. */
export function validateWorkflow(wf: Workflow): SchemaCheck {
  const errors: string[] = [];

  const byId = new Map<string, WorkflowNode>();
  for (const node of wf.nodes) {
    if (!node.cell.id) errors.push(`a node has an empty cell id`);
    else if (byId.has(node.cell.id)) errors.push(`duplicate cell id '${node.cell.id}'`);
    else byId.set(node.cell.id, node);
  }
  const ids = [...byId.keys()];

  for (const node of wf.nodes) {
    const cellId = node.cell.id || '(unnamed)';
    for (const [field, ref] of Object.entries(node.inputs)) {
      if (!(field in node.cell.input.fields)) {
        errors.push(`cell '${cellId}' maps unknown input field '${field}'`);
        continue;
      }
      const resolved = resolveRef(ref, ids);
      if (!resolved) {
        errors.push(`cell '${cellId}' input '${field}' has unresolvable ref '${ref}' (expected '@trigger.<field>' or '<cellId>.<field>')`);
        continue;
      }
      if (resolved.kind === 'trigger') {
        if (!(resolved.field in wf.trigger.fields)) {
          errors.push(`cell '${cellId}' input '${field}' references unknown trigger field '${resolved.field}'`);
        }
      } else {
        if (resolved.cellId === cellId) {
          errors.push(`cell '${cellId}' input '${field}' references itself (${ref})`);
        } else if (!(resolved.field in byId.get(resolved.cellId)!.cell.output.fields)) {
          errors.push(`cell '${cellId}' input '${field}' references unknown output field '${resolved.field}' of cell '${resolved.cellId}'`);
        }
      }
    }
    for (const field of requiredFields(node.cell.input)) {
      if (!(field in node.inputs)) {
        errors.push(`cell '${cellId}' has no input mapping for required field '${field}'`);
      }
    }
  }

  // cycle detection (DFS, three colors) over dependency edges
  const deps = new Map<string, string[]>();
  for (const node of wf.nodes) {
    const upstream = new Set<string>();
    for (const ref of Object.values(node.inputs)) {
      const resolved = resolveRef(ref, ids);
      if (resolved?.kind === 'cell' && resolved.cellId !== node.cell.id) upstream.add(resolved.cellId);
    }
    deps.set(node.cell.id, [...upstream]);
  }
  const color = new Map<string, 0 | 1 | 2>(); // 0 unvisited, 1 in-stack, 2 done
  const stack: string[] = [];
  const visit = (id: string): void => {
    color.set(id, 1);
    stack.push(id);
    for (const dep of deps.get(id) ?? []) {
      const c = color.get(dep) ?? 0;
      if (c === 1) {
        const cycle = stack.slice(stack.indexOf(dep)).concat(id);
        errors.push(`cycle detected: ${cycle.join(' → ')}`);
      } else if (c === 0) {
        visit(dep);
      }
    }
    stack.pop();
    color.set(id, 2);
  };
  for (const id of ids) {
    if ((color.get(id) ?? 0) === 0) visit(id);
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/** Core never calls a real model — it calls whatever invoker you inject. */
export interface ModelInvoker {
  invoke(model: string, alignmentId: string, input: unknown): Promise<unknown> | unknown;
}

export interface CellRunnerOptions {
  ledger: Ledger;
  runIdPrefix?: string;
  modelInvoker?: ModelInvoker;
}

export interface NodeRunResult {
  cellId: string;
  status: 'worked' | 'failed' | 'escalated' | 'skipped';
  attempts: number;
  output?: unknown;
  error?: string;
  entrySeqs: number[];
}

export interface WorkflowRunResult {
  workflowId: string;
  runId: string;
  status: 'worked' | 'escalated';
  startedAt: string;
  finishedAt: string;
  nodes: NodeRunResult[];
  /** ledger seq of the run-summary entry (cellId `workflow.<id>`) */
  summarySeq: number;
  error?: string;
}

/** Direct dependents: cellId → cells whose inputs reference it. Shared by topo order + downstream skip. */
function dependentsMap(wf: Workflow): Map<string, string[]> {
  const ids = wf.nodes.map((n) => n.cell.id);
  const dependents = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const node of wf.nodes) {
    for (const ref of Object.values(node.inputs)) {
      const resolved = resolveRef(ref, ids);
      if (resolved?.kind === 'cell' && resolved.cellId !== node.cell.id) {
        dependents.get(resolved.cellId)!.push(node.cell.id);
      }
    }
  }
  return dependents;
}

/** Topological order (Kahn). Inputs must already be validated (acyclic). */
function topoOrder(wf: Workflow): string[] {
  const ids = wf.nodes.map((n) => n.cell.id);
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  const dependents = dependentsMap(wf);
  for (const node of wf.nodes) {
    for (const ref of Object.values(node.inputs)) {
      const resolved = resolveRef(ref, ids);
      if (resolved?.kind === 'cell' && resolved.cellId !== node.cell.id) {
        indegree.set(node.cell.id, (indegree.get(node.cell.id) ?? 0) + 1);
      }
    }
  }
  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of dependents.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  return order;
}

/**
 * Runs a workflow: topological execution, one ledger entry per attempt,
 * retries chained by retryOf, escalation on budget exhaustion.
 *
 * Alignment bookkeeping: model cells ledger under their binding's alignmentId;
 * fn cells have no alignment in play and book under 'unaligned'.
 */
/** Thrown by `CellRunner.run` when `validateWorkflow` fails — typed, unlike a
 * plain Error, so callers can distinguish harness misuse from execution failure. */
export class WorkflowValidationError extends Error {
  readonly errors: string[];
  constructor(workflowId: string, errors: string[]) {
    super(`invalid workflow '${workflowId}': ${errors.join('; ')}`);
    this.name = 'WorkflowValidationError';
    this.errors = errors;
  }
}

export class CellRunner {
  readonly ledger: Ledger;
  readonly runIdPrefix: string;
  readonly modelInvoker?: ModelInvoker;

  constructor(opts: CellRunnerOptions) {
    this.ledger = opts.ledger;
    this.runIdPrefix = opts.runIdPrefix ?? 'run';
    this.modelInvoker = opts.modelInvoker;
  }

  async run(workflow: Workflow, trigger: unknown): Promise<WorkflowRunResult> {
    const check = validateWorkflow(workflow);
    if (!check.ok) {
      throw new WorkflowValidationError(workflow.id, check.errors);
    }

    const runId = `${this.runIdPrefix}-${randomUUID().slice(0, 8)}`;
    const startedAt = new Date().toISOString();
    const nodeById = new Map(workflow.nodes.map((n) => [n.cell.id, n]));
    const outputs = new Map<string, unknown>();
    const results = new Map<string, NodeRunResult>();
    // report in declaration order, regardless of execution order
    for (const node of workflow.nodes) {
      results.set(node.cell.id, { cellId: node.cell.id, status: 'skipped', attempts: 0, entrySeqs: [] });
    }

    // who depends (transitively) on whom — for downstream-only skipping
    const dependents = dependentsMap(workflow);
    const skip = new Set<string>(); // transitively downstream of an escalated node

    for (const id of topoOrder(workflow)) {
      if (skip.has(id)) continue; // downstream of an earlier escalation
      const node = nodeById.get(id)!;
      const cell = node.cell;
      const result = results.get(id)!;

      const input = this.assembleInput(node, workflow, trigger, outputs);
      const budget = cell.retryBudget ?? 2;
      const alignmentId = cell.binding.kind === 'model' ? cell.binding.alignmentId : 'unaligned';
      const seqs: number[] = [];
      let prevSeq: number | undefined; // retryOf chains to the immediately previous attempt
      let lastReason = 'unknown failure';

      // An invalid input is deterministic: identical retry, identical failure.
      // Escalate immediately — burning budget on it would be bookkeeping theater.
      const inputCheck = validateAgainstSchema(input, cell.input);
      if (!inputCheck.ok) {
        const reason = `input validation failed: ${inputCheck.errors.join('; ')}`;
        const entry = this.ledger.append({
          cellId: cell.id, runId, alignmentId,
          debit: input, credit: reason,
          verdict: 'failed', escalated: true,
          note: `cowboy-needed: input schema violation (deterministic — not retried): ${reason}`,
        });
        seqs.push(entry.seq);
        result.status = 'escalated';
        result.attempts = 1;
        result.error = reason;
        result.entrySeqs = seqs;
        this.skipDownstream(id, dependents, skip);
        continue;
      }

      for (let attempt = 0; attempt <= budget; attempt++) {
        const outcome = await this.attempt(cell, input, alignmentId, runId, prevSeq);
        seqs.push(outcome.entry.seq);
        if (outcome.ok) {
          outputs.set(id, outcome.output);
          result.status = 'worked';
          result.attempts = attempt + 1;
          result.output = outcome.output;
          result.error = undefined;
          result.entrySeqs = seqs;
          break;
        }
        prevSeq = outcome.entry.seq;
        lastReason = outcome.reason;
        result.status = 'failed';
        result.attempts = attempt + 1;
        result.error = outcome.reason;
        result.entrySeqs = seqs;
      }

      if (result.status !== 'worked') {
        // exhausted: one final entry raises the flag for the cowboy
        const escalation = this.ledger.append({
          cellId: cell.id,
          runId,
          alignmentId,
          debit: input,
          credit: lastReason,
          verdict: 'failed',
          escalated: true,
          note: `cowboy-needed: ${lastReason}`,
          ...(prevSeq !== undefined ? { retryOf: prevSeq } : {}),
        });
        seqs.push(escalation.seq);
        result.status = 'escalated';
        result.entrySeqs = seqs;
        this.skipDownstream(id, dependents, skip);
      }
    }

    const anyEscalated = [...results.values()].some((r) => r.status === 'escalated');
    const finishedAt = new Date().toISOString();

    // Run summary: ONE entry per run so a post-mortem can reconstruct the
    // whole DAG outcome (and nightcycle gets run-level data) without replaying
    // per-attempt entries. Not an escalation alarm — no escalated flag here.
    const summary = this.ledger.append({
      cellId: `workflow.${workflow.id}`,
      runId,
      alignmentId: 'unaligned',
      debit: trigger,
      credit: { status: anyEscalated ? 'escalated' : 'worked', nodes: Object.fromEntries([...results.values()].map((r) => [r.cellId, r.status])) },
      verdict: anyEscalated ? 'failed' : 'worked',
      escalated: false,
      note: `run summary: ${[...results.values()].filter((r) => r.status === 'skipped').length} skipped`,
    });

    return {
      workflowId: workflow.id,
      runId,
      status: anyEscalated ? 'escalated' : 'worked',
      startedAt,
      finishedAt,
      nodes: workflow.nodes.map((n) => results.get(n.cell.id)!),
      summarySeq: summary.seq,
    };
  }

  /** Mark the transitive dependents of `id` (and theirs, recursively) skipped. */
  private skipDownstream(id: string, dependents: Map<string, string[]>, skip: Set<string>): void {
    const stack = [...(dependents.get(id) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (skip.has(next)) continue;
      skip.add(next);
      stack.push(...(dependents.get(next) ?? []));
    }
  }

  private assembleInput(
    node: WorkflowNode,
    wf: Workflow,
    trigger: unknown,
    outputs: Map<string, unknown>
  ): Record<string, unknown> {
    const ids = wf.nodes.map((n) => n.cell.id);
    const input: Record<string, unknown> = {};
    const trig = (trigger ?? {}) as Record<string, unknown>;
    for (const [field, ref] of Object.entries(node.inputs)) {
      const resolved = resolveRef(ref, ids)!; // validateWorkflow guaranteed this
      if (resolved.kind === 'trigger') {
        input[field] = trig[resolved.field];
      } else {
        const upstream = (outputs.get(resolved.cellId) ?? {}) as Record<string, unknown>;
        input[field] = upstream[resolved.field];
      }
    }
    return input;
  }

  private async attempt(
    cell: CellSpec,
    input: Record<string, unknown>,
    alignmentId: string,
    runId: string,
    prevSeq?: number
  ): Promise<{ ok: true; output: unknown; entry: LedgerEntry } | { ok: false; reason: string; entry: LedgerEntry }> {
    // retryOf chains to the immediately previous attempt (undefined on the first)
    const retryOf = prevSeq;

    // NOTE: input schema is validated once in run() before any attempt —
    // an invalid input is deterministic and escalates without retries.

    let output: unknown;
    try {
      if (cell.binding.kind === 'fn') {
        output = await cell.binding.fn(input);
      } else if (this.modelInvoker) {
        output = await this.modelInvoker.invoke(cell.binding.model, cell.binding.alignmentId, input);
      } else {
        return {
          ok: false,
          reason: 'no model invoker configured',
          entry: this.ledger.append({
            cellId: cell.id, runId, alignmentId,
            debit: input, credit: 'no model invoker configured',
            verdict: 'failed', escalated: false, note: 'model binding has no invoker',
            ...(retryOf !== undefined ? { retryOf } : {}),
          }),
        };
      }
    } catch (e) {
      const reason = `binding threw: ${(e as Error).message}`;
      return {
        ok: false,
        reason,
        entry: this.ledger.append({
          cellId: cell.id, runId, alignmentId,
          debit: input, credit: reason,
          verdict: 'failed', escalated: false, note: 'binding threw',
          ...(retryOf !== undefined ? { retryOf } : {}),
        }),
      };
    }

    const outputCheck = validateAgainstSchema(output, cell.output);
    if (!outputCheck.ok) {
      const reason = `output validation failed: ${outputCheck.errors.join('; ')}`;
      return {
        ok: false,
        reason,
        entry: this.ledger.append({
          cellId: cell.id, runId, alignmentId,
          debit: input, credit: output, // the invalid output IS the credit — the cowboy should see it
          verdict: 'failed', escalated: false, note: reason,
          ...(retryOf !== undefined ? { retryOf } : {}),
        }),
      };
    }

    return {
      ok: true,
      output,
      entry: this.ledger.append({
        cellId: cell.id, runId, alignmentId,
        debit: input, credit: output,
        verdict: 'worked', escalated: false,
        ...(retryOf !== undefined ? { retryOf } : {}),
      }),
    };
  }
}
