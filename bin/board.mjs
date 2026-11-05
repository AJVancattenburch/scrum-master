#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBoardServer } from '../lib/board-server.mjs';
import { BoardError, addItem, listLines, loadBoard, moveTask, saveBoard, updateItem } from '../lib/board-store.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const boardPath = process.env.BOARD_PATH ?? path.join(root, 'board.json');
const USAGE = 'usage: board.mjs add <list> k=v… | set <id> k=v… | move <id> <index> | list [list] [--open] | serve [--port N]';

function parsePairs(pairs) {
  return Object.fromEntries(pairs.map((pair) => {
    const at = pair.indexOf('=');
    if (at < 1) throw new BoardError(`expected key=value, got "${pair}"`);
    return [pair.slice(0, at), pair.slice(at + 1)];
  }));
}

async function mutate(change) {
  const board = loadBoard(boardPath);
  const result = change(board);
  await saveBoard(boardPath, board);
  return result;
}

const commands = {
  add: async (list, ...pairs) => console.log((await mutate((board) => addItem(board, list, parsePairs(pairs)))).id),
  set: (id, ...pairs) => mutate((board) => updateItem(board, id, parsePairs(pairs))),
  move: (id, index) => mutate((board) => moveTask(board, id, Number(index))),
  list: (...args) => {
    const [list] = args.filter((arg) => arg !== '--open');
    for (const line of listLines(loadBoard(boardPath), list, args.includes('--open'))) console.log(line);
  },
  serve: (flag, port = '4317') => {
    if (flag !== undefined && flag !== '--port') throw new BoardError(USAGE);
    const repos = process.env.BOARD_REPOS
      ? process.env.BOARD_REPOS.split(',').map((repoPath) => path.resolve(repoPath.trim()))
      : ['../monitiv-frontend', '../monitiv-gateway'].map((rel) => path.resolve(root, rel));
    const server = createBoardServer({ boardPath, htmlPath: path.join(root, 'board', 'index.html'), port: Number(port), repos });
    server.on('listening', () => console.log(`http://localhost:${server.address().port}`));
  },
};

const [command, ...args] = process.argv.slice(2);
if (!Object.hasOwn(commands, command)) {
  console.error(USAGE);
  process.exit(1);
}
try {
  await commands[command](...args);
} catch (err) {
  if (!(err instanceof BoardError)) throw err;
  console.error(err.message);
  process.exit(1);
}
