import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decide, MAX_BLOCKS, worktreeFrom } from '../lib/stop-gate.mjs';
import { commitFile, makeTempRepo } from './helpers/temp-repo.mjs';

const cli = fileURLToPath(new URL('../bin/stop-gate.mjs', import.meta.url));
const hook = (stateDir, payload) =>
  spawnSync(process.execPath, [cli], { input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, STOP_GATE_STATE: stateDir } });
const state = (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'stop-gate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

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

test('a clean worktree is allowed with no output', (t) => {
  const repo = makeTempRepo('monitiv-gateway', t);
  commitFile(repo, 'a.go', 'package a\n');
  const r = hook(state(t), { agent_id: 'a1', last_assistant_message: `ok\nWORKTREE: ${repo}` });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
});

test('a missing WORKTREE line or a failing audit blocks twice per agent, then writes the failed marker', (t) => {
  const dir = state(t);
  const repo = makeTempRepo('monitiv-gateway', t);
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

test('a passing audit clears the agent\'s block count and failed marker', (t) => {
  const dir = state(t);
  const clean = makeTempRepo('monitiv-gateway', t);
  for (let i = 0; i <= MAX_BLOCKS; i += 1) hook(dir, { agent_id: 'a1', last_assistant_message: 'no line' });
  assert.ok(existsSync(path.join(dir, 'a1.failed')));
  assert.equal(hook(dir, { agent_id: 'a1', last_assistant_message: `WORKTREE: ${clean}` }).stdout, '');
  assert.ok(!existsSync(path.join(dir, 'a1.failed')));
  assert.ok(!existsSync(path.join(dir, 'a1.json')));
});

test('uncommitted work blocks, because the audit only sees commits', (t) => {
  const repo = makeTempRepo('monitiv-gateway', t);
  writeFileSync(path.join(repo, 'a.go'), 'package a\n');
  const r = JSON.parse(hook(state(t), { agent_id: 'a1', last_assistant_message: `WORKTREE: ${repo}` }).stdout);
  assert.equal(r.decision, 'block');
  assert.match(r.reason, /Commit the task's changes and delete any scratch files/);
});

test('invalid input exits 1 with a message and a failed marker, never a silent pass', (t) => {
  const dir = state(t);
  const bad = hook(dir, 'not json');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /stop-gate: /);
  const [marker] = readdirSync(dir).filter((f) => /^hook-error-\d+\.failed$/.test(f));
  assert.match(readFileSync(path.join(dir, marker), 'utf8'), /^GATE: FAILED\nstop-gate: /);
  assert.equal(hook(dir, { last_assistant_message: 'x' }).status, 1);
  assert.ok(!existsSync(path.join(dir, 'undefined')));
});

test('when the failure marker itself cannot be written, the original hook error still reaches stderr', (t) => {
  const dir = state(t);
  const blockedState = path.join(dir, 'not-a-dir');
  writeFileSync(blockedState, '');
  const { status, stderr } = hook(blockedState, 'not json');
  assert.equal(status, 1);
  assert.match(stderr, /stop-gate: /);
  assert.match(stderr, /stop-gate: could not write marker: /);
});
