export const MAX_BLOCKS = 2;
const WORKTREE_LINE = /^WORKTREE:\s*(\S.*?)\s*$/m;

export function worktreeFrom(message) {
  const match = WORKTREE_LINE.exec(message ?? '');
  return match ? match[1] : null;
}

export function decide({ blocksSoFar, problem }) {
  if (!problem) return { action: 'allow' };
  return { action: blocksSoFar >= MAX_BLOCKS ? 'give-up' : 'block', reason: problem };
}
