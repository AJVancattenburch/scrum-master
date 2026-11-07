#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditWorktree, blockingFindings, formatFinding } from '../lib/diff-audit.mjs';
import { readJson } from '../lib/read-json.mjs';
import { resolveProfile } from '../lib/repo-profile.mjs';
import { decide, worktreeFrom } from '../lib/stop-gate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = process.env.STOP_GATE_STATE ?? path.join(root, '.superpowers', 'stop-gate');

function problemWith(worktree) {
  if (!worktree) return 'End your report with a line `WORKTREE: <absolute path>` naming the worktree you changed.';
  try {
    const blocking = blockingFindings(auditWorktree(worktree, resolveProfile(worktree)));
    return blocking.length ? `diff-audit failed; fix these, then report again:\n${blocking.map(formatFinding).join('\n')}` : null;
  } catch (error) {
    return `diff-audit could not run on ${worktree}: ${error.message}`;
  }
}

function main() {
  const payload = JSON.parse(readFileSync(0, 'utf8'));
  if (!payload.agent_id) throw new Error('hook input has no agent_id');
  const id = String(payload.agent_id).replace(/[^\w.-]/g, '_');
  mkdirSync(stateDir, { recursive: true });
  const countPath = path.join(stateDir, `${id}.json`);
  const blocksSoFar = readJson(countPath, 0);
  const { action, reason } = decide({ blocksSoFar, problem: problemWith(worktreeFrom(payload.last_assistant_message)) });
  if (action === 'block') {
    writeFileSync(countPath, JSON.stringify(blocksSoFar + 1));
    process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  } else if (action === 'give-up') {
    writeFileSync(path.join(stateDir, `${id}.failed`), `GATE: FAILED\n${reason}\n`);
  }
}

try {
  main();
} catch (error) {
  console.error(`stop-gate: ${error.message}`);
  process.exitCode = 1;
}
