#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { auditDiff, blockingFindings } from '../lib/diff-audit.mjs';

const USAGE = 'usage: diff-audit.mjs <repo-path> [base-ref=origin/dev]';

function main([repo, base = 'origin/dev']) {
  if (!repo) {
    console.error(USAGE);
    return 2;
  }
  let diff;
  try {
    diff = execFileSync('git', ['-C', repo, 'diff', '-U0', '--no-color', `${base}...HEAD`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    console.error(`git diff failed: ${error.message}`);
    return 2;
  }
  const findings = auditDiff(diff);
  for (const f of findings) {
    console.log(`${f.kind}\t${f.file}:${f.line}\t${f.lines}\t${f.text}`);
  }
  const blocking = blockingFindings(findings);
  console.log(blocking.length ? `FAIL: ${blocking.length} blocking finding(s)` : 'PASS (justify any single comments listed above)');
  return blocking.length ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
