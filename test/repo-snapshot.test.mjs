import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { snapshotRepo } from '../lib/repo-snapshot.mjs';

const execFileAsync = promisify(execFile);

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

// Builds a real repo with a bare "origin", a branch that conflicts with dev, and a
// second branch checked out in its own worktree with an uncommitted change.
function buildFixtureRepo() {
  const root = mkdtempSync(path.join(tmpdir(), 'repo-snapshot-'));
  const originPath = path.join(root, 'origin.git');
  const repoPath = path.join(root, 'repo');
  const worktreePath = path.join(root, 'dirty-worktree');

  execFileSync('git', ['init', '-q', '--bare', originPath]);
  execFileSync('git', ['init', '-q', '-b', 'dev', repoPath]);
  git(repoPath, ['config', 'user.email', 'test@example.com']);
  git(repoPath, ['config', 'user.name', 'Test']);
  git(repoPath, ['remote', 'add', 'origin', originPath]);

  writeFileSync(path.join(repoPath, 'shared.txt'), 'base\n');
  git(repoPath, ['add', 'shared.txt']);
  git(repoPath, ['commit', '-q', '-m', 'base']);
  git(repoPath, ['push', '-q', '-u', 'origin', 'dev']);

  git(repoPath, ['checkout', '-q', '-b', 'feature-conflict']);
  writeFileSync(path.join(repoPath, 'shared.txt'), 'feature change\n');
  git(repoPath, ['commit', '-q', '-am', 'feature change']);

  git(repoPath, ['checkout', '-q', 'dev']);
  writeFileSync(path.join(repoPath, 'shared.txt'), 'dev change\n');
  git(repoPath, ['commit', '-q', '-am', 'dev change']);
  git(repoPath, ['push', '-q', 'origin', 'dev']);

  git(repoPath, ['branch', 'dirty-branch', 'dev']);
  git(repoPath, ['worktree', 'add', '-q', worktreePath, 'dirty-branch']);
  appendFileSync(path.join(worktreePath, 'shared.txt'), 'uncommitted\n');

  return { repoPath };
}

function gitPassthroughRun(prs) {
  return async (cmd, args, options) => {
    if (cmd === 'gh') return JSON.stringify(prs);
    return (await execFileAsync(cmd, args, { ...options, maxBuffer: 16 * 1024 * 1024 })).stdout;
  };
}

test('snapshotRepo reports a real conflict, a dirty worktree, and excludes dev', async () => {
  const { repoPath } = buildFixtureRepo();
  const snapshot = await snapshotRepo(repoPath, { run: gitPassthroughRun([]) });

  assert.equal(snapshot.repo, path.basename(repoPath));
  assert.match(snapshot.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);

  const byName = Object.fromEntries(snapshot.branches.map((b) => [b.name, b]));
  assert.equal(byName.dev, undefined);
  assert.ok(byName['feature-conflict'].conflicts.length > 0, 'expected a real merge conflict');
  assert.equal(byName['dirty-branch'].dirty, true);
  assert.ok(byName['dirty-branch'].worktree.endsWith('dirty-worktree'));
  assert.equal(byName['feature-conflict'].dirty, false);
  assert.equal(byName['feature-conflict'].lastCommitDays, 0);
});

test('never passes a bare branch name as a git argument (argument injection)', async () => {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'gh') return '[]';
    if (args[0] === 'fetch') return '';
    if (args[0] === 'for-each-ref' && args[2] === 'refs/heads') return '-dangerous\n';
    if (args[0] === 'for-each-ref' && args[2] === 'refs/remotes/origin') return '';
    if (args[0] === 'for-each-ref' && args[1] === '--format=%(upstream)') return '';
    if (args[0] === 'worktree') return '';
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
      const err = new Error('not an ancestor');
      err.code = 1;
      throw err;
    }
    if (args[0] === 'merge-base') return `${'a'.repeat(40)}\n`;
    if (args[0] === 'rev-list') return '0\n';
    if (args[0] === 'show') return `${Math.floor(Date.now() / 1000)}\n`;
    if (args[0] === 'merge-tree') return `${'a'.repeat(40)}\n`;
    throw new Error(`unexpected command: ${cmd} ${args.join(' ')}`);
  };

  const snapshot = await snapshotRepo('/repo', { run });
  assert.ok(snapshot.branches.some((b) => b.name === '-dangerous'));
  for (const [cmd, ...args] of calls) {
    assert.ok(!args.includes('-dangerous'), `raw branch name passed as a bare argument to ${cmd} ${args.join(' ')}`);
  }
  assert.ok(calls.some(([, ...args]) => args.includes('refs/heads/-dangerous')), 'expected the name to be used only inside a full refname');
});

test('a PR head with no matching origin ref is dropped from candidates without failing the snapshot', async () => {
  const run = async (cmd, args) => {
    if (cmd === 'gh') return JSON.stringify([{ number: 9, headRefName: 'fork-feature', isDraft: false, url: 'https://x/9' }]);
    if (args[0] === 'fetch') return '';
    if (args[0] === 'for-each-ref' && args[2] === 'refs/heads') return '';
    if (args[0] === 'for-each-ref' && args[2] === 'refs/remotes/origin') return '';
    if (args[0] === 'worktree') return '';
    throw new Error(`unexpected command: ${cmd} ${args.join(' ')}`);
  };
  const snapshot = await snapshotRepo('/repo', { run });
  assert.deepEqual(snapshot.branches, []);
});

test('snapshotRepo throws with the failing command and stderr when gh fails', async () => {
  const run = async (cmd, args) => {
    if (cmd === 'git' && args[0] === 'fetch') return '';
    if (cmd === 'git' && args[0] === 'for-each-ref') return '';
    if (cmd === 'gh') {
      const err = new Error('command failed');
      err.stderr = 'gh: not authenticated';
      throw err;
    }
    throw new Error(`unexpected command: ${cmd} ${args.join(' ')}`);
  };
  await assert.rejects(() => snapshotRepo('/repo', { run }), /gh.*not authenticated/s);
});

test('snapshotRepo throws when gh pr list returns invalid JSON', async () => {
  const run = async (cmd, args) => {
    if (cmd === 'git' && args[0] === 'fetch') return '';
    if (cmd === 'git' && args[0] === 'for-each-ref') return '';
    if (cmd === 'gh') return 'not json';
    throw new Error(`unexpected command: ${cmd} ${args.join(' ')}`);
  };
  await assert.rejects(() => snapshotRepo('/repo', { run }), /invalid JSON/);
});
