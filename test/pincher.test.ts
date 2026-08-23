import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  PincherRpcClient,
  PincherRpcError,
  ReflexSpoolIngest,
  VerdictReturn,
  PINCHER_ERR_TIMEOUT,
  PINCHER_ERR_TRANSPORT,
  PINCHER_ERR_BAD_RESPONSE,
} from '../src/pincher.ts';
import { Ledger } from '../src/ledger.ts';

function tmpdir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Mock pincher UDS server speaking the EXACT wire protocol of
 * pincher-core/src/rpc/server.rs: JSON-RPC 2.0, newline-delimited,
 * serde-tagged results, id:null + -32700 on parse error,
 * -32601 on unknown method.
 */
function startMockPincher(socketPath: string): Promise<net.Server> {
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    let buf = '';
    socket.on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        respond(socket, line);
      }
    });
  });
  return new Promise((resolve) => server.listen(socketPath, () => resolve(server)));
}

function respond(socket: net.Socket, line: string): void {
  let req: { id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    req = JSON.parse(line.trim()) as typeof req;
  } catch (e) {
    socket.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: `Parse error: ${(e as Error).message}` },
      }) + '\n'
    );
    return;
  }
  const id = req.id ?? null;
  let result: unknown;
  switch (req.method) {
    case 'ping':
      result = { method: 'ping', pong: 'pong' };
      break;
    case 'embed_text':
      result = { method: 'embed_text', embedding: [0.1, -0.2, 0.3], dimensions: 3 };
      break;
    case 'match_reflex': {
      const intent = String(req.params?.intent ?? '');
      if (intent === 'exact intent') {
        result = { method: 'match_reflex', match_type: 'Exact', similarity: 1.0, reflex_id: 'rx-42' };
      } else if (intent === 'vague intent') {
        result = { method: 'match_reflex', match_type: 'Similar', similarity: 0.87, reflex_id: 'rx-7' };
      } else {
        result = { method: 'match_reflex', match_type: 'Novel', similarity: 0.12, reflex_id: null };
      }
      break;
    }
    case 'teach_reflex':
      result = {
        method: 'teach_reflex',
        reflex_id: 'rx-99',
        intent: String(req.params?.intent ?? ''),
        confidence: 0.5,
      };
      break;
    case 'get_status':
      result = {
        method: 'get_status',
        status: { reflex_count: 2, action_log_count: 7, embedder_loaded: true },
      };
      break;
    default:
      socket.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${req.method}` },
        }) + '\n'
      );
      return;
  }
  socket.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

test('rpc client round-trips against a mock pincher: ping, embed, match, teach, status', async () => {
  const dir = tmpdir('saddle-pincher-');
  const socketPath = path.join(dir, 'pincher.sock');
  const server = await startMockPincher(socketPath);
  const client = new PincherRpcClient({ socketPath });

  const pong = await client.ping();
  assert.equal(pong.method, 'ping');
  assert.equal(pong.pong, 'pong');

  const emb = await client.embedText('hello wesley');
  assert.equal(emb.method, 'embed_text');
  assert.equal(emb.dimensions, 3);
  assert.deepEqual(emb.embedding, [0.1, -0.2, 0.3]);

  const exact = await client.matchReflex('exact intent');
  assert.equal(exact.match_type, 'Exact');
  assert.equal(exact.reflex_id, 'rx-42');

  const similar = await client.matchReflex('vague intent');
  assert.equal(similar.match_type, 'Similar');
  assert.equal(similar.similarity, 0.87);

  const novel = await client.matchReflex('something never seen');
  assert.equal(novel.match_type, 'Novel');
  assert.equal(novel.reflex_id, null);

  const taught = await client.teachReflex('fresh intent', 'do the thing');
  assert.equal(taught.method, 'teach_reflex');
  assert.equal(taught.reflex_id, 'rx-99');
  assert.equal(taught.intent, 'fresh intent');
  assert.equal(taught.confidence, 0.5);

  const status = await client.getStatus();
  assert.equal(status.status.reflex_count, 2);
  assert.equal(status.status.action_log_count, 7);
  assert.equal(status.status.embedder_loaded, true);

  await close(server);
});

test('rpc client surfaces JSON-RPC error responses as PincherRpcError', async () => {
  const dir = tmpdir('saddle-pincher-');
  const socketPath = path.join(dir, 'pincher.sock');
  const server = await startMockPincher(socketPath);
  const client = new PincherRpcClient({ socketPath });

  await assert.rejects(
    client.call('no_such_method' as string),
    (err: unknown) => {
      assert.ok(err instanceof PincherRpcError);
      assert.equal(err.code, -32601);
      assert.match(err.message, /Method not found: no_such_method/);
      return true;
    }
  );

  await close(server);
});

test('server answers a garbage line with id:null / code -32700 (real server behavior)', async () => {
  const dir = tmpdir('saddle-pincher-');
  const socketPath = path.join(dir, 'pincher.sock');
  const server = await startMockPincher(socketPath);

  const reply: string = await new Promise((resolve, reject) => {
    const sock = net.connect(socketPath);
    let buf = '';
    sock.on('connect', () => sock.write('this is not json at all\n'));
    sock.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl !== -1) {
        sock.destroy();
        resolve(buf.slice(0, nl));
      }
    });
    sock.on('error', reject);
  });

  const msg = JSON.parse(reply) as { id: unknown; error?: { code: number } };
  assert.equal(msg.id, null);
  assert.equal(msg.error?.code, -32700);

  await close(server);
});

test('rpc client rejects a non-JSON response line', async () => {
  const dir = tmpdir('saddle-pincher-');
  const socketPath = path.join(dir, 'garbage.sock');
  // like the real server, this mock still READS the request line — a server
  // that never reads keeps its side of the socket paused forever
  const server = net.createServer((s) => {
    s.resume();
    s.write('definitely not json\n');
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));

  const client = new PincherRpcClient({ socketPath });
  await assert.rejects(
    client.ping(),
    (err: unknown) => {
      assert.ok(err instanceof PincherRpcError);
      assert.equal(err.code, PINCHER_ERR_BAD_RESPONSE);
      assert.match(err.message, /not valid JSON/);
      return true;
    }
  );

  await close(server);
});

test('rpc client times out when the server never answers', async () => {
  const dir = tmpdir('saddle-pincher-');
  const socketPath = path.join(dir, 'silent.sock');
  const server = net.createServer((s) => {
    s.resume(); // swallow the request but keep reading, like the real server
    /* accept and stay silent */
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));

  const client = new PincherRpcClient({ socketPath, timeoutMs: 100 });
  await assert.rejects(
    client.ping(),
    (err: unknown) => {
      assert.ok(err instanceof PincherRpcError);
      assert.equal(err.code, PINCHER_ERR_TIMEOUT);
      assert.match(err.message, /timeout/);
      return true;
    }
  );

  await close(server);
});

test('rpc client rejects on a bad socket path', async () => {
  const client = new PincherRpcClient({
    socketPath: path.join(tmpdir('saddle-pincher-'), 'missing.sock'),
    timeoutMs: 500,
  });
  await assert.rejects(
    client.ping(),
    (err: unknown) => {
      assert.ok(err instanceof PincherRpcError);
      assert.equal(err.code, PINCHER_ERR_TRANSPORT);
      assert.match(err.message, /socket error/);
      return true;
    }
  );
});

test('spool ingest books events with the verdict mapping and resumes from the sidecar', async () => {
  const dir = tmpdir('saddle-spool-');
  const spoolPath = path.join(dir, 'events.jsonl');
  const ledger = new Ledger(path.join(dir, 'ledger.jsonl'));

  const event = (over: Partial<Record<string, unknown>>): string =>
    JSON.stringify({
      type: 'reflex.outcome',
      ts: '2026-08-23T08:00:00.000Z',
      cellId: 'fleet.cell.a',
      runId: 'run-1',
      reflexId: 'rx-1',
      input: { stimulus: 'nip' },
      output: { reaction: 'flinch' },
      ...over,
    });

  fs.writeFileSync(
    spoolPath,
    [
      event({}), // outcome, verdict absent → 'worked'
      event({ verdict: 'failed', escalated: true, cellId: 'fleet.cell.b' }), // explicit failed + escalated
      JSON.stringify({
        type: 'reflex.miss',
        ts: '2026-08-23T08:00:01.000Z',
        cellId: 'fleet.cell.a',
        runId: 'run-2',
        reflexId: 'rx-1',
        input: { stimulus: 'nothing matched' },
        output: null,
      }),
    ].join('\n') + '\n'
  );

  const ingest = new ReflexSpoolIngest({
    spoolPath,
    ledger,
    alignmentResolver: (cellId) => (cellId === 'fleet.cell.b' ? 'frozen-abc123' : undefined),
  });

  const first = await ingest.ingestAll();
  assert.equal(first.entries.length, 3);

  const [outcomeNoVerdict, outcomeFailed, miss] = first.entries;
  assert.ok(outcomeNoVerdict && outcomeFailed && miss);
  assert.equal(outcomeNoVerdict.verdict, 'worked'); // outcome default
  assert.equal(outcomeNoVerdict.alignmentId, 'unaligned'); // resolver miss
  assert.equal(outcomeNoVerdict.cellId, 'fleet.cell.a');
  assert.deepEqual(JSON.parse(outcomeNoVerdict.debit), { stimulus: 'nip' });

  assert.equal(outcomeFailed.verdict, 'failed'); // event's explicit verdict wins
  assert.equal(outcomeFailed.escalated, true);
  assert.equal(outcomeFailed.alignmentId, 'frozen-abc123'); // resolver hit

  assert.equal(miss.verdict, 'failed'); // miss is always failed
  assert.match(miss.note ?? '', /reflex miss — no reflex earned its keep/);

  // sidecar checkpointed at EOF
  assert.equal(fs.readFileSync(spoolPath + '.pos', 'utf8').trim(), String(fs.statSync(spoolPath).size));

  // resume: only new lines are consumed
  fs.appendFileSync(
    spoolPath,
    event({ runId: 'run-3', reflexId: 'rx-2', cellId: 'fleet.cell.c' }) + '\n'
  );
  const second = await ingest.ingestSinceLast();
  assert.equal(second.entries.length, 1);
  assert.equal(second.entries[0]?.runId, 'run-3');

  const total = await ledger.count();
  assert.equal(total, 4);
  assert.equal((await ledger.verify()).ok, true);
});

test('spool ingest leaves a trailing partial (unterminated) line for the next pass', async () => {
  const dir = tmpdir('saddle-spool-');
  const spoolPath = path.join(dir, 'events.jsonl');
  const ledger = new Ledger(path.join(dir, 'ledger.jsonl'));

  const complete = JSON.stringify({
    type: 'reflex.outcome', ts: '2026-08-23T08:00:00.000Z', cellId: 'c', runId: 'r',
    reflexId: 'rx', input: null, output: null, verdict: 'worked',
  });
  fs.writeFileSync(spoolPath, complete + '\n' + '{"type":"reflex.outco'); // torn write

  const ingest = new ReflexSpoolIngest({ spoolPath, ledger });
  const { entries } = await ingest.ingestAll();
  assert.equal(entries.length, 1); // only the complete line

  // writer finishes the line; the next pass picks it up
  fs.appendFileSync(spoolPath, 'me","ts":"2026-08-23T08:00:02.000Z","cellId":"c","runId":"r2","reflexId":"rx","input":null,"output":null}\n');
  const more = await ingest.ingestSinceLast();
  assert.equal(more.entries.length, 1);
  assert.equal(more.entries[0]?.runId, 'r2');
  assert.equal(await ledger.count(), 2);
});

test('verdict return appends JSONL for pincher to consume', () => {
  const dir = tmpdir('saddle-verdict-');
  const verdicts = new VerdictReturn({ path: path.join(dir, 'verdicts.jsonl') });
  verdicts.send({ cellId: 'fleet.cell.a', runId: 'run-1', reflexId: 'rx-1', verdict: 'failed', note: 'cowboy says no' });
  verdicts.send({ cellId: 'fleet.cell.b', runId: 'run-2', reflexId: 'rx-2', verdict: 'worked' });

  const lines = fs.readFileSync(path.join(dir, 'verdicts.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0] ?? '');
  assert.equal(first.cellId, 'fleet.cell.a');
  assert.equal(first.verdict, 'failed');
  assert.equal(first.note, 'cowboy says no');
  const second = JSON.parse(lines[1] ?? '');
  assert.equal(second.note, undefined);
});
