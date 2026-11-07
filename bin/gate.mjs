#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateSteps, parseGateArgs, runGate } from '../lib/gate.mjs';
import { git } from '../lib/git.mjs';
import { resolveProfile } from '../lib/repo-profile.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function main(argv) {
  let steps;
  let logDir;
  try {
    const { worktree, pixel } = parseGateArgs(argv);
    const profile = resolveProfile(worktree);
    const branch = git(worktree, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    logDir = path.join(root, '.superpowers', 'gate', `${profile.name}-${branch.replace(/[^\w.-]/g, '_')}`);
    steps = gateSteps({ worktree, profile, pixel, pixelScript: path.join(root, 'bin', 'pixel-diff.mjs') });
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  const { ok, summary } = runGate(steps, logDir);
  console.log(summary);
  return ok ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
