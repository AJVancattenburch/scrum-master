import { test, describe, before, after } from 'node:test';
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

test('branch routes are absent when repos is not configured', async () => {
  assert.equal((await fetch(`${base}/branches.json`)).status, 404);
  assert.equal((await fetch(`${base}/branches/refresh`, { method: 'POST' })).status, 404);
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

describe('branch queue routes', () => {
  const branchDir = mkdtempSync(path.join(tmpdir(), 'board-branches-'));
  const branchBoardPath = path.join(branchDir, 'board.json');
  const branchHtmlPath = path.join(branchDir, 'index.html');
  let branchServer;
  let branchBase;
  let snapshotImpl;

  const repoABranch = (overrides = {}) => ({
    name: 'feature-a', behind: 1, ageDays: 1, lastCommitDays: 1, conflicts: [], worktree: null, dirty: false, unpushed: false, isAncestorOfDev: false, parents: [], ...overrides,
  });

  const fakeSnapshot = async (repoPath) => snapshotImpl(repoPath);

  before(async () => {
    writeFileSync(branchHtmlPath, '<h1>board</h1>');
    const board = emptyBoard();
    addItem(board, 'tasks', { title: 'x' });
    await saveBoard(branchBoardPath, board);
    snapshotImpl = async (repoPath) => ({ repo: path.basename(repoPath), fetchedAt: '2026-11-04T00:00:00.000Z', branches: [repoABranch()], prs: [] });
    branchServer = createBoardServer({
      boardPath: branchBoardPath, htmlPath: branchHtmlPath, port: 0, repos: ['/fake/repo-a'], snapshot: fakeSnapshot,
    });
    await once(branchServer, 'listening');
    branchBase = `http://127.0.0.1:${branchServer.address().port}`;
  });

  after(() => branchServer.close());

  test('GET /branches.json reflects the initial automatic refresh', async () => {
    let body;
    for (let attempt = 0; attempt < 50 && !body?.repos.some((r) => r.fetchedAt); attempt += 1) {
      body = await (await fetch(`${branchBase}/branches.json`)).json();
      if (!body.repos.some((r) => r.fetchedAt)) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(body.repos, [{ repo: 'repo-a', fetchedAt: '2026-11-04T00:00:00.000Z' }]);
    assert.deepEqual(body.rows.map((row) => row.branch), ['feature-a']);
  });

  test('POST /branches/refresh returns 202, re-snapshots and broadcasts on /events', async () => {
    snapshotImpl = async (repoPath) => ({ repo: path.basename(repoPath), fetchedAt: '2026-11-04T01:00:00.000Z', branches: [repoABranch({ name: 'feature-b' })], prs: [] });

    const req = http.get(`${branchBase}/events`);
    const [eventsRes] = await once(req, 'response');
    eventsRes.setEncoding('utf8');
    const received = new Promise((resolve) => eventsRes.on('data', (chunk) => chunk.includes('data: branches\n\n') && resolve()));

    const refreshRes = await fetch(`${branchBase}/branches/refresh`, { method: 'POST' });
    assert.equal(refreshRes.status, 202);
    await received;
    req.destroy();

    const body = await (await fetch(`${branchBase}/branches.json`)).json();
    assert.deepEqual(body.repos, [{ repo: 'repo-a', fetchedAt: '2026-11-04T01:00:00.000Z' }]);
    assert.deepEqual(body.rows.map((row) => row.branch), ['feature-b']);
  });

  test('a failing snapshot keeps the last good data and records an error with a timestamp', async () => {
    snapshotImpl = async () => { throw new Error('gh: not authenticated'); };

    const req = http.get(`${branchBase}/events`);
    const [eventsRes] = await once(req, 'response');
    eventsRes.setEncoding('utf8');
    const received = new Promise((resolve) => eventsRes.on('data', (chunk) => chunk.includes('data: branches\n\n') && resolve()));
    await fetch(`${branchBase}/branches/refresh`, { method: 'POST' });
    await received;
    req.destroy();

    const body = await (await fetch(`${branchBase}/branches.json`)).json();
    assert.equal(body.repos.length, 1);
    assert.equal(body.repos[0].fetchedAt, '2026-11-04T01:00:00.000Z');
    assert.equal(body.repos[0].error.message, 'gh: not authenticated');
    assert.match(body.repos[0].error.at, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(body.rows.map((row) => row.branch), ['feature-b']);
  });
});
