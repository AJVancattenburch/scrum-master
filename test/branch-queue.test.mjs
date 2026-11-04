import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankBranches } from '../lib/branch-queue.mjs';

const board = {
  tasks: [
    { id: 'T1', title: 'Alerts page', repo: 'both', ticket: 'FE PR #12' },
    { id: 'T2', title: 'Branch queue', repo: 'frontend', ticket: 'https://github.com/pennant/monitiv-gateway/pull/7' },
    { id: 'T3', title: 'Other', repo: 'frontend', ticket: 'see t42 for details' },
  ],
  dataNeeds: [],
  blockers: [],
};

function snapshot(repo, branches, prs = []) {
  return { repo, fetchedAt: '2026-11-04T00:00:00.000Z', branches, prs };
}

function branch(name, overrides = {}) {
  return {
    name,
    behind: 0,
    ageDays: 1,
    conflicts: [],
    worktree: null,
    dirty: false,
    unpushed: false,
    isAncestorOfDev: false,
    parents: [],
    ...overrides,
  };
}

test('excludes dev/uat/main, backup/* and dependabot/* branches', () => {
  const snap = snapshot('monitiv-frontend', [
    branch('dev'), branch('uat'), branch('main'),
    branch('backup/old'), branch('dependabot/npm/foo'),
    branch('feature/keep'),
  ]);
  const rows = rankBranches([snap], board);
  assert.deepEqual(rows.map((r) => r.branch), ['feature/keep']);
});

test('excludes branches already merged into origin/dev', () => {
  const snap = snapshot('monitiv-frontend', [
    branch('merged', { isAncestorOfDev: true }),
    branch('open'),
  ]);
  const rows = rankBranches([snap], board);
  assert.deepEqual(rows.map((r) => r.branch), ['open']);
});

test('groups dirty or unpushed branches as not ready, ready branches first', () => {
  const snap = snapshot('monitiv-frontend', [
    branch('dirty-one', { dirty: true }),
    branch('clean-one'),
    branch('unpushed-one', { unpushed: true }),
  ]);
  const rows = rankBranches([snap], board);
  assert.deepEqual(rows.map((r) => [r.branch, r.ready]), [
    ['clean-one', true],
    ['dirty-one', false],
    ['unpushed-one', false],
  ]);
});

test('orders ready group by conflicts first, then behind desc, then ageDays desc', () => {
  const snap = snapshot('monitiv-frontend', [
    branch('low-behind', { behind: 1, ageDays: 10 }),
    branch('has-conflicts', { conflicts: ['a.js'], behind: 1, ageDays: 1 }),
    branch('high-behind-old', { behind: 5, ageDays: 20 }),
    branch('high-behind-new', { behind: 5, ageDays: 2 }),
  ]);
  const rows = rankBranches([snap], board);
  assert.deepEqual(rows.map((r) => r.branch), [
    'has-conflicts', 'high-behind-old', 'high-behind-new', 'low-behind',
  ]);
});

test('stacks a branch directly after its nearest parent', () => {
  const snap = snapshot('monitiv-frontend', [
    branch('child', { behind: 9, ageDays: 1, parents: ['parent'] }),
    branch('parent', { behind: 1, ageDays: 1 }),
    branch('unrelated', { behind: 1, ageDays: 1 }),
  ]);
  const rows = rankBranches([snap], board);
  const names = rows.map((r) => r.branch);
  assert.equal(names.indexOf('child'), names.indexOf('parent') + 1);
});

test('assigns nextAction by state precedence', () => {
  const snap = snapshot('monitiv-frontend', [
    branch('dirty-branch', { dirty: true, worktree: '/wt/dirty-branch' }),
    branch('unpushed-branch', { unpushed: true }),
    branch('conflict-branch', { conflicts: ['a.js', 'b.js'] }),
    branch('no-pr-branch'),
    branch('draft-pr-branch', { pr: { number: 1, isDraft: true, url: 'https://x/1' } }),
    branch('ci-failing-branch', { pr: { number: 2, isDraft: false, statusCheckRollup: 'FAILURE', url: 'https://x/2' } }),
    branch('review-pending-branch', { pr: { number: 3, isDraft: false, statusCheckRollup: 'SUCCESS', reviewDecision: 'REVIEW_REQUIRED', url: 'https://x/3' } }),
    branch('changes-requested-branch', { pr: { number: 4, isDraft: false, statusCheckRollup: 'SUCCESS', reviewDecision: 'CHANGES_REQUESTED', url: 'https://x/4' } }),
    branch('mergeable-branch', { pr: { number: 5, isDraft: false, statusCheckRollup: 'SUCCESS', reviewDecision: 'APPROVED', url: 'https://x/5' } }),
  ]);
  const rows = rankBranches([snap], board);
  const byName = Object.fromEntries(rows.map((r) => [r.branch, r.nextAction]));
  assert.equal(byName['dirty-branch'], 'commit changes in /wt/dirty-branch');
  assert.equal(byName['unpushed-branch'], 'push');
  assert.equal(byName['conflict-branch'], 'rebase — conflicts in 2 files');
  assert.equal(byName['no-pr-branch'], 'open PR');
  assert.equal(byName['draft-pr-branch'], 'mark PR ready');
  assert.equal(byName['ci-failing-branch'], 'fix CI');
  assert.equal(byName['review-pending-branch'], 'get review');
  assert.equal(byName['changes-requested-branch'], 'get review');
  assert.equal(byName['mergeable-branch'], 'merge');
});

test('matches a task by PR URL or "FE/GW PR #n" in ticket, beating name match', () => {
  const feSnap = snapshot('monitiv-frontend', [
    branch('t42-unrelated-name', { pr: { number: 12, isDraft: false, url: 'https://github.com/pennant/monitiv-frontend/pull/12' } }),
  ]);
  const rows = rankBranches([feSnap], board);
  assert.equal(rows[0].task, 'T1');
});

test('matches a task by PR URL for gateway repo', () => {
  const gwSnap = snapshot('monitiv-gateway', [
    branch('some-branch', { pr: { number: 7, isDraft: false, url: 'https://github.com/pennant/monitiv-gateway/pull/7' } }),
  ]);
  const rows = rankBranches([gwSnap], board);
  assert.equal(rows[0].task, 'T2');
});

test('bare "PR #n" in ticket never matches', () => {
  const snap = snapshot('monitiv-frontend', [
    branch('t1-name', { pr: { number: 12, isDraft: false, url: 'https://github.com/pennant/monitiv-frontend/pull/999' } }),
  ]);
  const rows = rankBranches([snap], board);
  // t1-name matches T1 by name (\bt1\b), not by the bare "PR #12" pattern anywhere.
  assert.equal(rows[0].task, 'T1');
});

test('matches a task by \\bt(N)\\b in the branch name', () => {
  const snap = snapshot('monitiv-frontend', [
    branch('feature/t3-branch-queue'),
  ]);
  const rows = rankBranches([snap], board);
  assert.equal(rows[0].task, 'T3');
});

test('branch with no matching PR or name has no task link', () => {
  const snap = snapshot('monitiv-frontend', [branch('random-branch')]);
  const rows = rankBranches([snap], board);
  assert.equal(rows[0].task, undefined);
});
