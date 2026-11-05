const EXCLUDED_NAMES = ['dev', 'uat', 'main'];
const EXCLUDED_PREFIXES = ['backup/', 'dependabot/'];
const PR_PREFIX_FOR_REPO = { 'monitiv-frontend': 'FE', 'monitiv-gateway': 'GW' };
const STALE_THRESHOLD_DAYS = 14;

// Exported so repo-snapshot can skip expensive merge-base/conflict collection for
// branches that would be excluded here anyway, without duplicating the name list.
export function isExcludedByName(name) {
  return EXCLUDED_NAMES.includes(name) || EXCLUDED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function isExcluded(branch) {
  return branch.isAncestorOfDev || isExcludedByName(branch.name);
}

function nextActionFor(branch) {
  if (branch.dirty) return `commit changes in ${branch.worktree}`;
  if (branch.unpushed) return 'push';
  if (branch.conflicts.length > 0) return `rebase — conflicts in ${branch.conflicts.length} file${branch.conflicts.length === 1 ? '' : 's'}`;
  if (!branch.pr) return 'open PR';
  if (branch.pr.isDraft) return 'mark PR ready';
  if (branch.pr.statusCheckRollup === 'FAILURE') return 'fix CI';
  if (branch.pr.reviewDecision === 'REVIEW_REQUIRED' || branch.pr.reviewDecision === 'CHANGES_REQUESTED') return 'get review';
  return 'merge';
}

function findTaskByPR(tasks, repo, pr) {
  if (!pr) return undefined;
  const prefix = PR_PREFIX_FOR_REPO[repo];
  const patterns = [pr.url, prefix && `${prefix} PR #${pr.number}`].filter(Boolean);
  return tasks.find((task) => patterns.some((pattern) => task.ticket?.includes(pattern)));
}

function findTaskByName(tasks, branchName) {
  const match = branchName.match(/\bt(\d+)\b/i);
  if (!match) return undefined;
  const id = `T${match[1]}`;
  return tasks.find((task) => task.id === id);
}

// Depth is the longest ancestor chain, not just whether a parent exists.
function computeDepths(candidates) {
  const byKey = new Map(candidates.map(({ repo, branch }) => [`${repo}\u0000${branch.name}`, branch]));
  const depths = new Map();

  function resolve(key, seen) {
    if (depths.has(key)) return depths.get(key);
    if (seen.has(key)) return 0;
    seen.add(key);
    const [repo] = key.split('\u0000');
    const parentKeys = (byKey.get(key)?.parents ?? [])
      .map((name) => `${repo}\u0000${name}`)
      .filter((parentKey) => byKey.has(parentKey));
    const depth = parentKeys.length === 0 ? 0 : 1 + Math.max(...parentKeys.map((parentKey) => resolve(parentKey, seen)));
    depths.set(key, depth);
    return depth;
  }

  for (const key of byKey.keys()) resolve(key, new Set());
  return depths;
}

function compareRows(a, b) {
  const aHasConflicts = a.conflicts.length > 0 ? 0 : 1;
  const bHasConflicts = b.conflicts.length > 0 ? 0 : 1;
  if (aHasConflicts !== bHasConflicts) return aHasConflicts - bHasConflicts;
  if (a.behind !== b.behind) return b.behind - a.behind;
  return b.ageDays - a.ageDays;
}

// Moves each branch to sit directly after the candidate parent closest to it in the
// current order, so stacked work reads top-down instead of scattered by its own ranking.
function stackBranches(rows) {
  const result = [...rows];
  for (const row of rows) {
    if (!row.parents?.length) continue;
    const parentIndexes = row.parents
      .map((name) => result.findIndex((r) => r.repo === row.repo && r.branch === name))
      .filter((index) => index >= 0);
    if (parentIndexes.length === 0) continue;
    const nearestParentIndex = Math.max(...parentIndexes);
    const currentIndex = result.findIndex((r) => r.repo === row.repo && r.branch === row.branch);
    if (currentIndex === nearestParentIndex + 1) continue;
    const [item] = result.splice(currentIndex, 1);
    const parentIndexAfterRemoval = nearestParentIndex > currentIndex ? nearestParentIndex - 1 : nearestParentIndex;
    result.splice(parentIndexAfterRemoval + 1, 0, item);
  }
  return result;
}

export function rankBranches(snapshots, board) {
  const tasks = board.tasks ?? [];
  const candidates = snapshots.flatMap((snapshot) => snapshot.branches
    .filter((branch) => !isExcluded(branch))
    .map((branch) => ({ repo: snapshot.repo, branch })));

  const depths = computeDepths(candidates);

  const rows = candidates.map(({ repo, branch }) => ({
    repo,
    branch: branch.name,
    pr: branch.pr,
    behind: branch.behind,
    conflicts: branch.conflicts,
    ageDays: branch.ageDays,
    lastCommitDays: branch.lastCommitDays,
    ready: !branch.dirty && !branch.unpushed,
    stale: branch.lastCommitDays > STALE_THRESHOLD_DAYS,
    nextAction: nextActionFor(branch),
    task: (findTaskByPR(tasks, repo, branch.pr) ?? findTaskByName(tasks, branch.name))?.id,
    depth: depths.get(`${repo}\u0000${branch.name}`) ?? 0,
    parents: branch.parents,
  }));

  // Stale (head commit older than the threshold) wins over not-ready: a dirty or
  // unpushed branch that's also stale is grouped and shown with the stale group.
  const ready = stackBranches(rows.filter((row) => !row.stale && row.ready).sort(compareRows));
  const notReady = stackBranches(rows.filter((row) => !row.stale && !row.ready).sort(compareRows));
  const stale = stackBranches(rows.filter((row) => row.stale).sort(compareRows));

  return [...ready, ...notReady, ...stale];
}
