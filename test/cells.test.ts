import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { validateAgainstSchema, validateWorkflow, CellRunner, WorkflowValidationError } from '../src/cells.ts';
import type { CellSpec, SchemaSpec, Workflow } from '../src/cells.ts';
import { Ledger } from '../src/ledger.ts';

function tmpLedger(): Ledger {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saddle-cells-'));
  return new Ledger(path.join(dir, 'ledger.jsonl'));
}

const stringCell = stringCellWithId('test.cell');

function stringCellWithId(id: string): CellSpec {
  return {
    id,
    input: { fields: { text: 'string' } },
    output: { fields: { out: 'string' } },
    binding: { kind: 'fn', fn: (input: unknown) => ({ out: `echo:${(input as { text: string }).text}` }) },
  };
}

const passThrough = (id: string): CellSpec => ({
  id,
  input: { fields: { text: 'string' } },
  output: { fields: { text: 'string' } },
  binding: { kind: 'fn', fn: (input: unknown) => input },
});

const trigger: SchemaSpec = { fields: { text: 'string' } };

test('validateAgainstSchema: types, required, optional, lenient extras', () => {
  const schema: SchemaSpec = {
    fields: { name: 'string', count: 'number', tags: 'array', meta: 'object', flag: 'boolean' },
    optional: ['meta', 'flag'],
  };
  assert.deepEqual(validateAgainstSchema({ name: 'x', count: 1, tags: [] }, schema), { ok: true, errors: [] });
  assert.equal(validateAgainstSchema({ name: 'x', count: 1, tags: [], extra: 'surprise' }, schema).ok, true);

  const missing = validateAgainstSchema({ count: 1, tags: [] }, schema);
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((e) => e.includes("missing required field 'name'")));

  const wrongType = validateAgainstSchema({ name: 'x', count: 'one', tags: {} }, schema);
  assert.ok(wrongType.errors.some((e) => e.includes("field 'count' expected number")));
  assert.ok(wrongType.errors.some((e) => e.includes("field 'tags' expected array")));

  assert.equal(validateAgainstSchema(null, schema).ok, false);
  assert.equal(validateAgainstSchema([1, 2], schema).ok, false);

  const explicitRequired: SchemaSpec = { fields: { a: 'string', b: 'string' }, required: ['a'] };
  assert.equal(validateAgainstSchema({ a: 'x' }, explicitRequired).ok, true);
  assert.equal(validateAgainstSchema({ b: 'y' }, explicitRequired).ok, false);
});

test('validateWorkflow catches cycles', () => {
  const wf: Workflow = {
    id: 'cyclic',
    trigger,
    nodes: [
      { cell: passThrough('cell.a'), inputs: { text: 'cell.b.text' } },
      { cell: passThrough('cell.b'), inputs: { text: 'cell.a.text' } },
    ],
  };
  const result = validateWorkflow(wf);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /cycle detected/.test(e)));
});

test('validateWorkflow catches dangling refs', () => {
  const wf: Workflow = {
    id: 'dangling',
    trigger,
    nodes: [
      { cell: stringCellWithId('cell.a'), inputs: { text: '@trigger.text' } },
      { cell: stringCellWithId('cell.b'), inputs: { text: 'cell.ghost.text' } },
    ],
  };
  const result = validateWorkflow(wf);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("unresolvable ref 'cell.ghost.text'")));

  const badTriggerField: Workflow = {
    id: 'badtrigger',
    trigger,
    nodes: [{ cell: stringCellWithId('cell.a'), inputs: { text: '@trigger.nope' } }],
  };
  assert.ok(validateWorkflow(badTriggerField).errors.some((e) => e.includes('unknown trigger field')));

  const badOutputField: Workflow = {
    id: 'badoutput',
    trigger,
    nodes: [
      { cell: stringCellWithId('cell.a'), inputs: { text: '@trigger.text' } },
      { cell: stringCellWithId('cell.b'), inputs: { text: 'cell.a.nonexistent' } },
    ],
  };
  assert.ok(validateWorkflow(badOutputField).errors.some((e) => e.includes("unknown output field 'nonexistent'")));
});

test('validateWorkflow catches duplicate cell ids and self-refs', () => {
  const wf: Workflow = {
    id: 'dup',
    trigger,
    nodes: [
      { cell: stringCellWithId('cell.same'), inputs: { text: '@trigger.text' } },
      { cell: stringCellWithId('cell.same'), inputs: { text: '@trigger.text' } },
    ],
  };
  const result = validateWorkflow(wf);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("duplicate cell id 'cell.same'")));

  const selfRef: Workflow = {
    id: 'self',
    trigger,
    nodes: [{ cell: passThrough('cell.loop'), inputs: { text: 'cell.loop.text' } }],
  };
  assert.ok(validateWorkflow(selfRef).errors.some((e) => e.includes('references itself')));
});

test('happy 3-cell DAG: all worked, per-cell entries have correct debit/credit, chain verifies', async () => {
  const ledger = tmpLedger();
  const runner = new CellRunner({ ledger });

  const upper: CellSpec = {
    id: 'demo.upper',
    input: { fields: { raw: 'string' } },
    output: { fields: { shout: 'string' } },
    binding: { kind: 'fn', fn: (input: unknown) => ({ shout: (input as { raw: string }).raw.toUpperCase() }) },
  };
  const exclaim: CellSpec = {
    id: 'demo.exclaim',
    input: { fields: { shout: 'string' } },
    output: { fields: { line: 'string' } },
    binding: { kind: 'fn', fn: (input: unknown) => ({ line: `${(input as { shout: string }).shout}!` }) },
  };
  const count: CellSpec = {
    id: 'demo.count',
    input: { fields: { line: 'string' } },
    output: { fields: { n: 'number' } },
    binding: { kind: 'fn', fn: (input: unknown) => ({ n: (input as { line: string }).line.length }) },
  };

  const wf: Workflow = {
    id: 'shout-pipeline',
    trigger: { fields: { text: 'string' } },
    nodes: [
      { cell: upper, inputs: { raw: '@trigger.text' } },
      { cell: exclaim, inputs: { shout: 'demo.upper.shout' } },
      { cell: count, inputs: { line: 'demo.exclaim.line' } },
    ],
  };

  const result = await runner.run(wf, { text: 'giddy up' });
  assert.equal(result.status, 'worked');
  assert.deepEqual(
    result.nodes.map((n) => n.status),
    ['worked', 'worked', 'worked']
  );
  assert.deepEqual(result.nodes.map((n) => n.attempts), [1, 1, 1]);
  assert.deepEqual(result.nodes[0]?.output, { shout: 'GIDDY UP' });
  assert.deepEqual(result.nodes[2]?.output, { n: 'GIDDY UP!'.length });

  const entries = [];
  for await (const e of ledger.stream()) entries.push(e);
  assert.equal(entries.length, 4); // 3 cells + 1 run-summary entry
  const summary = entries[3];
  assert.ok(summary);
  assert.equal(summary.cellId, 'workflow.shout-pipeline');
  assert.equal(summary.verdict, 'worked');
  assert.equal(summary.escalated, false);
  assert.equal(JSON.parse(summary.credit!).status, 'worked');
  assert.equal(result.summarySeq, summary.seq);
  const [e1, e2, e3] = entries;
  assert.ok(e1 && e2 && e3);
  assert.equal(e1.cellId, 'demo.upper');
  assert.equal(e1.debit, JSON.stringify({ raw: 'giddy up' }));
  assert.equal(e1.credit, JSON.stringify({ shout: 'GIDDY UP' }));
  assert.equal(e1.alignmentId, 'unaligned'); // fn cells book under 'unaligned'
  assert.ok(e2 && e3);

  assert.equal(e2.cellId, 'demo.exclaim');
  assert.equal(e2.debit, JSON.stringify({ shout: 'GIDDY UP' }));
  assert.equal(e2.credit, JSON.stringify({ line: 'GIDDY UP!' }));

  assert.equal(e3.cellId, 'demo.count');
  assert.equal(e3.credit, JSON.stringify({ n: 'GIDDY UP!'.length }));

  assert.equal((await ledger.verify()).ok, true);
});

test('flaky cell retries then works: attempts recorded, retryOf chains', async () => {
  const ledger = tmpLedger();
  let calls = 0;
  const flaky: CellSpec = {
    id: 'demo.flaky',
    input: { fields: { text: 'string' } },
    output: { fields: { out: 'string' } },
    binding: {
      kind: 'fn',
      fn: () => {
        calls++;
        if (calls < 3) throw new Error(`flaky failure #${calls}`);
        return { out: 'finally' };
      },
    },
    retryBudget: 2,
  };
  const wf: Workflow = {
    id: 'flaky-run',
    trigger,
    nodes: [{ cell: flaky, inputs: { text: '@trigger.text' } }],
  };

  const result = await new CellRunner({ ledger }).run(wf, { text: 'x' });
  assert.equal(result.status, 'worked');
  const node = result.nodes[0];
  assert.ok(node);
  assert.equal(node.status, 'worked');
  assert.equal(node.attempts, 3);
  assert.deepEqual(node.entrySeqs, [1, 2, 3]);

  const entries = [];
  for await (const e of ledger.stream()) entries.push(e);
  assert.equal(entries.length, 4); // 3 attempts + run summary
  assert.deepEqual(entries.slice(0, 3).map((e) => e.verdict), ['failed', 'failed', 'worked']);
  assert.equal(entries[0]?.retryOf, undefined); // first attempt roots the chain
  assert.equal(entries[1]?.retryOf, 1); // retry chains to the immediately previous attempt
  assert.equal(entries[2]?.retryOf, 2); // chained, not rooted — walk back for the first
  assert.equal((await ledger.verify()).ok, true);
});

test('always-failing cell escalates after 1+budget attempts; downstream skipped, no entry', async () => {
  const ledger = tmpLedger();
  const broken: CellSpec = {
    id: 'demo.broken',
    input: { fields: { text: 'string' } },
    output: { fields: { out: 'string' } },
    binding: { kind: 'fn', fn: () => { throw new Error('dead cell'); } },
    retryBudget: 2,
  };
  const downstream: CellSpec = {
    id: 'demo.downstream',
    input: { fields: { out: 'string' } },
    output: { fields: { done: 'boolean' } },
    binding: { kind: 'fn', fn: () => ({ done: true }) },
  };
  const independent: CellSpec = {
    id: 'demo.independent',
    input: { fields: { text: 'string' } },
    output: { fields: { ok: 'boolean' } },
    binding: { kind: 'fn', fn: () => ({ ok: true }) },
  };

  const wf: Workflow = {
    id: 'doomed',
    trigger,
    nodes: [
      { cell: broken, inputs: { text: '@trigger.text' } },
      { cell: downstream, inputs: { out: 'demo.broken.out' } },
      { cell: independent, inputs: { text: '@trigger.text' } }, // NOT downstream — new v2 semantics: it still runs
    ],
  };

  const result = await new CellRunner({ ledger }).run(wf, { text: 'x' });
  assert.equal(result.status, 'escalated');

  const brokenNode = result.nodes.find((n) => n.cellId === 'demo.broken');
  assert.equal(brokenNode?.status, 'escalated');
  assert.equal(brokenNode?.attempts, 3); // 1 + budget 2

  // downstream of the escalation: skipped, no books
  const downNode = result.nodes.find((n) => n.cellId === 'demo.downstream');
  assert.equal(downNode?.status, 'skipped');
  assert.equal(downNode?.attempts, 0);
  assert.deepEqual(downNode?.entrySeqs, []); // skipped nodes keep NO books

  // independent branch: unaffected — partial results are worth keeping
  const indepNode = result.nodes.find((n) => n.cellId === 'demo.independent');
  assert.equal(indepNode?.status, 'worked');
  assert.equal(indepNode?.attempts, 1);

  // 3 failed attempts + 1 escalation + 1 worked (independent) + 1 run summary
  const entries = [];
  for await (const e of ledger.stream()) entries.push(e);
  assert.equal(entries.length, 6);
  const escalation = entries.find((e) => e.escalated);
  assert.ok(escalation);
  assert.equal(escalation.cellId, 'demo.broken');
  assert.match(escalation.note ?? '', /cowboy-needed: .*dead cell/);
  assert.equal(escalation.retryOf, 3); // escalation chains to the LAST attempt
  assert.equal(escalation.alignmentId, 'unaligned');
  const summary = entries[5];
  assert.ok(summary);
  assert.equal(summary.cellId, 'workflow.doomed');
  assert.equal(summary.verdict, 'failed');
  assert.equal(JSON.parse(summary.credit!).nodes['demo.independent'], 'worked');
  assert.equal(JSON.parse(summary.credit!).nodes['demo.downstream'], 'skipped');
  assert.equal((await ledger.verify()).ok, true);
});

test('deterministic input-schema violation escalates immediately WITHOUT burning retry budget', async () => {
  const ledger = tmpLedger();
  let fnCalls = 0;
  const strict: CellSpec = {
    id: 'demo.strict',
    input: { fields: { n: 'number' } },
    output: { fields: { out: 'number' } },
    binding: { kind: 'fn', fn: (input: unknown) => { fnCalls++; return { out: (input as { n: number }).n * 2 }; } },
    retryBudget: 1,
  };
  const downstream: CellSpec = {
    id: 'demo.strict.down',
    input: { fields: { out: 'number' } },
    output: { fields: { done: 'boolean' } },
    binding: { kind: 'fn', fn: () => ({ done: true }) },
  };
  const wf: Workflow = {
    id: 'bad-input',
    trigger: { fields: { n: 'any' } },
    nodes: [
      { cell: strict, inputs: { n: '@trigger.n' } },
      { cell: downstream, inputs: { out: 'demo.strict.out' } },
    ],
  };

  const result = await new CellRunner({ ledger }).run(wf, { n: 'not-a-number' });
  assert.equal(result.status, 'escalated');
  const node = result.nodes[0];
  assert.ok(node);
  assert.equal(node.status, 'escalated');
  assert.equal(node.attempts, 1); // deterministic failure — ONE entry, no retries
  assert.match(node.error ?? '', /input validation failed/);
  assert.equal(fnCalls, 0); // the binding never even ran
  assert.equal(result.nodes[1]?.status, 'skipped'); // downstream skipped

  const entries = [];
  for await (const e of ledger.stream()) entries.push(e);
  assert.equal(entries.length, 2); // 1 violation entry + 1 run summary
  const violation = entries[0];
  assert.ok(violation);
  assert.equal(violation.escalated, true);
  assert.equal(violation.verdict, 'failed');
  assert.equal(violation.retryOf, undefined);
  assert.match(violation.note ?? '', /deterministic — not retried/);
  assert.equal((await ledger.verify()).ok, true);
});

test('model bindings use the injected invoker and book under their alignmentId', async () => {
  const ledger = tmpLedger();
  const seen: Array<{ model: string; alignmentId: string; input: unknown }> = [];
  const modelCell: CellSpec = {
    id: 'demo.model',
    input: { fields: { q: 'string' } },
    output: { fields: { a: 'string' } },
    binding: { kind: 'model', model: 'tiny-llm', alignmentId: 'frozen-1234' },
  };
  const wf: Workflow = {
    id: 'model-run',
    trigger: { fields: { q: 'string' } },
    nodes: [{ cell: modelCell, inputs: { q: '@trigger.q' } }],
  };

  const result = await new CellRunner({
    ledger,
    modelInvoker: {
      invoke: (model, alignmentId, input) => {
        seen.push({ model, alignmentId, input });
        return { a: 'model says hi' };
      },
    },
  }).run(wf, { q: 'hello?' });

  assert.equal(result.status, 'worked');
  assert.deepEqual(seen, [{ model: 'tiny-llm', alignmentId: 'frozen-1234', input: { q: 'hello?' } }]);
  const entries = [];
  for await (const e of ledger.stream()) entries.push(e);
  assert.equal(entries[0]?.alignmentId, 'frozen-1234');
  assert.equal((await ledger.verify()).ok, true);
});

test('run() throws on an invalid workflow instead of executing it', async () => {
  const ledger = tmpLedger();
  const wf: Workflow = {
    id: 'invalid',
    trigger,
    nodes: [
      { cell: stringCell, inputs: { text: '@trigger.text' } },
      { cell: stringCellWithId('cell.b'), inputs: { text: 'cell.ghost.text' } },
    ],
  };
  await assert.rejects(
    new CellRunner({ ledger }).run(wf, { text: 'x' }),
    (err: unknown) => {
      assert.ok(err instanceof WorkflowValidationError); // typed, not a plain Error
      assert.match((err as Error).message, /invalid workflow 'invalid'/);
      assert.match((err as Error).message, /unresolvable ref/);
      assert.ok((err as WorkflowValidationError).errors.length > 0);
      return true;
    }
  );
  assert.equal(await ledger.count(), 0); // nothing ran, nothing booked
});

test('diamond DAG: escalation in one branch skips only ITS transitive dependents', async () => {
  const ledger = tmpLedger();
  //        a
  //       / \
  //      b✗   c✓
  //       \  /
  //        d   (depends on BOTH b and c → skipped)
  const a: CellSpec = {
    id: 'dia.a',
    input: { fields: { text: 'string' } },
    output: { fields: { mid: 'string' } },
    binding: { kind: 'fn', fn: (i: unknown) => ({ mid: (i as { text: string }).text }) },
  };
  const b: CellSpec = {
    id: 'dia.b',
    input: { fields: { mid: 'string' } },
    output: { fields: { left: 'string' } },
    binding: { kind: 'fn', fn: () => { throw new Error('left branch dies'); } },
    retryBudget: 0, // die fast — 1 attempt
  };
  const c: CellSpec = {
    id: 'dia.c',
    input: { fields: { mid: 'string' } },
    output: { fields: { right: 'string' } },
    binding: { kind: 'fn', fn: (i: unknown) => ({ right: `${(i as { mid: string }).mid}-ok` }) },
  };
  const d: CellSpec = {
    id: 'dia.d',
    input: { fields: { left: 'string', right: 'string' } },
    output: { fields: { merged: 'string' } },
    binding: { kind: 'fn', fn: (i: unknown) => ({ merged: `${(i as object).toString()}` }) },
  };
  const wf: Workflow = {
    id: 'diamond',
    trigger: { fields: { text: 'string' } },
    nodes: [
      { cell: a, inputs: { text: '@trigger.text' } },
      { cell: b, inputs: { mid: 'dia.a.mid' } },
      { cell: c, inputs: { mid: 'dia.a.mid' } },
      { cell: d, inputs: { left: 'dia.b.left', right: 'dia.c.right' } },
    ],
  };

  const result = await new CellRunner({ ledger }).run(wf, { text: 'go' });
  assert.equal(result.status, 'escalated');
  const by = (id: string) => result.nodes.find((n) => n.cellId === id)!.status;
  assert.equal(by('dia.a'), 'worked'); // upstream unaffected
  assert.equal(by('dia.b'), 'escalated'); // the failure
  assert.equal(by('dia.c'), 'worked'); // sibling branch SURVIVES
  assert.equal(by('dia.d'), 'skipped'); // transitive dependent of b — skipped

  const entries = [];
  for await (const e of ledger.stream()) entries.push(e);
  // a(1) + b attempt(1) + b escalation(1) + c(1) + summary(1) = 5; d never booked
  assert.equal(entries.length, 5);
  assert.equal(entries.filter((e) => e.cellId === 'dia.d').length, 0);
  const summary = entries[4];
  assert.ok(summary);
  assert.deepEqual(JSON.parse(summary.credit!).nodes, {
    'dia.a': 'worked', 'dia.b': 'escalated', 'dia.c': 'worked', 'dia.d': 'skipped',
  });
  assert.equal((await ledger.verify()).ok, true);
});
