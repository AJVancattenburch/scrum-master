import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { text } from 'node:stream/consumers';
import { rankBranches } from './branch-queue.mjs';
import { BoardError, STAGES, loadBoard, moveTask, saveBoard } from './board-store.mjs';
import { snapshotRepo } from './repo-snapshot.mjs';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch (err) {
    throw new BoardError(`invalid JSON: ${err.message}`);
  }
}

// Tracks the last good snapshot per repo path so a failing repo (gh auth, network)
// keeps showing its last known branches instead of dropping off the board.
function createBranchRegistry(repos, snapshot, boardPath, broadcast) {
  const lastGood = new Map();
  const lastError = new Map();

  async function refresh() {
    await Promise.all(repos.map(async (repoPath) => {
      try {
        lastGood.set(repoPath, await snapshot(repoPath, {}));
        lastError.delete(repoPath);
      } catch (err) {
        console.error(err);
        lastError.set(repoPath, { message: err.message, at: new Date().toISOString() });
      }
    }));
    broadcast('branches');
  }

  function read() {
    const rows = rankBranches([...lastGood.values()], loadBoard(boardPath));
    const repoStatuses = repos.map((repoPath) => {
      const good = lastGood.get(repoPath);
      const error = lastError.get(repoPath);
      return { repo: good?.repo ?? path.basename(repoPath), fetchedAt: good?.fetchedAt ?? null, ...(error ? { error } : {}) };
    });
    return { rows, repos: repoStatuses };
  }

  return { refresh, read };
}

export function createBoardServer({ boardPath, htmlPath, port = 4317, repos = [], snapshot = snapshotRepo }) {
  const clients = new Set();
  const watcher = watch(path.dirname(boardPath), (_event, file) => {
    if (file === path.basename(boardPath)) for (const res of clients) res.write('data: changed\n\n');
  });
  const broadcast = (message) => { for (const res of clients) res.write(`data: ${message}\n\n`); };

  const branches = repos.length > 0 ? createBranchRegistry(repos, snapshot, boardPath, broadcast) : null;

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
    ...(branches && {
      'GET /branches.json': (_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(branches.read())),
      'POST /branches/refresh': (_req, res) => {
        res.writeHead(202).end();
        branches.refresh().catch((err) => console.error(err));
      },
    }),
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

  let timer;
  if (branches) {
    timer = setInterval(() => branches.refresh().catch((err) => console.error(err)), REFRESH_INTERVAL_MS);
    timer.unref();
    branches.refresh().catch((err) => console.error(err));
  }

  server.on('close', () => {
    watcher.close();
    if (timer) clearInterval(timer);
  });
  return server.listen(port, '127.0.0.1');
}
