import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import * as assert from 'node:assert';

import { runQuorumCell } from '../src/quorum.ts';
import type { QuorumJudgeSpec } from '../src/quorum.ts';
import { Ledger, resolveVerdictKind } from '../src/ledger.ts';
import type { Verdict, VerdictKind } from '../src/ledger.ts';
import type { CellAdapter } from '../src/cellrunner.ts';
import { freeze } from '../src/frozens.ts';

/**
 * Quorum harness: N frozen judge alignments, ONE adapter whose behavior is
 * keyed by the judge's system prompt (the only thing that varies per frozen
 * state). No network — core is model-free.
 */

type Behavior = 'pass' | 'fail' | 'garbage' | 'throw';

function judgeDraft(label: string, behavior: Behavior) {
  return {
    id: `judge-${label}`,
    model: 'mock-model',
    useCase: 'banter-qc',
    // distinct prompt per judge — the adapter dispatches on it
    prompt: `system-prompt-for-${label}-${behavior}`,
    inputFilters: [],
    outputFilters: [],
    params: { temperature: 0.1 },
    directiveChunks: [],
  };
}

function makePanel(dir: string, behaviors: Behavior[]): { judges: QuorumJudgeSpec[]; frozensDir: string } {
  const frozensDir = path.join(dir, 'frozens');
  const judges = behaviors.map((behavior, i) => {
    const label = `j${i + 1}`;
    const frozen = freeze(frozensDir, judgeDraft(label, behavior));
    return { label, alignmentId: frozen.alignmentId };
  });
  return { judges, frozensDir };
}

function adapterFor(behaviors: Behavior[]): { adapter: CellAdapter; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    adapter: {
      name: 'quorum-mock',
      async call(request) {
        const system = request.prompt.system;
        calls.push(system);
        const m = /system-prompt-for-(j\d+)-/.exec(system);
        const label = m?.[1] ?? '?';
        const idx = Number(label.slice(1)) - 1;
        const behavior = behaviors[idx] ?? 'pass';
        if (behavior === 'throw') throw new Error('network timeout');
        if (behavior === 'garbage') return { raw: 'not json', latencyMs: 1 };
        return { raw: JSON.stringify({ pass: behavior === 'pass', judge: label }), latencyMs: 2 };
      },
    },
  };
}

function parseCredit(raw: string): { credit: unknown; verdict: Verdict } {
  const parsed = JSON.parse(raw) as { pass: boolean };
  return { credit: parsed, verdict: parsed.pass ? 'worked' : 'failed' };
}

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'saddle-quorum-'));
}

test('quorum: 3 judges, judge 2 dissents — majority worked, dissent in the books', async () => {
  const dir = tmp();
  try {
    const { judges, frozensDir } = makePanel(dir, ['pass', 'fail', 'pass']);
    const ledger = new Ledger(path.join(dir, 'ledger.jsonl'));
    const { adapter } = adapterFor(['pass', 'fail', 'pass']);

    const result = await runQuorumCell({
      frozenDir: frozensDir,
      judges,
      cellId: 'ft2/banter-qc-quorum',
      runId: 'run-q1',
      input: { lineId: 'L001', text: 'nice find!' },
      buildUserPrompt: (input, frozen) => `judge ${JSON.stringify(input)} as ${frozen.useCase}`,
      parseCredit,
      ledger,
      adapter,
    });

    assert.equal(result.majority, 'worked');
    assert.deepStrictEqual(result.votes, { worked: 2, 'judgment-fail': 1, noJudgment: 0 });
    assert.equal(result.dissent.length, 1);
    assert.equal(result.dissent[0]!.judge, 'j2');
    assert.equal(result.dissent[0]!.verdict, 'judgment-fail');

    // judge outcomes + per-judge cellIds
    assert.deepEqual(result.judges.map((j) => j.finalVerdictKind).sort(), ['judgment-fail', 'worked', 'worked']);
    assert.deepEqual(
      result.judges.map((j) => j.final.cellId).sort(),
      ['ft2/banter-qc-quorum/j1', 'ft2/banter-qc-quorum/j2', 'ft2/banter-qc-quorum/j3']
    );

    // the summary entry: one entry, legacy mapping, kind worked
    assert.equal(result.summary.cellId, 'ft2/banter-qc-quorum');
    assert.equal(result.summary.runId, 'run-q1');
    assert.equal(result.summary.verdict, 'worked');
    assert.equal(result.summary.verdictKind, 'worked');
    assert.equal(result.summary.escalated, false);

    // books: 3 judge entries + 1 summary, chain intact, dissent parseable back out
    assert.equal(await ledger.count(), 4);
    assert.ok(await ledger.verify().then((v) => v.ok));
    const summaryCredit = JSON.parse(result.summary.credit);
    assert.equal(summaryCredit.majority, 'worked');
    assert.deepEqual(summaryCredit.votes, { worked: 2, 'judgment-fail': 1, noJudgment: 0 });
    assert.deepEqual(summaryCredit.dissent, [{ judge: 'j2', alignmentId: judges[1]!.alignmentId, verdict: 'judgment-fail' }]);
    assert.deepEqual(
      summaryCredit.judges.map((j: { label: string }) => j.label),
      ['j1', 'j2', 'j3']
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('quorum: a judge with execution-error casts no vote (but is recorded)', async () => {
  const dir = tmp();
  try {
    const { judges, frozensDir } = makePanel(dir, ['pass', 'pass', 'throw']);
    const ledger = new Ledger(path.join(dir, 'ledger.jsonl'));
    const { adapter } = adapterFor(['pass', 'pass', 'throw']);

    const result = await runQuorumCell({
      frozenDir: frozensDir, judges,
      cellId: 'q', runId: 'run-q2',
      input: {},
      buildUserPrompt: () => 'judge this',
      parseCredit,
      ledger, adapter,
      maxAttempts: 2,
    });

    // judge 3 threw twice → its final entry is the give-up (escalated kind)
    const j3 = result.judges.find((j) => j.label === 'j3')!;
    assert.equal(j3.finalVerdictKind, 'escalated');
    assert.equal(j3.entries.length, 2);
    assert.equal(j3.vote, null, 'no judgment produced → no vote');
    assert.equal(resolveVerdictKind(j3.final), 'escalated');

    // 2 worked votes of 3 seats: 2 > 1.5 → majority still rules
    assert.equal(result.majority, 'worked');
    assert.deepStrictEqual(result.votes, { worked: 2, 'judgment-fail': 0, noJudgment: 1 });
    assert.equal(result.dissent.length, 0, 'an absent judge is not a dissenter');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('quorum: 1-1 with one no-judgment is hung — summary escalates for the cowboy', async () => {
  const dir = tmp();
  try {
    const { judges, frozensDir } = makePanel(dir, ['pass', 'fail', 'garbage']);
    const ledger = new Ledger(path.join(dir, 'ledger.jsonl'));
    const { adapter } = adapterFor(['pass', 'fail', 'garbage']);

    const result = await runQuorumCell({
      frozenDir: frozensDir, judges,
      cellId: 'q', runId: 'run-q3',
      input: {},
      buildUserPrompt: () => 'judge this',
      parseCredit,
      ledger, adapter,
      maxAttempts: 2,
    });

    // judge 3's garbage output never parses → execution-error → escalated give-up
    const j3 = result.judges.find((j) => j.label === 'j3')!;
    assert.equal(j3.finalVerdictKind, 'escalated');

    assert.equal(result.majority, 'hung');
    assert.deepStrictEqual(result.votes, { worked: 1, 'judgment-fail': 1, noJudgment: 1 });
    assert.equal(result.summary.verdict, 'failed', 'hung maps to legacy failed');
    assert.equal(result.summary.verdictKind, 'escalated');
    assert.equal(result.summary.escalated, true, 'the cowboy must look');
    assert.match(result.summary.note ?? '', /hung jury/);
    assert.equal(result.dissent.length, 0, 'no majority to dissent from');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('quorum: single judge degenerates to the judge’s verdict', async () => {
  const dir = tmp();
  try {
    // passing single judge
    {
      const { judges, frozensDir } = makePanel(dir, ['pass']);
      const ledger = new Ledger(path.join(dir, 'ledger.jsonl'));
      const { adapter } = adapterFor(['pass']);
      const result = await runQuorumCell({
        frozenDir: frozensDir, judges, cellId: 'solo', runId: 'run-s1',
        input: {}, buildUserPrompt: () => 'judge', parseCredit, ledger, adapter,
      });
      assert.equal(result.majority, 'worked');
      assert.equal(result.summary.verdictKind, 'worked');
      assert.equal(result.summary.escalated, false);
    }
    // failing single judge: 1 judgment-fail vote of 1 seat is a strict majority
    {
      const { judges, frozensDir } = makePanel(dir, ['fail']);
      const ledger = new Ledger(path.join(dir, 'ledger2.jsonl'));
      const { adapter } = adapterFor(['fail']);
      const result = await runQuorumCell({
        frozenDir: frozensDir, judges, cellId: 'solo', runId: 'run-s2',
        input: {}, buildUserPrompt: () => 'judge', parseCredit, ledger, adapter,
      });
      assert.equal(result.majority, 'judgment-fail');
      assert.equal(result.summary.verdict, 'failed');
      assert.equal(result.summary.verdictKind, 'judgment-fail');
      assert.equal(result.summary.escalated, false, 'a clean fail judgment is not an escalation');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('quorum: judge kinds land in the books and the summary alignmentId addresses the panel', async () => {
  const dir = tmp();
  try {
    const { judges, frozensDir } = makePanel(dir, ['pass', 'fail', 'pass']);
    const ledger = new Ledger(path.join(dir, 'ledger.jsonl'));
    const { adapter } = adapterFor(['pass', 'fail', 'pass']);

    const result = await runQuorumCell({
      frozenDir: frozensDir, judges, cellId: 'q', runId: 'run-k',
      input: {}, buildUserPrompt: () => 'judge', parseCredit, ledger, adapter,
    });

    // every judge entry carries an explicit kind (runCell stamps v3 kinds)
    const kinds: VerdictKind[] = result.judges.map((j) => j.final.verdictKind!);
    assert.deepEqual(kinds.sort(), ['judgment-fail', 'worked', 'worked']);

    // the summary's alignmentId is the panel's content address — never any
    // single judge's (so it cannot skew one judge's earned-keep stats)
    assert.ok(result.summary.alignmentId.startsWith('quorum:'));
    for (const j of judges) {
      assert.notEqual(result.summary.alignmentId, j.alignmentId);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
