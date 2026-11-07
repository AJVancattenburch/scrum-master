import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { commitFile, makeTempRepo } from './helpers/temp-repo.mjs';

const BIN = fileURLToPath(new URL('../bin/diff-audit.mjs', import.meta.url));

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
  assert.match(stderr, /usage: diff-audit\.mjs/);
});

test('CLI exits 2 for a repo with no matching profile', (t) => {
  const { code, stderr } = runCli([makeTempRepo('some-other-repo', t)]);
  assert.equal(code, 2);
  assert.match(stderr, /no profile for repo/);
});

test('CLI exits 0 and prints PASS when there are no blocking findings', (t) => {
  const { code, stdout } = runCli([makeTempRepo('monitiv-frontend', t)]);
  assert.equal(code, 0);
  assert.match(stdout, /^PASS/);
});

test('CLI exits 1 and prints FAIL when a finding blocks', (t) => {
  const repo = makeTempRepo('monitiv-frontend', t);
  commitFile(repo, 'a.ts', '// one\n// two\n// three\nexport const x = 1;\n');
  const { code, stdout } = runCli([repo]);
  assert.equal(code, 1);
  assert.match(stdout, /FAIL: 1 blocking finding/);
});

test('CLI accepts an explicit base-ref argument', (t) => {
  const repo = makeTempRepo('monitiv-frontend', t);
  commitFile(repo, 'a.ts', '// one\n// two\n// three\nexport const x = 1;\n');
  const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const { code, stdout } = runCli([repo, head]);
  assert.equal(code, 0);
  assert.match(stdout, /^PASS/);
});
