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

  // alignment A: mostly works — earns its keep (each entry its own run)
  for (let i = 0; i < 8; i++) {
    ledger.append({ cellId: 'cell.good', runId: `r1-${i}`, alignmentId: 'AAA', debit: { i }, credit: { i }, verdict: 'worked', escalated: false });
  }
  ledger.append({ cellId: 'cell.good', runId: 'r1-f', alignmentId: 'AAA', debit: {}, credit: {}, verdict: 'failed', escalated: false });

  // alignment B: mostly fails — thaw candidate
  for (let i = 0; i < 3; i++) {
    ledger.append({ cellId: 'cell.bad', runId: `r2-${i}`, alignmentId: 'BBB', debit: { i }, credit: {}, verdict: 'failed', escalated: i === 2 });
  }
  ledger.append({ cellId: 'cell.bad', runId: 'r2-f', alignmentId: 'BBB', debit: {}, credit: {}, verdict: 'failed', escalated: true, note: 'requested the cowboy' });

  const report = await runNightCycle(file);

  assert.equal(report.entries, 13);
  assert.equal(report.worked, 8);
  assert.equal(report.failed, 5);
  assert.equal(report.escalated, 2);

  const a = report.alignments.find((x) => x.alignmentId === 'AAA');
  const b = report.alignments.find((x) => x.alignmentId === 'BBB');
  assert.ok(a && a.earnedKeep, 'AAA (8 pass / 1 fail judgments) earns its keep');
  assert.ok(b && !b.earnedKeep, 'BBB (half its runs produced no judgment) is a thaw candidate');
  // v3: 8 worked + 1 judgment-fail = 9 judgments produced out of 9 final runs
  assert.equal(a.keepRatio, 1);
  assert.equal(a.judgmentPassRate, 8 / 9);

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

  // every entry is its own run — outcome stats dedupe by (cellId, runId)
  let run = 0;
  const append = (n: number, over: Partial<Parameters<Ledger['append']>[0]>) => {
    for (let i = 0; i < n; i++) {
      ledger.append({
        cellId: 'cell.x', runId: `r-${run++}`, alignmentId: 'AAA', debit: {}, credit: {},
        verdict: 'worked', escalated: false, ...over,
      });
    }
  };

  // THAW: below the keep-ratio threshold — 3 worked + 3 execution errors
  // (clean QC-fails would now COUNT as production under v3 semantics)
  append(3, { alignmentId: 'al.thaw.ratio' });
  append(3, { alignmentId: 'al.thaw.ratio', verdict: 'failed', credit: { error: 'adapter error: timeout' } });

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
    judgmentsProduced: 0, judgmentFails: 0, executionErrors: 3, escalations: 3,
    judgmentPassRate: 0,
    tokens: { prompt: 0, completion: 0, total: 0, estimated: 0 },
    reportedTokenEntries: 0, estimatedTokenEntries: 0,
    suggestion: { action: 'keep', reason: 'placeholder' },
  };
  const s = suggestForAlignment(stat);
  assert.equal(s.action, 'keep');
  assert.equal(s.reason, 'insufficient data');
});

// ---------------------------------------------------------------------------
// v3: earned-keep measures the ALIGNMENT's production, not the bank's quality
// ---------------------------------------------------------------------------

test('v3 earned-keep: a strict judge earns its keep even when subjects fail', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saddle-night-'));
  const file = path.join(dir, 'ledger.jsonl');
  const ledger = new Ledger(file);

  // 6 passing judgments + 4 clean QC-fail judgments + 0 errors.
  // Today's (pre-v3) code would compute keepRatio 0.6 and wrongly thaw it.
  for (let i = 0; i < 6; i++) {
    ledger.append({ cellId: 'qc', runId: `w-${i}`, alignmentId: 'judge-1', debit: {}, credit: { pass: true }, verdict: 'worked', verdictKind: 'worked', escalated: false });
  }
  for (let i = 0; i < 4; i++) {
    ledger.append({ cellId: 'qc', runId: `f-${i}`, alignmentId: 'judge-1', debit: {}, credit: { pass: false, reason: 'out of voice' }, verdict: 'failed', verdictKind: 'judgment-fail', escalated: false });
  }

  const report = await runNightCycle(file);
  const a = report.alignments.find((x) => x.alignmentId === 'judge-1');
  assert.ok(a, 'judge-1 present');
  assert.equal(a.judgmentsProduced, 10);
  assert.equal(a.judgmentFails, 4);
  assert.equal(a.executionErrors, 0);
  assert.equal(a.keepRatio, 1.0, 'all runs produced a judgment');
  assert.ok(a.earnedKeep, 'a judge that cleanly fails bad lines is doing its job');
  assert.equal(a.judgmentPassRate, 0.6, 'the bank itself passed 60%');
  assert.equal(a.failed, 4, 'back-compat failed = judgmentFails + errors + escalations');
  assert.equal(a.worked + a.failed, 10, 'old report shape still adds up');
  assert.equal(a.suggestion.action, 'keep');
  // the report surfaces both metrics
  const md = renderReport(report);
  assert.match(md, /subject pass rate/i);
  assert.match(md, /60\.0%/);
});

test('v3 retries deduped: last entry of a run decides its outcome', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saddle-night-'));
  const file = path.join(dir, 'ledger.jsonl');
  const ledger = new Ledger(file);

  // one run, two entries: execution-error then a worked retry → outcome worked
  ledger.append({ cellId: 'qc', runId: 'r-1', alignmentId: 'judge-1', debit: {}, credit: { error: 'adapter error: connection reset', usage: { promptTokens: 100, completionTokens: 0, totalTokens: 100, estimated: true } }, verdict: 'failed', verdictKind: 'execution-error', escalated: false });
  ledger.append({ cellId: 'qc', runId: 'r-1', alignmentId: 'judge-1', debit: {}, credit: { pass: true, usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, estimated: false } }, verdict: 'worked', verdictKind: 'worked', escalated: false, retryOf: 1 });
  // a second, distinct run that stayed an execution-error
  ledger.append({ cellId: 'qc', runId: 'r-2', alignmentId: 'judge-1', debit: {}, credit: { error: 'parse failed: oops' }, verdict: 'failed', verdictKind: 'execution-error', escalated: false });

  const report = await runNightCycle(file);
  const a = report.alignments.find((x) => x.alignmentId === 'judge-1');
  assert.ok(a);
  assert.equal(a.judgmentsProduced, 1, 'the retried run counts once, as worked');
  assert.equal(a.worked, 1);
  assert.equal(a.executionErrors, 1, 'r-2 stayed an error');
  assert.equal(a.keepRatio, 1 / 2);
  // token cost sums over EVERY entry — the retried attempt still cost tokens
  assert.equal(a.tokens.prompt, 200);
  assert.equal(a.tokens.completion, 50);
  assert.equal(a.tokens.total, 250);
  assert.equal(a.tokens.estimated, 100, 'only the estimated entry counts as estimated tokens');
  assert.equal(a.estimatedTokenEntries, 1);
  assert.equal(a.reportedTokenEntries, 1, 'r-2 has no usage: neither bucket');
  assert.equal(report.entries, 3, 'raw entry count unchanged');
});

test('v3 legacy ledger (no verdictKind) classifies via resolveVerdictKind', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saddle-night-'));
  const file = path.join(dir, 'ledger.jsonl');
  const ledger = new Ledger(file);

  // old core cellrunner string credits
  ledger.append({ cellId: 'c', runId: 'r1', alignmentId: 'legacy', debit: {}, credit: 'parse failed: not json', verdict: 'failed', escalated: false });
  ledger.append({ cellId: 'c', runId: 'r2', alignmentId: 'legacy', debit: {}, credit: 'adapter error: timeout', verdict: 'failed', escalated: false });
  // field-trial style error object
  ledger.append({ cellId: 'c', runId: 'r3', alignmentId: 'legacy', debit: {}, credit: { error: 'boom' }, verdict: 'failed', escalated: false });
  // clean credits: real judgments
  ledger.append({ cellId: 'c', runId: 'r4', alignmentId: 'legacy', debit: {}, credit: { pass: true }, verdict: 'worked', escalated: false });
  ledger.append({ cellId: 'c', runId: 'r5', alignmentId: 'legacy', debit: {}, credit: { pass: false }, verdict: 'failed', escalated: false });
  // give-up
  ledger.append({ cellId: 'c', runId: 'r6', alignmentId: 'legacy', debit: {}, credit: { error: 'gave up' }, verdict: 'failed', escalated: true });

  const report = await runNightCycle(file);
  const a = report.alignments.find((x) => x.alignmentId === 'legacy');
  assert.ok(a);
  assert.equal(a.executionErrors, 3, 'string-prefix and {error} credits are execution errors');
  assert.equal(a.judgmentFails, 1, 'clean failed credit is a completed judgment');
  assert.equal(a.worked, 1);
  assert.equal(a.escalations, 1, 'escalated entry wins regardless of credit');
  assert.equal(a.judgmentsProduced, 2);
  assert.equal(a.keepRatio, 2 / 6);
  const v = await ledger.verify();
  assert.ok(v.ok, 'legacy ledger still verifies');
});

test('v3 token aggregation per alignment, reported vs estimated flagged', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saddle-night-'));
  const file = path.join(dir, 'ledger.jsonl');
  const ledger = new Ledger(file);

  const usage = (p: number, c: number, estimated: boolean) => ({ promptTokens: p, completionTokens: c, totalTokens: p + c, estimated });
  ledger.append({ cellId: 'c', runId: 'r1', alignmentId: 'al.tok', debit: {}, credit: { pass: true, usage: usage(100, 40, false) }, verdict: 'worked', verdictKind: 'worked', escalated: false });
  ledger.append({ cellId: 'c', runId: 'r2', alignmentId: 'al.tok', debit: {}, credit: { pass: true, usage: usage(200, 60, true) }, verdict: 'worked', verdictKind: 'worked', escalated: false });
  ledger.append({ cellId: 'c', runId: 'r3', alignmentId: 'al.tok', debit: {}, credit: { pass: true }, verdict: 'worked', verdictKind: 'worked', escalated: false }); // no usage → 0s
  // a different alignment keeps separate books
  ledger.append({ cellId: 'c', runId: 'r4', alignmentId: 'al.other', debit: {}, credit: { pass: true, usage: usage(10, 5, false) }, verdict: 'worked', verdictKind: 'worked', escalated: false });

  const report = await runNightCycle(file);
  const a = report.alignments.find((x) => x.alignmentId === 'al.tok');
  const other = report.alignments.find((x) => x.alignmentId === 'al.other');
  assert.ok(a && other);
  assert.deepEqual(a.tokens, { prompt: 300, completion: 100, total: 400, estimated: 260 });
  assert.equal(a.reportedTokenEntries, 1);
  assert.equal(a.estimatedTokenEntries, 1);
  assert.equal(other.tokens.total, 15);

  const md = renderReport(report);
  assert.match(md, /## Cost per alignment/);
  assert.match(md, /\| `al\.tok` \| 300 \| 100 \| 400 \| 65\.0% \|/);
});
