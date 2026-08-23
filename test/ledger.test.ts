import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Ledger } from '../src/ledger.ts';
import { entryHash } from '../src/ledger.ts';

function tmpLedger(): { dir: string; ledger: Ledger } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saddle-ledger-'));
  return { dir, ledger: new Ledger(path.join(dir, 'ledger.jsonl')) };
}

test('append creates a genesis entry with empty prevHash', () => {
  const { ledger } = tmpLedger();
  const e = ledger.append({
    cellId: 'wesley.storytime.open',
    runId: 'run-1',
    alignmentId: 'abc123',
    debit: { prompt: 'tell a story about boats' },
    credit: { story: 'once upon a boat...' },
    verdict: 'worked',
    escalated: false,
  });
  assert.equal(e.seq, 1);
  assert.equal(e.prevHash, '');
  assert.equal(e.debit, JSON.stringify({ prompt: 'tell a story about boats' }));
  assert.equal(e.credit, JSON.stringify({ story: 'once upon a boat...' }));
});

test('entries chain: seq increments and prevHash links', () => {
  const { ledger } = tmpLedger();
  const a = ledger.append({ cellId: 'c', runId: 'r', alignmentId: 'al', debit: 1, credit: 2, verdict: 'worked', escalated: false });
  const b = ledger.append({ cellId: 'c', runId: 'r', alignmentId: 'al', debit: 3, credit: 4, verdict: 'failed', escalated: false, retryOf: a.seq });
  const c = ledger.append({ cellId: 'c', runId: 'r', alignmentId: 'al', debit: 5, credit: 6, verdict: 'worked', escalated: true, note: 'needed the cowboy' });
  assert.equal(b.seq, 2);
  assert.equal(b.prevHash, a.hash);
  assert.equal(c.seq, 3);
  assert.equal(c.prevHash, b.hash);
  assert.equal(b.retryOf, 1);
});

test('a fresh Ledger instance sees prior history (durability + O(1) tail)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saddle-ledger-'));
  const file = path.join(dir, 'ledger.jsonl');
  const first = new Ledger(file);
  for (let i = 0; i < 10; i++) {
    first.append({ cellId: 'cell', runId: 'run', alignmentId: 'al', debit: i, credit: i, verdict: 'worked', escalated: false });
  }
  const second = new Ledger(file);
  const tail = second.tailEntry();
  assert.equal(tail?.seq, 10);
  assert.equal(await second.count(), 10);
  const eleventh = second.append({ cellId: 'cell', runId: 'run', alignmentId: 'al', debit: 10, credit: 10, verdict: 'worked', escalated: false });
  assert.equal(eleventh.seq, 11);
  assert.equal(eleventh.prevHash, tail?.hash);
});

test('verify passes on an intact chain', async () => {
  const { ledger } = tmpLedger();
  ledger.append({ cellId: 'a', runId: 'r', alignmentId: 'al', debit: {}, credit: {}, verdict: 'worked', escalated: false });
  ledger.append({ cellId: 'a', runId: 'r', alignmentId: 'al', debit: {}, credit: {}, verdict: 'failed', escalated: true });
  const result = await ledger.verify();
  assert.equal(result.ok, true);
  assert.equal(result.checked, 2);
});

test('verify detects rewritten history (tamper evidence)', async () => {
  const { dir, ledger } = tmpLedger();
  ledger.append({ cellId: 'a', runId: 'r', alignmentId: 'al', debit: 'honest', credit: {}, verdict: 'worked', escalated: false });
  ledger.append({ cellId: 'a', runId: 'r', alignmentId: 'al', debit: 'honest2', credit: {}, verdict: 'worked', escalated: false });
  // cook the books: rewrite line 1 like a dishonest clerk
  const raw = fs.readFileSync(ledger.filePath, 'utf8').split('\n');
  const forged = JSON.parse(raw[0]);
  forged.debit = JSON.stringify('cooked');
  raw[0] = JSON.stringify(forged);
  fs.writeFileSync(ledger.filePath, raw.join('\n'));
  const result = await ledger.verify();
  assert.equal(result.ok, false);
  assert.equal(result.badSeq, 1);
  assert.match(result.reason ?? '', /hash mismatch/);
});

test('stream yields entries in order with correct types', async () => {
  const { ledger } = tmpLedger();
  const verdicts = ['worked', 'failed', 'worked'] as const;
  verdicts.forEach((v, i) =>
    ledger.append({ cellId: `cell-${i}`, runId: 'run', alignmentId: 'al', debit: { i }, credit: { i }, verdict: v, escalated: v === 'failed' })
  );
  const seen: string[] = [];
  for await (const e of ledger.stream()) seen.push(`${e.seq}:${e.cellId}:${e.verdict}`);
  assert.deepEqual(seen, ['1:cell-0:worked', '2:cell-1:failed', '3:cell-2:worked']);
});

test('entryHash is deterministic and ignores only the hash field', () => {
  const base = { seq: 1, ts: '2026-01-01T00:00:00Z', cellId: 'c', runId: 'r', alignmentId: 'al', debit: 'd', credit: 'c', verdict: 'worked' as const, escalated: false, prevHash: '' };
  const h1 = entryHash(base);
  const h2 = entryHash({ ...base, ts: '2026-01-01T00:00:00Z' }); // identical content
  assert.equal(h1, h2);
  const h3 = entryHash({ ...base, debit: 'changed' });
  assert.notEqual(h1, h3);
});

test('empty or missing ledger verifies ok and counts zero', async () => {
  const { ledger } = tmpLedger();
  assert.equal(await ledger.count(), 0);
  const v = await ledger.verify();
  assert.equal(v.ok, true);
  assert.equal(v.checked, 0);
  assert.equal(ledger.tailEntry(), null);
});
