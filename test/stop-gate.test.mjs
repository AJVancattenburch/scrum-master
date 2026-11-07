import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decide, MAX_BLOCKS, worktreeFrom } from '../lib/stop-gate.mjs';
import { commitFile, makeTempRepo } from './helpers/temp-repo.mjs';

const cli = fileURLToPath(new URL('../bin/stop-gate.mjs', import.meta.url));
const hook = (stateDir, payload) =>
  spawnSync(process.execPath, [cli], { input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, STOP_GATE_STATE: stateDir } });
const state = () => mkdtempSync(path.join(tmpdir(), 'stop-gate-'));

test('worktreeFrom reads the WORKTREE line anywhere in the report', () => {
  assert.equal(worktreeFrom('done\nWORKTREE: /a/b \n'), '/a/b');
  assert.equal(worktreeFrom('no line'), null);
  assert.equal(worktreeFrom(undefined), null);
});

test('decide blocks up to MAX_BLOCKS, then gives up', () => {
  assert.deepEqual(decide({ blocksSoFar: 0, problem: null }), { action: 'allow' });
  assert.equal(decide({ blocksSoFar: MAX_BLOCKS - 1, problem: 'x' }).action, 'block');
  assert.equal(decide({ blocksSoFar: MAX_BLOCKS, problem: 'x' }).action, 'give-up');
});

test('a clean worktree is allowed with no output', () => {
  const repo = makeTempRepo('monitiv-gateway');
  commitFile(repo, 'a.go', 'package a\n');
  const r = hook(state(), { agent_id: 'a1', last_assistant_message: `ok\nWORKTREE: ${repo}` });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
});

test('a missing WORKTREE line or a failing audit blocks twice per agent, then writes the failed marker', () => {
  const dir = state();
  const repo = makeTempRepo('monitiv-gateway');
  commitFile(repo, 'a.go', '// one\n// two\n// three\npackage a\n');
  const first = JSON.parse(hook(dir, { agent_id: 'a1', last_assistant_message: 'no line' }).stdout);
  assert.equal(first.decision, 'block');
  assert.match(first.reason, /WORKTREE: <absolute path>/);
  const second = JSON.parse(hook(dir, { agent_id: 'a1', last_assistant_message: `WORKTREE: ${repo}` }).stdout);
  assert.match(second.reason, /comment-block\ta\.go:1/);
  const third = hook(dir, { agent_id: 'a1', last_assistant_message: `WORKTREE: ${repo}` });
  assert.equal(third.stdout, '');
  assert.match(readFileSync(path.join(dir, 'a1.failed'), 'utf8'), /^GATE: FAILED/);
  assert.equal(JSON.parse(hook(dir, { agent_id: 'a2', last_assistant_message: 'no line' }).stdout).decision, 'block');
});

test('invalid input exits 1 with a message and never blocks silently', () => {
  const dir = state();
  const bad = hook(dir, 'not json');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /stop-gate: /);
  assert.equal(hook(dir, { last_assistant_message: 'x' }).status, 1);
  assert.ok(!existsSync(path.join(dir, 'undefined')));
});
