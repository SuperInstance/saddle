/**
 * examples/parse-decide-act.ts — a 3-cell workflow, run end to end.
 *
 *   parse  (fn)    raw text → clean intent
 *   decide (model) intent → action   — the mock invoker is FLAKY: it fails
 *                                       the first 2 calls of a run, then
 *                                       succeeds, so you can watch the retry
 *                                       chain form in the ledger
 *   act    (fn)    action → done
 *
 * Runnable: node examples/parse-decide-act.ts
 * Uses a tmp ledger; prints the run result and the books it kept.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CellRunner } from '../src/cells.ts';
import type { Workflow } from '../src/cells.ts';
import { Ledger } from '../src/ledger.ts';

const parse = {
  id: 'fleet.parse.intent',
  input: { fields: { raw: 'string' as const } },
  output: { fields: { intent: 'string' as const } },
  binding: {
    kind: 'fn' as const,
    fn: (input: unknown) => {
      const { raw } = input as { raw: string };
      return { intent: raw.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60) };
    },
  },
  note: 'normalize raw user text into a clean intent string',
};

const decide = {
  id: 'fleet.decide.action',
  input: { fields: { intent: 'string' as const } },
  output: { fields: { action: 'string' as const } },
  binding: {
    kind: 'model' as const,
    model: 'mock-flaky-decider',
    alignmentId: 'frozen-demo-v2',
  },
  retryBudget: 2,
  note: 'model cell — core never calls a model, only the injected invoker',
};

const act = {
  id: 'fleet.act.execute',
  input: { fields: { action: 'string' as const } },
  output: { fields: { done: 'boolean' as const } },
  binding: {
    kind: 'fn' as const,
    fn: (input: unknown) => {
      const { action } = input as { action: string };
      if (!action) throw new Error('refused to act on an empty action');
      return { done: true };
    },
  },
};

/** Mock model invoker — FLAKY on purpose: fails the first 2 calls, then works. */
function flakyInvoker() {
  let calls = 0;
  return {
    invoke(_model: string, _alignmentId: string, input: unknown): Promise<unknown> {
      calls++;
      const { intent } = input as { intent: string };
      if (calls <= 2) {
        return Promise.reject(new Error(`invoker hiccup on call #${calls}`));
      }
      return Promise.resolve({ action: `execute: ${intent}` });
    },
  };
}

const workflow: Workflow = {
  id: 'parse-decide-act',
  trigger: { fields: { text: 'string' } },
  nodes: [
    { cell: parse, inputs: { raw: '@trigger.text' } },
    { cell: decide, inputs: { intent: 'fleet.parse.intent.intent' } },
    { cell: act, inputs: { action: 'fleet.decide.action.action' } },
  ],
};

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saddle-example-'));
  const ledger = new Ledger(path.join(dir, 'ledger.jsonl'));
  const runner = new CellRunner({ ledger, runIdPrefix: 'demo', modelInvoker: flakyInvoker() });

  const result = await runner.run(workflow, { text: '  TELL   WESLEY A BEDTIME STORY ' });

  console.log('=== workflow run ===');
  console.log(JSON.stringify(result, null, 2));

  console.log('\n=== the books (ledger) ===');
  for await (const entry of ledger.stream()) {
    const retry = entry.retryOf !== undefined ? ` retryOf=${entry.retryOf}` : '';
    const note = entry.note ? ` — ${entry.note}` : '';
    console.log(
      `seq ${entry.seq} ${entry.cellId} [${entry.verdict}${entry.escalated ? '/escalated' : ''}]${retry}${note}`
    );
    console.log(`  debit  ${entry.debit}`);
    console.log(`  credit ${entry.credit}`);
  }

  const verify = await ledger.verify();
  console.log(`\nledger verify: ${verify.ok ? 'ok' : 'BROKEN'} (${verify.checked} entries)`);
  console.log(`ledger file: ${ledger.filePath}`);
}

await main();
