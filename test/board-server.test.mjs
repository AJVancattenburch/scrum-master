import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createBoardServer } from '../lib/board-server.mjs';
import { STAGES, addItem, emptyBoard, loadBoard, saveBoard } from '../lib/board-store.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'board-'));
const boardPath = path.join(dir, 'board.json');
const htmlPath = path.join(dir, 'index.html');
let server;
let base;

before(async () => {
  writeFileSync(htmlPath, '<h1>board</h1>');
  const board = emptyBoard();
  for (const title of ['a', 'b']) addItem(board, 'tasks', { title });
  await saveBoard(boardPath, board);
  server = createBoardServer({ boardPath, htmlPath, port: 0 });
  await once(server, 'listening');
  assert.equal(server.address().address, '127.0.0.1');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const post = (body) => fetch(`${base}/move`, { method: 'POST', body });

test('GET / serves the dashboard html', async () => {
  const res = await fetch(base);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(await res.text(), '<h1>board</h1>');
});

test('GET /board.json serves the board', async () => {
  const res = await fetch(`${base}/board.json`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.tasks.map((t) => t.id), ['T1', 'T2']);
  assert.deepEqual(body.stages, STAGES);
});

test('POST /move reorders and returns 204', async () => {
  const res = await post(JSON.stringify({ id: 'T2', index: 0 }));
  assert.equal(res.status, 204);
  assert.deepEqual(loadBoard(boardPath).tasks.map((t) => t.id), ['T2', 'T1']);
});

test('POST /move returns 400 on bad JSON or BoardError', async () => {
  for (const body of ['{', JSON.stringify({ id: 'T9', index: 0 }), JSON.stringify({ id: 'T1', index: 'x' })]) {
    const res = await post(body);
    assert.equal(res.status, 400, body);
    assert.match(await res.text(), /\S/);
  }
});

test('unknown routes return 404', async () => {
  assert.equal((await fetch(`${base}/nope`)).status, 404);
  assert.equal((await fetch(`${base}/board.json`, { method: 'DELETE' })).status, 404);
});

test('GET /events pushes after saveBoard', async () => {
  const req = http.get(`${base}/events`);
  const [res] = await once(req, 'response');
  assert.match(res.headers['content-type'], /text\/event-stream/);
  res.setEncoding('utf8');
  const received = new Promise((resolve) => res.on('data', (chunk) => chunk.includes('data: changed\n\n') && resolve()));
  await saveBoard(boardPath, emptyBoard());
  await received;
  req.destroy();
});
