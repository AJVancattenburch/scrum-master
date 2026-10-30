import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  STAGES, BoardError, emptyBoard, addItem, updateItem, moveTask, listLines, loadBoard, saveBoard,
} from '../lib/board-store.mjs';

const seeded = () => {
  const board = emptyBoard();
  for (const title of ['a', 'b', 'c']) addItem(board, 'tasks', { title });
  return board;
};

test('STAGES lists the lifecycle in order', () => {
  assert.deepEqual(STAGES, ['capture', 'contract', 'build', 'verify', 'data-needs', 'backend', 'done']);
});

test('addItem applies prefixes, sequential ids and defaults', () => {
  const board = emptyBoard();
  assert.deepEqual(addItem(board, 'tasks', { title: 'x' }), { id: 'T1', stage: 'capture', repo: 'frontend', ticket: '', title: 'x' });
  assert.equal(addItem(board, 'tasks', { title: 'y', repo: 'both', stage: 'build' }).id, 'T2');
  assert.deepEqual(addItem(board, 'dataNeeds', { task: 'T1', field: 'f' }), { id: 'D1', shape: '', likelySource: '', status: 'open', task: 'T1', field: 'f' });
  assert.deepEqual(addItem(board, 'blockers', { question: 'q?' }), { id: 'B1', task: '', askWho: '', answer: '', status: 'open', question: 'q?' });
  assert.equal(board.tasks.length, 2);
});

test('addItem rejects unknown list, unknown key, bad enum and missing required', () => {
  const board = emptyBoard();
  for (const [list, fields] of [
    ['nope', { title: 'x' }],
    ['tasks', { title: 'x', order: '1' }],
    ['tasks', { title: 'x', id: 'T9' }],
    ['tasks', { title: 'x', stage: 'shipping' }],
    ['tasks', { title: 'x', repo: 'mobile' }],
    ['tasks', {}],
    ['tasks', { title: '' }],
    ['dataNeeds', { task: 'T1' }],
    ['dataNeeds', { task: 'T1', field: 'f', status: 'answered' }],
    ['blockers', { question: 'q', status: 'resolved' }],
  ]) assert.throws(() => addItem(board, list, fields), BoardError, `${list} ${JSON.stringify(fields)}`);
  assert.deepEqual(board, emptyBoard());
});

test('updateItem validates like addItem and finds items by id', () => {
  const board = seeded();
  addItem(board, 'blockers', { question: 'q' });
  assert.equal(updateItem(board, 'T2', { stage: 'verify' }).stage, 'verify');
  assert.equal(updateItem(board, 'B1', { answer: 'yes', status: 'answered' }).status, 'answered');
  assert.throws(() => updateItem(board, 'T2', { stage: 'nope' }), BoardError);
  assert.throws(() => updateItem(board, 'T2', { colour: 'red' }), BoardError);
  assert.throws(() => updateItem(board, 'T2', { title: '' }), BoardError);
  assert.throws(() => updateItem(board, 'T9', { stage: 'build' }), BoardError);
  assert.throws(() => updateItem(board, 'X1', {}), BoardError);
  assert.equal(board.tasks[1].stage, 'verify');
});

test('moveTask splices to a clamped index', () => {
  const board = seeded();
  const ids = () => board.tasks.map((t) => t.id).join();
  moveTask(board, 'T3', 0);
  assert.equal(ids(), 'T3,T1,T2');
  moveTask(board, 'T3', 99);
  assert.equal(ids(), 'T1,T2,T3');
  moveTask(board, 'T2', -5);
  assert.equal(ids(), 'T2,T1,T3');
  assert.throws(() => moveTask(board, 'T9', 0), BoardError);
  assert.throws(() => moveTask(board, 'T1', NaN), BoardError);
  addItem(board, 'blockers', { question: 'q' });
  assert.throws(() => moveTask(board, 'B1', 0), /only tasks/);
});

test('listLines formats items and filters open ones', () => {
  const board = seeded();
  updateItem(board, 'T2', { stage: 'done' });
  addItem(board, 'dataNeeds', { task: 'T1', field: 'f', status: 'resolved' });
  addItem(board, 'blockers', { question: 'q?' });
  assert.deepEqual(listLines(board, 'tasks'), ['T1 [capture] a', 'T2 [done] b', 'T3 [capture] c']);
  assert.deepEqual(listLines(board, undefined, true), ['T1 [capture] a', 'T3 [capture] c', 'B1 [open] q?']);
  assert.deepEqual(listLines(board, 'dataNeeds'), ['D1 [resolved] f']);
  assert.throws(() => listLines(board, 'nope'), BoardError);
});

test('loadBoard returns an empty board when missing and propagates other errors', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'board-'));
  assert.deepEqual(loadBoard(path.join(dir, 'board.json')), emptyBoard());
  const bad = path.join(dir, 'bad.json');
  writeFileSync(bad, '{');
  assert.throws(() => loadBoard(bad), SyntaxError);
  assert.throws(() => loadBoard(dir), { code: 'EISDIR' });
});

test('saveBoard writes atomically and round-trips', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'board-'));
  const file = path.join(dir, 'board.json');
  const board = seeded();
  await saveBoard(file, board);
  assert.deepEqual(loadBoard(file), board);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), board);
  assert.deepEqual(readdirSync(dir), ['board.json']);
});
