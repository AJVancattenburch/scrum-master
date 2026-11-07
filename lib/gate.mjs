import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { auditReport } from './diff-audit.mjs';

export const GATE_USAGE = 'usage: gate.mjs <worktree> [--feature <name> --url <url>]...';
const MAX_SUMMARY_LINES = 15;
const STEP_TIMEOUT_MS = 15 * 60 * 1000;

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

export function runCommand(cmd, cwd, timeoutMs = STEP_TIMEOUT_MS) {
  const result = spawnSync(cmd[0], cmd.slice(1), { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs });
  if (result.error?.code === 'ETIMEDOUT') {
    const minutes = (timeoutMs / 60000).toFixed(2);
    return { ok: false, output: `timed out after ${minutes} min\n${result.stdout ?? ''}${result.stderr ?? ''}` };
  }
  if (result.error) return { ok: false, output: `${cmd[0]}: ${result.error.message}` };
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}`, stderr: result.stderr };
}

function auditStep(worktree, profile) {
  const { blocking, text } = auditReport(worktree, profile);
  return { ok: blocking.length === 0, output: text };
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

// A command step carries stdout/stderr separately so a banner on stdout (eg. "> pkg@x check")
// doesn't win over the actual error; a thrown step has only a message, so that's the fallback.
function failureDetail(result) {
  const stderrLine = (result.stderr ?? '').split('\n').find((l) => l.trim());
  if (stderrLine) return stderrLine.trim();
  const outputLine = result.output.split('\n').find((l) => l.trim());
  return outputLine ? outputLine.trim() : '(no output)';
}

export function summarize(results, logDir) {
  const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}`);
  for (const r of results.filter((x) => !x.ok)) {
    lines.push(`  ${r.name}: ${failureDetail(r).slice(0, 160)} (log: ${r.log})`);
  }
  if (lines.length <= MAX_SUMMARY_LINES) return lines.join('\n');
  const kept = lines.slice(0, MAX_SUMMARY_LINES - 1);
  kept.push(`… +${lines.length - kept.length} more; logs: ${logDir}`);
  return kept.join('\n');
}

export function runGate(steps, logDir) {
  // Stale files from a previous run would otherwise sit next to this run's and look current.
  rmSync(logDir, { recursive: true, force: true });
  mkdirSync(logDir, { recursive: true });
  const results = steps.map((step, index) => {
    let result;
    let logContent;
    try {
      result = step.run();
      logContent = result.output;
    } catch (error) {
      result = { ok: false, output: error.message };
      logContent = error.stack;
    }
    // Index-prefixed so two step names that sanitize the same way (eg. "pixel:a/b" and
    // "pixel:a_b") still get distinct files instead of one overwriting the other.
    const log = path.join(logDir, `${index}-${step.name.replace(/[^\w.-]/g, '_')}.log`);
    writeFileSync(log, logContent);
    return { name: step.name, ...result, log };
  });
  return { ok: results.every((r) => r.ok), summary: summarize(results, logDir) };
}
