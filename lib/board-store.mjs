import { rename, writeFile } from 'node:fs/promises';
import { readJson } from './read-json.mjs';

export const STAGES = ['capture', 'contract', 'build', 'verify', 'data-needs', 'backend', 'done'];

export class BoardError extends Error {}

const SPECS = {
  tasks: {
    prefix: 'T',
    label: 'title',
    required: ['title'],
    defaults: { stage: 'capture', repo: 'frontend', ticket: '' },
    enums: { stage: STAGES, repo: ['frontend', 'gateway', 'both', 'scrum-master'] },
  },
  dataNeeds: {
    prefix: 'D',
    label: 'field',
    required: ['task', 'field'],
    defaults: { shape: '', likelySource: '', status: 'open' },
    enums: { status: ['open', 'resolved'] },
  },
  blockers: {
    prefix: 'B',
    label: 'question',
    required: ['question'],
    defaults: { task: '', askWho: '', answer: '', status: 'open' },
    enums: { status: ['open', 'answered'] },
  },
};

export const emptyBoard = () => ({ tasks: [], dataNeeds: [], blockers: [] });

function specFor(list) {
  if (!Object.hasOwn(SPECS, list)) throw new BoardError(`unknown list "${list}" (expected ${Object.keys(SPECS).join('|')})`);
  return SPECS[list];
}

function merged(spec, base, fields) {
  for (const key of Object.keys(fields)) {
    if (!spec.required.includes(key) && !Object.hasOwn(spec.defaults, key)) throw new BoardError(`unknown key "${key}"`);
  }
  const item = { ...base, ...fields };
  for (const key of spec.required) if (!item[key]) throw new BoardError(`"${key}" is required`);
  for (const [key, allowed] of Object.entries(spec.enums)) {
    if (!allowed.includes(item[key])) throw new BoardError(`${key} must be one of ${allowed.join('|')}`);
  }
  return item;
}

function locate(board, id) {
  const list = Object.keys(SPECS).find((name) => id?.startsWith(SPECS[name].prefix));
  const index = list ? board[list].findIndex((item) => item.id === id) : -1;
  if (index < 0) throw new BoardError(`unknown id "${id}"`);
  return { list, index };
}

export function addItem(board, list, fields) {
  const spec = specFor(list);
  const next = board[list].reduce((max, { id }) => Math.max(max, Number(id.slice(1))), 0) + 1;
  const item = { id: `${spec.prefix}${next}`, ...merged(spec, spec.defaults, fields) };
  board[list].push(item);
  return item;
}

export function updateItem(board, id, fields) {
  const { list, index } = locate(board, id);
  return Object.assign(board[list][index], merged(SPECS[list], board[list][index], fields));
}

export function moveTask(board, id, index) {
  if (!Number.isInteger(index)) throw new BoardError(`index must be an integer, got "${index}"`);
  const from = locate(board, id);
  if (from.list !== 'tasks') throw new BoardError(`only tasks can be moved, got "${id}"`);
  const [task] = board.tasks.splice(from.index, 1);
  board.tasks.splice(Math.min(Math.max(index, 0), board.tasks.length), 0, task);
}

const isOpen = (item) => (item.status ? item.status === 'open' : item.stage !== 'done');

export function listLines(board, list, open = false) {
  const lists = list === undefined ? Object.keys(SPECS) : [list];
  return lists.flatMap((name) => {
    const { label } = specFor(name);
    return board[name]
      .filter((item) => !open || isOpen(item))
      .map((item) => `${item.id} [${item.stage ?? item.status}] ${item[label]}`);
  });
}

export const loadBoard = (path) => ({ ...emptyBoard(), ...readJson(path, {}) });

export async function saveBoard(path, board) {
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(board, null, 2)}\n`);
  await rename(tmp, path);
}
