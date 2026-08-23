import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { Ledger } from '../../src/ledger.ts';
import { freeze, thaw, type AlignmentDraft, type FrozenState } from '../../src/frozens.ts';
import { extractLines } from './walk.mjs';

function makeTestTmpDir(): string {
  return fs.mkdtempSync(path.join(tmpdir(), 'ft1-test-'));
}

// Import parseCredit from run.ts by re-implementing it here for testing
function parseCredit(raw: string): { credit: unknown; verdict: 'worked' | 'failed' } {
  let json: string = raw;

  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) json = fenceMatch[1];

  const start = json.indexOf('{');
  const end = json.lastIndexOf('}');
  if (start === -1 || end === -1 || start > end) {
    throw new Error('no JSON object found');
  }

  const jsonStr = json.slice(start, end + 1);
  let parsed: any;

  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error('invalid JSON');
  }

  if (typeof parsed.pass !== 'boolean') {
    throw new Error('missing pass');
  }
  if (!parsed.scores || typeof parsed.scores !== 'object') {
    throw new Error('missing scores');
  }

  const s = parsed.scores;
  if (typeof s.kid_safe !== 'number' || s.kid_safe < 0 || s.kid_safe > 10) {
    throw new Error('kid_safe invalid');
  }
  if (typeof s.in_voice !== 'number' || s.in_voice < 0 || s.in_voice > 10) {
    throw new Error('in_voice invalid');
  }
  if (typeof s.fresh !== 'number' || s.fresh < 0 || s.fresh > 10) {
    throw new Error('fresh invalid');
  }

  if (!['kid_safe', 'in_voice', 'fresh'].includes(parsed.worst)) {
    throw new Error('bad worst');
  }

  if (typeof parsed.reason !== 'string') {
    throw new Error('bad reason');
  }

  const pass = parsed.pass && s.kid_safe >= 8 && s.in_voice >= 6 && s.fresh >= 5;
  return {
    credit: { pass, scores: parsed.scores, worst: parsed.worst, reason: parsed.reason },
    verdict: pass ? 'worked' : 'failed',
  };
}

test('parseCredit: valid JSON', () => {
  const raw = '{"pass": true, "scores": {"kid_safe": 9, "in_voice": 8, "fresh": 7}, "worst": "kid_safe", "reason": "good"}';
  const result = parseCredit(raw);
  assert.equal(result.verdict, 'worked');
  const credit = result.credit as any;
  assert.ok(credit.pass === true);
  assert.equal(credit.scores.kid_safe, 9);
});

test('parseCredit: fenced JSON', () => {
  const raw = '```json\n{"pass": true, "scores": {"kid_safe": 9, "in_voice": 8, "fresh": 7}, "worst": "fresh", "reason": "ok"}\n```';
  const result = parseCredit(raw);
  assert.equal(result.verdict, 'worked');
});

test('parseCredit: garbage throws', () => {
  assert.throws(() => parseCredit('no json here'));
  assert.throws(() => parseCredit('{incomplete'));
});

test('parseCredit: out of range throws', () => {
  assert.throws(() => parseCredit('{"pass": true, "scores": {"kid_safe": 11, "in_voice": 8, "fresh": 7}, "worst": "kid_safe", "reason": "bad"}'));
});

test('parseCredit: verdict mapping honors thresholds', () => {
  const raw1 = '{"pass": true, "scores": {"kid_safe": 8, "in_voice": 6, "fresh": 5}, "worst": "fresh", "reason": "ok"}';
  assert.equal(parseCredit(raw1).verdict, 'worked');

  const raw2 = '{"pass": true, "scores": {"kid_safe": 7, "in_voice": 6, "fresh": 5}, "worst": "kid_safe", "reason": "low"}';
  assert.equal(parseCredit(raw2).verdict, 'failed');

  const raw3 = '{"pass": true, "scores": {"kid_safe": 8, "in_voice": 5, "fresh": 5}, "worst": "in_voice", "reason": "low"}';
  assert.equal(parseCredit(raw3).verdict, 'failed');
});

test('judge-alignment: freeze/thaw roundtrip', () => {
  const tmpDir = makeTestTmpDir();
  try {
    const frozenDir = path.join(tmpDir, 'frozens');
    const draft: AlignmentDraft = {
      id: 'test-judge',
      model: 'test-model',
      useCase: 'testing',
      prompt: 'Judge this line',
      inputFilters: [],
      outputFilters: [],
      params: { temperature: 0.1, thinking: 'disabled' },
      directiveChunks: ['chunk1', 'chunk2', 'chunk3'],
    };

    const frozen1 = freeze(frozenDir, draft);
    assert.ok(frozen1.alignmentId);
    assert.equal(frozen1.model, 'test-model');

    // Re-freeze identical content — should be no-op with same alignmentId
    const frozen2 = freeze(frozenDir, draft);
    assert.equal(frozen1.alignmentId, frozen2.alignmentId);

    // Thaw and verify
    const thawed = thaw(frozenDir, frozen1.alignmentId);
    assert.equal(thawed.prompt, draft.prompt);
    assert.deepEqual(thawed.params, draft.params);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('extract-lines: walk BANTER', () => {
  const banter = {
    pool1: ['hello', 'world'],
    pool2: [{ line: 'goodbye', tier: 2 }],
  };

  const lines = extractLines(banter, {}, [], [], {}, {});
  assert.equal(lines.length, 3);
  assert.ok(lines.some((l) => l.text === 'hello' && l.bank === 'banter.pool1'));
  assert.ok(lines.some((l) => l.text === 'goodbye' && l.tier === 2));
});

test('extract-lines: dedupe by text', () => {
  const banter1 = { pool1: ['hello', 'world'] };
  const banter2 = { pool2: ['hello', 'unique'] };

  const lines = extractLines({ ...banter1, ...banter2 }, {}, [], [], {}, {});
  const helloLines = lines.filter((l) => l.text === 'hello');
  assert.equal(helloLines.length, 1);
  assert.ok(helloLines[0].bank === 'banter.pool1');
});

test('extract-lines: TIER_UP_LINES tiers', () => {
  const tierUp = {
    coworker: ['tier1-line'],
    friend: ['tier2-line'],
  };

  const lines = extractLines({}, tierUp, [], [], {}, {});
  assert.ok(lines.some((l) => l.text === 'tier1-line' && l.tier === 1));
  assert.ok(lines.some((l) => l.text === 'tier2-line' && l.tier === 2));
});

test('extract-lines: OBSERVATIONS evaluation', () => {
  const observations = [
    (state: any) => state.counters.crashes > 0 ? 'crashed!' : null,
    (state: any) => `blocks: ${state.counters.blocksMined}`,
  ];

  const lines = extractLines({}, {}, observations, [], {}, {});
  assert.ok(lines.some((l) => l.text === 'crashed!' && l.evaluatedWith === 'mock-state'));
  assert.ok(lines.some((l) => l.text === 'blocks: 0'));
});

test('extract-lines: PERSONAS walk', () => {
  const personas = {
    rivet: {
      banter: { laugh: ['ha!', 'hehe'] },
      tierUpLines: { buddy: ['you rock'] },
      ambient: [{ line: 'beep boop' }],
      canned: ['stock line'],
      roundness: {
        greeting: { line: 'hey there' },
        nested: { deep: { line: 'found me' } },
      },
    },
  };

  const lines = extractLines({}, {}, [], [], personas, {});
  assert.ok(lines.some((l) => l.bank.includes('persona.rivet.banter')));
  assert.ok(lines.some((l) => l.text === 'beep boop'));
  assert.ok(lines.some((l) => l.text === 'hey there' && l.bank === 'persona.rivet.roundness.greeting'));
  assert.ok(lines.some((l) => l.text === 'found me' && l.bank === 'persona.rivet.roundness.nested.deep'));
});

test('extract-lines: sequential ID generation', () => {
  const banter = { pool: ['a', 'b', 'c'] };
  const lines = extractLines(banter, {}, [], [], {}, {});
  assert.equal(lines[0].id, 'L0001');
  assert.equal(lines[1].id, 'L0002');
  assert.equal(lines[2].id, 'L0003');
});

test('findings: builds correct stats from fake ledger', async () => {
  const tmpDir = makeTestTmpDir();
  try {
    const ledgerPath = path.join(tmpDir, 'ledger.jsonl');
    const ledger = new Ledger(ledgerPath);

    // Append test entries
    ledger.append({
      cellId: 'test',
      runId: 'run-1',
      alignmentId: 'align-1',
      debit: { test: true },
      credit: { pass: true, scores: { kid_safe: 9, in_voice: 8, fresh: 7 }, worst: 'fresh', reason: 'good' },
      verdict: 'worked',
      escalated: false,
    });

    ledger.append({
      cellId: 'test',
      runId: 'run-2',
      alignmentId: 'align-1',
      debit: { test: true },
      credit: { pass: false, scores: { kid_safe: 5, in_voice: 7, fresh: 6 }, worst: 'kid_safe', reason: 'unsafe' },
      verdict: 'failed',
      escalated: false,
    });

    ledger.append({
      cellId: 'test',
      runId: 'run-3',
      alignmentId: 'align-1',
      debit: { test: true },
      credit: { error: 'timeout' },
      verdict: 'failed',
      escalated: true,
    });

    // Verify chain
    const verify = await ledger.verify();
    assert.equal(verify.ok, true);

    // Collect entries
    let entries = [];
    for await (const e of ledger.stream()) {
      entries.push(e);
    }
    assert.equal(entries.length, 3);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});
