#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditReport } from '../lib/diff-audit.mjs';
import { git } from '../lib/git.mjs';
import { readJson } from '../lib/read-json.mjs';
import { resolveProfile } from '../lib/repo-profile.mjs';
import { decide, worktreeFrom } from '../lib/stop-gate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = process.env.STOP_GATE_STATE ?? path.join(root, '.superpowers', 'stop-gate');

function problemWith(worktree) {
  if (!worktree) return 'End your report with a line `WORKTREE: <absolute path>` naming the worktree you changed.';
  try {
    if (git(worktree, ['status', '--porcelain']).trim()) return 'Commit your work, then report again; the diff-audit only sees committed changes.';
    const { blocking, text } = auditReport(worktree, resolveProfile(worktree));
    return blocking.length ? `diff-audit failed; fix the blocking findings, justify any single comments, then report again:\n${text}` : null;
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
  const markerPath = path.join(stateDir, `${id}.failed`);
  const blocksSoFar = readJson(countPath, 0);
  const { action, reason } = decide({ blocksSoFar, problem: problemWith(worktreeFrom(payload.last_assistant_message)) });
  if (action === 'allow') {
    rmSync(countPath, { force: true });
    rmSync(markerPath, { force: true });
  } else if (action === 'block') {
    writeFileSync(countPath, JSON.stringify(blocksSoFar + 1));
    process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  } else if (!existsSync(markerPath)) {
    writeMarker(markerPath, reason);
  }
}

function writeMarker(markerPath, reason) {
  writeFileSync(markerPath, `GATE: FAILED\n${reason}\n`);
}

try {
  main();
} catch (error) {
  console.error(`stop-gate: ${error.message}`);
  process.exitCode = 1;
  // Exit 1 lets a SubagentStop proceed, so the marker is what keeps the failure visible.
  mkdirSync(stateDir, { recursive: true });
  writeMarker(path.join(stateDir, `hook-error-${Date.now()}.failed`), `stop-gate: ${error.message}`);
}
