import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { auditWorktree, blockingFindings, formatFinding } from './diff-audit.mjs';

export const GATE_USAGE = 'usage: gate.mjs <worktree> [--feature <name> --url <url>]...';
const MAX_SUMMARY_LINES = 15;

export function parseGateArgs(argv) {
  const [worktree, ...rest] = argv;
  if (!worktree || worktree.startsWith('--') || rest.length % 4 !== 0) throw new Error(GATE_USAGE);
  const pixel = [];
  for (let i = 0; i < rest.length; i += 4) {
    const [featureFlag, feature, urlFlag, url] = rest.slice(i, i + 4);
    if (featureFlag !== '--feature' || urlFlag !== '--url') throw new Error(GATE_USAGE);
    pixel.push({ feature, url });
  }
  return { worktree: path.resolve(worktree), pixel };
}

export function runCommand(cmd, cwd) {
  const result = spawnSync(cmd[0], cmd.slice(1), { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.error) return { ok: false, output: `${cmd[0]}: ${result.error.message}` };
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}` };
}

function auditStep(worktree, profile) {
  const findings = auditWorktree(worktree, profile);
  return { ok: blockingFindings(findings).length === 0, output: findings.map(formatFinding).join('\n') };
}

export function gateSteps({ worktree, profile, pixel, pixelScript }) {
  if (pixel.length && !profile.pixelDiff) throw new Error(`${profile.name} has no pixel diff; drop --feature/--url`);
  return [
    { name: 'diff-audit', run: () => auditStep(worktree, profile) },
    ...profile.gates.map((g) => ({ name: g.name, run: () => runCommand(g.cmd, worktree) })),
    ...pixel.map(({ feature, url }) => ({
      name: `pixel:${feature}`,
      run: () => runCommand([process.execPath, pixelScript, feature, url], worktree),
    })),
  ];
}

export function summarize(results) {
  const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}`);
  for (const r of results.filter((x) => !x.ok)) {
    const first = r.output.split('\n').find((l) => l.trim()) ?? '(no output)';
    lines.push(`  ${r.name}: ${first.trim().slice(0, 160)} (log: ${r.log})`);
  }
  return lines.slice(0, MAX_SUMMARY_LINES).join('\n');
}

export function runGate(steps, logDir) {
  mkdirSync(logDir, { recursive: true });
  const results = steps.map((step) => {
    let result;
    try {
      result = step.run();
    } catch (error) {
      result = { ok: false, output: error.message };
    }
    const log = path.join(logDir, `${step.name.replace(/[^\w.-]/g, '_')}.log`);
    writeFileSync(log, result.output);
    return { name: step.name, ...result, log };
  });
  return { ok: results.every((r) => r.ok), summary: summarize(results) };
}
