import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { text } from 'node:stream/consumers';
import { BoardError, STAGES, loadBoard, moveTask, saveBoard } from './board-store.mjs';

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch (err) {
    throw new BoardError(`invalid JSON: ${err.message}`);
  }
}

export function createBoardServer({ boardPath, htmlPath, port = 4317 }) {
  const clients = new Set();
  const watcher = watch(path.dirname(boardPath), (_event, file) => {
    if (file === path.basename(boardPath)) for (const res of clients) res.write('data: changed\n\n');
  });

  const routes = {
    'GET /': async (_req, res) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(await readFile(htmlPath)),
    'GET /board.json': (_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...loadBoard(boardPath), stages: STAGES })),
    'POST /move': async (req, res) => {
      const { id, index } = parseJson(await text(req));
      const board = loadBoard(boardPath);
      moveTask(board, id, index);
      await saveBoard(boardPath, board);
      res.writeHead(204).end();
    },
    'GET /events': (req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }).flushHeaders();
      clients.add(res);
      req.on('close', () => clients.delete(res));
    },
  };

  const server = http.createServer(async (req, res) => {
    const route = routes[`${req.method} ${req.url}`];
    if (!route) return res.writeHead(404).end('not found');
    try {
      await route(req, res);
    } catch (err) {
      const status = err instanceof BoardError ? 400 : 500;
      if (status === 500) console.error(err);
      res.writeHead(status, { 'content-type': 'text/plain' }).end(err.message);
    }
  });
  server.on('close', () => watcher.close());
  return server.listen(port, '127.0.0.1');
}
