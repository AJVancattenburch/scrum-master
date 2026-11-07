#!/usr/bin/env node
import { auditWorktree, blockingFindings, formatFinding } from '../lib/diff-audit.mjs';
import { resolveProfile } from '../lib/repo-profile.mjs';

const USAGE = 'usage: diff-audit.mjs <worktree> [base-ref=origin/<profile baseBranch>]';

function main([worktree, base]) {
  if (!worktree) {
    console.error(USAGE);
    return 2;
  }
  let findings;
  try {
    findings = auditWorktree(worktree, resolveProfile(worktree), base);
  } catch (error) {
    console.error(`diff-audit: ${error.message}`);
    return 2;
  }
  for (const f of findings) console.log(formatFinding(f));
  const blocking = blockingFindings(findings);
  console.log(blocking.length ? `FAIL: ${blocking.length} blocking finding(s)` : 'PASS (justify any single comments listed above)');
  return blocking.length ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
