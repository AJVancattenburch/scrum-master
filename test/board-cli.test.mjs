import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/board.mjs', import.meta.url));
const boardPath = path.join(mkdtempSync(path.join(tmpdir(), 'board-')), 'board.json');
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, BOARD_PATH: boardPath } });
const ok = (...args) => {
  const r = run(...args);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

test('add, set, move and list round-trip through the board file', () => {
  assert.equal(ok('add', 'tasks', 'title=Alerts page', 'repo=both'), 'T1');
  assert.equal(ok('add', 'tasks', 'title=a=b'), 'T2');
  assert.equal(ok('add', 'dataNeeds', 'task=T1', 'field=alert.severity', 'shape=enum', 'likelySource=gateway'), 'D1');
  assert.equal(ok('add', 'blockers', 'task=T1', 'question=Paging size?', 'askWho=PM'), 'B1');
  ok('set', 'T1', 'stage=done');
  ok('move', 'T2', '0');
  assert.equal(ok('list', 'tasks'), 'T2 [capture] a=b\nT1 [done] Alerts page');
  assert.equal(ok('list', '--open'), 'T2 [capture] a=b\nD1 [open] alert.severity\nB1 [open] Paging size?');
  assert.equal(JSON.parse(readFileSync(boardPath, 'utf8')).tasks[1].repo, 'both');
});

test('BoardError and unknown commands exit 1 with a message', () => {
  for (const args of [['add', 'tasks', 'stage=nope'], ['set', 'T1', 'noequals'], ['move', 'T9', '0'], ['list', 'nope']]) {
    const r = run(...args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, /\S/);
    assert.doesNotMatch(r.stderr, /at .*board/);
  }
  const r = run('frobnicate');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage/);
});
