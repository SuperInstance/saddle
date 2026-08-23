import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { runNightCycle, renderReport, EARNED_KEEP_THRESHOLD, suggestForAlignment } from '../src/nightcycle.ts';
import type { AlignmentStat } from '../src/nightcycle.ts';
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
  const worst = report.cells[0];
  assert.ok(worst, 'report has at least one cell');
  assert.equal(worst.cellId, 'cell.bad');

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

test('nightcycle v2: suggested actions per alignment + cowboyNeeded mirrors escalations', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saddle-night-'));
  const file = path.join(dir, 'ledger.jsonl');
  const ledger = new Ledger(file);

  const append = (n: number, over: Partial<Parameters<Ledger['append']>[0]>) => {
    for (let i = 0; i < n; i++) {
      ledger.append({
        cellId: 'cell.x', runId: 'r', alignmentId: 'AAA', debit: {}, credit: {},
        verdict: 'worked', escalated: false, ...over,
      });
    }
  };

  // THAW: below the keep-ratio threshold
  append(3, { alignmentId: 'al.thaw.ratio' });
  append(3, { alignmentId: 'al.thaw.ratio', verdict: 'failed' });

  // THAW: keep ratio fine (7/9 = 77.8%) but escalation-heavy (2/9 > 20%)
  append(7, { alignmentId: 'al.thaw.escalation' });
  append(2, { alignmentId: 'al.thaw.escalation', verdict: 'failed', escalated: true, note: 'cowboy!' });

  // REFREEZE: earned keep, ≥20 worked, ratio ≥0.95 (25/26)
  append(25, { alignmentId: 'al.refreeze' });
  append(1, { alignmentId: 'al.refreeze', verdict: 'failed' });

  // KEEP: earned keep, decent ratio, but worked < 20 → not proven enough to refreeze
  append(9, { alignmentId: 'al.keep' });
  append(1, { alignmentId: 'al.keep', verdict: 'failed' });

  // LOW SAMPLE: 4 entries → insufficient data
  append(4, { alignmentId: 'al.tiny' });

  const report = await runNightCycle(file);
  const byId = new Map(report.alignments.map((a) => [a.alignmentId, a]));

  assert.equal(byId.get('al.thaw.ratio')?.suggestion.action, 'thaw');
  assert.match(byId.get('al.thaw.ratio')?.suggestion.reason ?? '', /below the 75\.0% threshold/);

  assert.equal(byId.get('al.thaw.escalation')?.suggestion.action, 'thaw');
  assert.match(byId.get('al.thaw.escalation')?.suggestion.reason ?? '', /escalation rate 22\.2% exceeds 20%/);

  assert.equal(byId.get('al.refreeze')?.suggestion.action, 'refreeze');
  assert.match(byId.get('al.refreeze')?.suggestion.reason ?? '', /stable and proven/);

  assert.equal(byId.get('al.keep')?.suggestion.action, 'keep');

  assert.equal(byId.get('al.tiny')?.suggestion.action, 'keep');
  assert.equal(byId.get('al.tiny')?.suggestion.reason, 'insufficient data');

  // cowboyNeeded carries the same data as escalations (both kept for back-compat)
  assert.equal(report.cowboyNeeded.length, report.escalations.length);
  assert.deepEqual(report.cowboyNeeded, report.escalations);

  const md = renderReport(report);
  assert.match(md, /## Suggested actions/);
  assert.match(md, /\| `al\.refreeze` \| refreeze \|/);
  assert.match(md, /\| `al\.thaw\.ratio` \| thaw \|/);
  assert.match(md, /never auto-mutates frozens or alignments/);
});

test('low-sample guard: even a bad alignment under 5 entries is kept', () => {
  const stat: AlignmentStat = {
    alignmentId: 'x', worked: 0, failed: 3, escalated: 3,
    keepRatio: 0, earnedKeep: false,
    suggestion: { action: 'keep', reason: 'placeholder' },
  };
  const s = suggestForAlignment(stat);
  assert.equal(s.action, 'keep');
  assert.equal(s.reason, 'insufficient data');
});
