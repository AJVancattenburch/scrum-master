import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeTempRepo } from './helpers/temp-repo.mjs';

const BIN = fileURLToPath(new URL('../bin/gate.mjs', import.meta.url));

function runCli(args) {
  try {
    return { stdout: execFileSync(process.execPath, [BIN, ...args], { encoding: 'utf8' }), code: 0 };
  } catch (err) {
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.status };
  }
}

test('CLI exits 2 and prints usage with no worktree argument', () => {
  const { code, stderr } = runCli([]);
  assert.equal(code, 2);
  assert.match(stderr, /usage: gate\.mjs/);
});

// gateSteps rejects the pixel args before any gate runs, so this never shells out to a real lint/test command.
test('CLI exits 2 with the no-pixel-diff message when --feature is given for a profile without pixel diff', (t) => {
  const repo = makeTempRepo('monitiv-gateway', t);
  const { code, stderr } = runCli([repo, '--feature', 'a', '--url', 'http://x']);
  assert.equal(code, 2);
  assert.match(stderr, /monitiv-gateway has no pixel diff; drop --feature\/--url/);
});
