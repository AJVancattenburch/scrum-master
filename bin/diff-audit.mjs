#!/usr/bin/env node
import { auditReport } from '../lib/diff-audit.mjs';
import { resolveProfile } from '../lib/repo-profile.mjs';

const USAGE = 'usage: diff-audit.mjs <worktree> [base-ref=origin/<profile baseBranch>]';

function main([worktree, base]) {
  if (!worktree) {
    console.error(USAGE);
    return 2;
  }
  let report;
  try {
    report = auditReport(worktree, resolveProfile(worktree), base);
  } catch (error) {
    console.error(`diff-audit: ${error.message}`);
    return 2;
  }
  const { blocking, text } = report;
  if (text) console.log(text);
  console.log(blocking.length ? `FAIL: ${blocking.length} blocking finding(s)` : 'PASS (justify any single comments listed above)');
  return blocking.length ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
