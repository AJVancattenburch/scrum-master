import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { isExcludedByName } from './branch-queue.mjs';

const execFileAsync = promisify(execFile);
const DEV_REF = 'refs/remotes/origin/dev';

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

// Branch names come from git refs and gh PR data, both effectively attacker-controlled
// (a contributor can name a branch "-x"). Every name is turned into a full refname
// before it ever reaches a git argument, so it can never be parsed as an option.
const localRef = (name) => `refs/heads/${name}`;
const remoteRef = (name) => `refs/remotes/origin/${name}`;
const daysSince = (epochSeconds) => Math.floor((Date.now() / 1000 - epochSeconds) / 86400);

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

async function git(run, repoPath, args) {
  try {
    return await run('git', args, { cwd: repoPath });
  } catch (err) {
    throw new CommandError('git', args, err);
  }
}

async function isAncestor(run, repoPath, ancestorRef, ref) {
  try {
    await git(run, repoPath, ['merge-base', '--is-ancestor', ancestorRef, ref]);
    return true;
  } catch (err) {
    if (err.code === 1) return false;
    throw err;
  }
}

async function mergeConflicts(run, repoPath, devRef, ref) {
  try {
    await run('git', ['merge-tree', '--write-tree', '--name-only', devRef, ref], { cwd: repoPath });
    return [];
  } catch (err) {
    if (err.code !== 1) throw new CommandError('git', ['merge-tree', '--write-tree', '--name-only', devRef, ref], err);
    return parseConflictedPaths(err.stdout ?? '');
  }
}

// `%(upstream)` resolves straight to a full refname (or empty) without the `@{upstream}`
// operator, which only accepts a short branch name and rejects a `refs/heads/...` path.
async function isUnpushed(run, repoPath, name, ref) {
  const upstream = (await git(run, repoPath, ['for-each-ref', '--format=%(upstream)', localRef(name)])).trim();
  if (!upstream) return true;
  const ahead = Number((await git(run, repoPath, ['rev-list', '--count', `${upstream}..${ref}`])).trim());
  return ahead > 0;
}

async function listOpenPrs(run, repoPath) {
  let stdout;
  try {
    stdout = await run('gh', ['pr', 'list', '--base', 'dev', '--state', 'open', '--json', 'number,headRefName,isDraft,reviewDecision,statusCheckRollup,url'], { cwd: repoPath });
  } catch (err) {
    throw new CommandError('gh', ['pr', 'list'], err);
  }
  try {
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`gh pr list returned invalid JSON: ${err.message}`);
  }
}

// Candidates are local branches plus PR heads that already exist as an `origin/*`
// remote-tracking ref. A fork PR's head never gets that ref, so it can't be
// merge-based or diffed against dev; it just won't become a row.
async function listCandidates(run, repoPath, prs) {
  const localNames = (await git(run, repoPath, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']))
    .split('\n').map((line) => line.trim()).filter(Boolean);

  const remoteNames = new Set(
    (await git(run, repoPath, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin']))
      .split('\n').map((line) => line.trim()).filter(Boolean)
      .filter((short) => short.startsWith('origin/') && short !== 'origin/HEAD')
      .map((short) => short.slice('origin/'.length)),
  );

  const prNames = prs.map((pr) => pr.headRefName).filter((name) => remoteNames.has(name));
  const names = [...new Set([...localNames, ...prNames])].filter((name) => !isExcludedByName(name));
  const localNameSet = new Set(localNames);

  return names.map((name) => ({
    name,
    isLocal: localNameSet.has(name),
    ref: localNameSet.has(name) ? localRef(name) : remoteRef(name),
  }));
}

async function branchFacts(run, repoPath, candidate, ctx) {
  const { name, ref, isLocal } = candidate;
  const g = (args) => git(run, repoPath, args);

  const isAncestorOfDev = await isAncestor(run, repoPath, ref, ctx.devRef);
  const mergeBase = (await g(['merge-base', ctx.devRef, ref])).trim();
  const behind = Number((await g(['rev-list', '--count', `${mergeBase}..${ctx.devRef}`])).trim());
  const ageDays = daysSince(Number((await g(['show', '-s', '--format=%ct', mergeBase])).trim()));
  const lastCommitDays = daysSince(Number((await g(['show', '-s', '--format=%ct', ref])).trim()));

  const conflicts = await mergeConflicts(run, repoPath, ctx.devRef, ref);

  const worktree = ctx.worktreeByBranch.get(name) ?? null;
  const dirty = worktree ? (await g(['-C', worktree, 'status', '--porcelain'])).trim().length > 0 : false;

  const unpushed = isLocal ? await isUnpushed(run, repoPath, name, ref) : false;

  const parents = [];
  for (const other of ctx.candidates) {
    if (other.name === name) continue;
    if (await isAncestor(run, repoPath, other.ref, ref)) parents.push(other.name);
  }

  return {
    name, pr: ctx.prByName.get(name), behind, ageDays, lastCommitDays, conflicts, worktree, dirty, unpushed, isAncestorOfDev, parents,
  };
}

export async function snapshotRepo(repoPath, { run = defaultRun } = {}) {
  await git(run, repoPath, ['fetch', '--prune', 'origin']);

  const prs = await listOpenPrs(run, repoPath);
  const candidates = await listCandidates(run, repoPath, prs);
  const prByName = new Map(prs.map((pr) => [pr.headRefName, { ...pr, statusCheckRollup: summarizeChecks(pr.statusCheckRollup) }]));
  const worktreeByBranch = parseWorktrees(await git(run, repoPath, ['worktree', 'list', '--porcelain']));

  const ctx = { devRef: DEV_REF, candidates, prByName, worktreeByBranch };
  const branches = [];
  for (const candidate of candidates) branches.push(await branchFacts(run, repoPath, candidate, ctx));

  return { repo: path.basename(repoPath), fetchedAt: new Date().toISOString(), branches, prs };
}
