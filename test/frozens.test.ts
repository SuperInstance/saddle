import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { freeze, thaw, listFrozen, verifyFrozen, manifestHash } from '../src/frozens.ts';
import type { AlignmentDraft } from '../src/frozens.ts';

const draft: AlignmentDraft = {
  id: 'wesley-storytime-v3',
  model: 'haiku-5',
  useCase: 'evening storytime',
  prompt: 'You are Wesley. Small, fast, full of wonder.',
  inputFilters: [{ id: 'chunk-order', kind: 'deny', description: 'no out-of-order directive chunks' }],
  outputFilters: [{ id: 'kid-safe', kind: 'deny', description: 'kid-safe endings only' }],
  params: { temperature: 0.8 },
  directiveChunks: ['read this', 'repeat it back', 'now act'],
};

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'saddle-frozens-'));
}

test('freeze writes a content-addressed read-only file', () => {
  const dir = tmpDir();
  const state = freeze(dir, draft);
  const file = path.join(dir, `${state.alignmentId}.json`);
  assert.ok(fs.existsSync(file));
  assert.equal((fs.statSync(file).mode & 0o777), 0o444, 'frozen file must be read-only');
  assert.equal(state.alignmentId, manifestHash(draft));
});

test('thaw round-trips and verifies the manifest hash', () => {
  const dir = tmpDir();
  const frozen = freeze(dir, draft);
  const thawed = thaw(dir, frozen.alignmentId);
  assert.equal(thawed.alignmentId, frozen.alignmentId);
  assert.equal(thawed.id, draft.id);
  assert.deepEqual(thawed.directiveChunks, ['read this', 'repeat it back', 'now act']);
  assert.equal(thawed.createdAt, frozen.createdAt, 'identical refreeze must not bump createdAt');
});

test('freezing identical content twice is a no-op (content addressing dedupes)', () => {
  const dir = tmpDir();
  const a = freeze(dir, draft);
  const b = freeze(dir, { ...draft });
  assert.equal(a.alignmentId, b.alignmentId);
  assert.equal(listFrozen(dir).length, 1);
  assert.equal(b.createdAt, a.createdAt);
});

test('different content → different address → two frozens', () => {
  const dir = tmpDir();
  const a = freeze(dir, draft);
  const b = freeze(dir, { ...draft, prompt: 'You are Wesley. Slightly bolder.' });
  assert.notEqual(a.alignmentId, b.alignmentId);
  assert.equal(listFrozen(dir).length, 2);
});

test('tampering with a frozen file on disk is detected on thaw', () => {
  const dir = tmpDir();
  const frozen = freeze(dir, draft);
  const file = path.join(dir, `${frozen.alignmentId}.json`);
  fs.chmodSync(file, 0o644); // a dishonest clerk needs write permission first
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.prompt = 'You are Wesley. Unsupervised.'; // content no longer matches address
  fs.writeFileSync(file, JSON.stringify(raw, null, 2));
  assert.throws(() => thaw(dir, frozen.alignmentId), /failed verification/);
  assert.equal(verifyFrozen(dir, frozen.alignmentId), null);
});

test('thaw throws cleanly for a missing alignment', () => {
  const dir = tmpDir();
  assert.throws(() => thaw(dir, 'deadbeef00000000'));
  assert.equal(verifyFrozen(dir, 'deadbeef00000000'), null);
});

test('listFrozen sorts and only sees .json states', () => {
  const dir = tmpDir();
  const a = freeze(dir, draft);
  const b = freeze(dir, { ...draft, params: { temperature: 0.2 } });
  assert.deepEqual(listFrozen(dir), [a.alignmentId, b.alignmentId].sort());
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a frozen state');
  assert.equal(listFrozen(dir).length, 2);
});

test('filter specs and params survive the round trip intact', () => {
  const dir = tmpDir();
  const frozen = freeze(dir, draft);
  const thawed = thaw(dir, frozen.alignmentId);
  assert.deepEqual(thawed.inputFilters, draft.inputFilters);
  assert.deepEqual(thawed.outputFilters, draft.outputFilters);
  assert.deepEqual(thawed.params, { temperature: 0.8 });
});
