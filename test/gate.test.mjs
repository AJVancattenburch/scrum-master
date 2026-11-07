import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { gateSteps, parseGateArgs, runCommand, runGate, summarize } from '../lib/gate.mjs';
import { loadProfiles } from '../lib/repo-profile.mjs';

const logDir = () => mkdtempSync(path.join(tmpdir(), 'gate-'));
const step = (name, ok, output = '') => ({ name, run: () => ({ ok, output }) });

test('parseGateArgs reads repeated --feature/--url pairs and rejects partial ones', () => {
  assert.deepEqual(parseGateArgs(['/w', '--feature', 'a', '--url', 'http://x']).pixel, [{ feature: 'a', url: 'http://x' }]);
  assert.throws(() => parseGateArgs([]), /usage/);
  assert.throws(() => parseGateArgs(['/w', '--feature', 'a']), /usage/);
});

test('runGate runs every step after a failure, writes logs and fails overall', () => {
  const dir = logDir();
  const thrower = { name: 'boom', run: () => { throw new Error('git missing'); } };
  const { ok, summary } = runGate([step('a', false, 'first error\nmore'), step('b', true, 'fine'), thrower], dir);
  assert.equal(ok, false);
  assert.match(summary, /^FAIL a\nPASS b\nFAIL boom\n {2}a: first error \(log: /);
  assert.match(summary, /boom: git missing/);
  assert.equal(readFileSync(path.join(dir, 'b.log'), 'utf8'), 'fine');
});

test('runGate passes only when every step passes', () => {
  assert.equal(runGate([step('a', true), step('b', true)], logDir()).ok, true);
});

test('a thrown step error logs the full stack but the summary keeps only the message', () => {
  const dir = logDir();
  const thrower = { name: 'boom', run: () => { throw new Error('git missing'); } };
  const { summary } = runGate([thrower], dir);
  assert.match(summary, /boom: git missing/);
  assert.match(readFileSync(path.join(dir, 'boom.log'), 'utf8'), /^Error: git missing\n {4}at /);
});

test('runGate clears stale logs from a previous run before writing new ones', () => {
  const dir = logDir();
  writeFileSync(path.join(dir, 'stale.log'), 'old');
  runGate([step('a', true, 'fresh')], dir);
  assert.equal(existsSync(path.join(dir, 'stale.log')), false);
  assert.equal(readFileSync(path.join(dir, 'a.log'), 'utf8'), 'fresh');
});

test('runGate does not swallow a log-directory infrastructure failure', (t) => {
  const blockerFile = path.join(tmpdir(), `gate-blocker-${process.pid}`);
  writeFileSync(blockerFile, 'x');
  t.after(() => rmSync(blockerFile, { force: true }));
  assert.throws(() => runGate([step('a', true)], path.join(blockerFile, 'gate')), /ENOTDIR/);
});

test('summarize keeps the earliest lines and notes what was dropped, never exceeding 15 lines', () => {
  const results = Array.from({ length: 12 }, (_, i) => ({ name: `s${i}`, ok: false, output: 'x', log: `l${i}` }));
  const summary = summarize(results, '/tmp/gate-logdir');
  const lines = summary.split('\n');
  assert.equal(lines.length, 15);
  assert.equal(lines[0], 'FAIL s0');
  assert.equal(lines.at(-1), '… +10 more; logs: /tmp/gate-logdir');
});

test('summarize prefers the first non-empty stderr line over a stdout banner', () => {
  const dir = logDir();
  const result = runCommand(
    [process.execPath, '-e', "process.stdout.write('banner noise\\n'); process.stderr.write('boom: real cause\\n'); process.exit(1);"],
    tmpdir(),
  );
  const { summary } = runGate([{ name: 'check', run: () => result }], dir);
  assert.match(summary, /check: boom: real cause/);
});

test('runCommand reports exit status and spawn errors', () => {
  assert.equal(runCommand([process.execPath, '-e', 'process.exit(0)'], tmpdir()).ok, true);
  assert.equal(runCommand([process.execPath, '-e', 'process.exit(3)'], tmpdir()).ok, false);
  assert.match(runCommand(['definitely-not-a-binary-x'], tmpdir()).output, /ENOENT/);
});

test('runCommand fails a step that exceeds its timeout', () => {
  const { ok, output } = runCommand([process.execPath, '-e', 'setTimeout(() => {}, 5000)'], tmpdir(), 50);
  assert.equal(ok, false);
  assert.match(output, /timed out after/);
});

test('gateSteps follows the profile and rejects pixel diffs where the repo has none', () => {
  const profiles = loadProfiles();
  const gw = { name: 'monitiv-gateway', ...profiles['monitiv-gateway'] };
  const fe = { name: 'monitiv-frontend', ...profiles['monitiv-frontend'] };
  const names = gateSteps({ worktree: '/w', profile: gw, pixel: [], pixelScript: 'p' }).map((s) => s.name);
  assert.deepEqual(names, ['diff-audit', ...gw.gates.map((g) => g.name)]);
  assert.throws(() => gateSteps({ worktree: '/w', profile: gw, pixel: [{ feature: 'a', url: 'u' }], pixelScript: 'p' }), /no pixel diff/);
  assert.equal(gateSteps({ worktree: '/w', profile: fe, pixel: [{ feature: 'a', url: 'u' }], pixelScript: 'p' }).at(-1).name, 'pixel:a');
});
