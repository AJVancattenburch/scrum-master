import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { isExcludedByName } from './branch-queue.mjs';

const execFileAsync = promisify(execFile);

async function defaultRun(cmd, args, { cwd } = {}) {
  const { stdout } = await execFileAsync(cmd, args, { cwd, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

class CommandError extends Error {
  constructor(cmd, args, cause) {
    super(`${cmd} ${args.join(' ')} failed: ${cause.stderr?.toString().trim() || cause.message}`);
    this.name = 'CommandError';
    this.code = cause.code;
  }
}

function parseWorktrees(porcelain) {
  const worktreeByBranch = new Map();
  for (const block of porcelain.split('\n\n')) {
    if (!block.trim()) continue;
    const lines = block.split('\n');
    const worktreeLine = lines.find((line) => line.startsWith('worktree '));
    const branchLine = lines.find((line) => line.startsWith('branch refs/heads/'));
    if (!worktreeLine || !branchLine) continue; // detached-HEAD worktrees are excluded per spec
    worktreeByBranch.set(branchLine.slice('branch refs/heads/'.length), worktreeLine.slice('worktree '.length));
  }
  return worktreeByBranch;
}

// `git merge-tree --write-tree --name-only` prints the resulting tree oid, and on
// conflict, the conflicted paths one per line, then a blank line before messages.
function parseConflictedPaths(stdout) {
  const lines = stdout.split('\n');
  const paths = [];
  for (let i = 1; i < lines.length && lines[i] !== ''; i += 1) paths.push(lines[i]);
  return paths;
}

function summarizeChecks(statusCheckRollup) {
  if (!Array.isArray(statusCheckRollup) || statusCheckRollup.length === 0) return undefined;
  const conclusions = statusCheckRollup.map((check) => check.conclusion ?? check.state);
  if (conclusions.some((conclusion) => conclusion === 'FAILURE' || conclusion === 'ERROR')) return 'FAILURE';
  if (conclusions.every((conclusion) => conclusion === 'SUCCESS')) return 'SUCCESS';
  return 'PENDING';
}

export async function snapshotRepo(repoPath, { run = defaultRun } = {}) {
  const git = async (args) => {
    try {
      return await run('git', args, { cwd: repoPath });
    } catch (err) {
      throw new CommandError('git', args, err);
    }
  };

  await git(['fetch', '--prune', 'origin']);

  const localNames = (await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads']))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let prs;
  const prsRaw = await (async () => {
    try {
      return await run('gh', ['pr', 'list', '--base', 'dev', '--state', 'open', '--json', 'number,headRefName,isDraft,reviewDecision,statusCheckRollup,mergeable,url'], { cwd: repoPath });
    } catch (err) {
      throw new CommandError('gh', ['pr', 'list'], err);
    }
  })();
  try {
    prs = JSON.parse(prsRaw);
  } catch (err) {
    throw new Error(`gh pr list returned invalid JSON: ${err.message}`);
  }
  const prByBranch = new Map(prs.map((pr) => [pr.headRefName, pr]));

  const worktreeByBranch = parseWorktrees(await git(['worktree', 'list', '--porcelain']));

  const candidateNames = [...new Set([...localNames, ...prByBranch.keys()])].filter((name) => !isExcludedByName(name));

  async function isAncestorOfDev(ref) {
    try {
      await git(['merge-base', '--is-ancestor', ref, 'origin/dev']);
      return true;
    } catch (err) {
      if (err.code === 1) return false;
      throw err;
    }
  }

  const branches = [];
  for (const name of candidateNames) {
    const isLocal = localNames.includes(name);
    const ref = isLocal ? name : `origin/${name}`;
    const ancestor = await isAncestorOfDev(ref);

    const mergeBase = (await git(['merge-base', 'origin/dev', ref])).trim();
    const behind = Number((await git(['rev-list', '--count', `${mergeBase}..origin/dev`])).trim());
    const mergeBaseCommittedAt = Number((await git(['show', '-s', '--format=%ct', mergeBase])).trim());
    const ageDays = Math.floor((Date.now() / 1000 - mergeBaseCommittedAt) / 86400);

    const conflicts = await (async () => {
      try {
        await run('git', ['merge-tree', '--write-tree', '--name-only', 'origin/dev', ref], { cwd: repoPath });
        return [];
      } catch (err) {
        if (err.code !== 1) throw new CommandError('git', ['merge-tree'], err);
        return parseConflictedPaths(err.stdout ?? '');
      }
    })();

    const worktree = worktreeByBranch.get(name) ?? null;
    const dirty = worktree ? (await git(['-C', worktree, 'status', '--porcelain'])).trim().length > 0 : false;

    let unpushed = false;
    if (isLocal) {
      try {
        const upstreamBehind = await git(['rev-list', '--count', `${name}@{upstream}..${name}`]);
        unpushed = Number(upstreamBehind.trim()) > 0;
      } catch (err) {
        if (err.code !== 128) throw err;
        unpushed = true; // no upstream configured
      }
    }

    const parents = [];
    for (const otherName of candidateNames) {
      if (otherName === name) continue;
      const otherRef = localNames.includes(otherName) ? otherName : `origin/${otherName}`;
      try {
        await git(['merge-base', '--is-ancestor', otherRef, ref]);
        parents.push(otherName);
      } catch (err) {
        if (err.code !== 1) throw err;
      }
    }

    branches.push({
      name,
      pr: prByBranch.get(name)
        ? { ...prByBranch.get(name), statusCheckRollup: summarizeChecks(prByBranch.get(name).statusCheckRollup) }
        : undefined,
      behind,
      ageDays,
      conflicts,
      worktree,
      dirty,
      unpushed,
      isAncestorOfDev: ancestor,
      parents,
    });
  }

  return { repo: path.basename(repoPath), fetchedAt: new Date().toISOString(), branches, prs };
}
