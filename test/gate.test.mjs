import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
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

test('summarize never exceeds 15 lines', () => {
  const results = Array.from({ length: 12 }, (_, i) => ({ name: `s${i}`, ok: false, output: 'x', log: 'l' }));
  assert.equal(summarize(results).split('\n').length, 15);
});

test('runCommand reports exit status and spawn errors', () => {
  assert.equal(runCommand([process.execPath, '-e', 'process.exit(0)'], tmpdir()).ok, true);
  assert.equal(runCommand([process.execPath, '-e', 'process.exit(3)'], tmpdir()).ok, false);
  assert.match(runCommand(['definitely-not-a-binary-x'], tmpdir()).output, /ENOENT/);
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
