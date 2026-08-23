import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { runNightCycle, renderReport, EARNED_KEEP_THRESHOLD } from '../src/nightcycle.ts';
import { Ledger } from '../src/ledger.ts';

test('nightcycle streams a ledger into an earned-keep report', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saddle-night-'));
  const file = path.join(dir, 'ledger.jsonl');
  const ledger = new Ledger(file);

  // alignment A: mostly works — earns its keep
  for (let i = 0; i < 8; i++) {
    ledger.append({ cellId: 'cell.good', runId: 'r1', alignmentId: 'AAA', debit: { i }, credit: { i }, verdict: 'worked', escalated: false });
  }
  ledger.append({ cellId: 'cell.good', runId: 'r1', alignmentId: 'AAA', debit: {}, credit: {}, verdict: 'failed', escalated: false });

  // alignment B: mostly fails — thaw candidate
  for (let i = 0; i < 3; i++) {
    ledger.append({ cellId: 'cell.bad', runId: 'r2', alignmentId: 'BBB', debit: { i }, credit: {}, verdict: 'failed', escalated: i === 2 });
  }
  ledger.append({ cellId: 'cell.bad', runId: 'r2', alignmentId: 'BBB', debit: {}, credit: {}, verdict: 'failed', escalated: true, note: 'requested the cowboy' });

  const report = await runNightCycle(file);

  assert.equal(report.entries, 13);
  assert.equal(report.worked, 8);
  assert.equal(report.failed, 5);
  assert.equal(report.escalated, 2);

  const a = report.alignments.find((x) => x.alignmentId === 'AAA');
  const b = report.alignments.find((x) => x.alignmentId === 'BBB');
  assert.ok(a && a.earnedKeep, 'AAA (8/9) earns its keep');
  assert.ok(b && !b.earnedKeep, 'BBB (0/4) is a thaw candidate');
  assert.equal(a.keepRatio, 8 / 9);

  // cells sorted worst-first by failure count
  assert.equal(report.cells[0].cellId, 'cell.bad');

  // attention list carries the escalation notes
  assert.equal(report.escalations.length, 2);
  assert.ok(report.escalations.some((e) => e.note === 'requested the cowboy'));

  const md = renderReport(report);
  assert.match(md, /Night Cycle Report/);
  assert.match(md, /earned its keep/);
  assert.match(md, /thaw candidate/);
  assert.match(md, /requested the cowboy/);
  assert.match(md, /docs\/nightcycle\.md/);
});

test('empty ledger renders a quiet night', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saddle-night-'));
  const file = path.join(dir, 'ledger.jsonl');
  const report = await runNightCycle(file);
  assert.equal(report.entries, 0);
  assert.match(renderReport(report), /kennel slept through the night/);
});

test('earned-keep threshold is the documented default', () => {
  assert.equal(EARNED_KEEP_THRESHOLD, 0.75);
});
