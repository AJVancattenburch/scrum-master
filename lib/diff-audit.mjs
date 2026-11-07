import { git } from './git.mjs';

const COMMENT_LINE = /^\s*(\/\/|\/\*|\*(?!\*\s*$)|\*\/|<!--|-->)/;

/** Parses `git diff -U0` output into added lines per file, with their new-file line numbers. */
export function parseAddedLines(diffText) {
  const files = new Map();
  let file = null;
  let lineNo = 0;
  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw === '+++ /dev/null' ? null : raw.slice(6);
      if (file && !files.has(file)) files.set(file, []);
    } else if (raw.startsWith('@@')) {
      const match = /\+(\d+)/.exec(raw);
      if (!match) throw new Error(`unparseable hunk header: ${raw}`);
      lineNo = Number(match[1]);
    } else if (file && raw.startsWith('+')) {
      files.get(file).push({ line: lineNo, text: raw.slice(1) });
      lineNo += 1;
    }
  }
  return files;
}

/** Runs of consecutive added comment lines, excluding a lone PHI data-classification tag. */
function commentRuns(added, phiTag) {
  const runs = [];
  let run = [];
  const flush = () => {
    if (run.length) runs.push(run);
    run = [];
  };
  for (const entry of added) {
    const continues = run.length && entry.line === run[run.length - 1].line + 1;
    if (!COMMENT_LINE.test(entry.text)) {
      flush();
      continue;
    }
    if (!continues) flush();
    run.push(entry);
  }
  flush();
  return runs.filter((r) => !(r.length === 1 && phiTag.test(r[0].text)));
}

/** Returns findings for added comment runs and per-file growth, scoped to the profile's audit settings. */
export function auditDiff(diffText, audit) {
  const codeFile = new RegExp(`\\.(${audit.codeExtensions.join('|')})$`);
  const phiTag = new RegExp(audit.phiTag, 'i');
  const findings = [];
  for (const [file, added] of parseAddedLines(diffText)) {
    if (!codeFile.test(file)) continue;
    for (const run of commentRuns(added, phiTag)) {
      const kind = run.length > audit.maxCommentRun ? 'comment-block' : 'comment';
      findings.push({ kind, file, line: run[0].line, lines: run.length, text: run[0].text.trim() });
    }
    if (added.length > audit.maxFileGrowth) {
      findings.push({ kind: 'growth', file, line: 1, lines: added.length, text: `+${added.length} lines` });
    }
  }
  return findings;
}

function worktreeDiff(worktree, baseRef) {
  return git(worktree, ['diff', '-U0', '--no-color', `${baseRef}...HEAD`]);
}

export function auditWorktree(worktree, profile, baseRef = `origin/${profile.baseBranch}`) {
  return auditDiff(worktreeDiff(worktree, baseRef), profile.audit);
}

export function addedLineCount(worktree, profile) {
  let total = 0;
  for (const added of parseAddedLines(worktreeDiff(worktree, `origin/${profile.baseBranch}`)).values()) total += added.length;
  return total;
}

/** Findings that fail the gate; single short comments are reported for justification but don't fail. */
export function blockingFindings(findings) {
  return findings.filter((f) => f.kind !== 'comment');
}

export function formatFinding(f) {
  return `${f.kind}\t${f.file}:${f.line}\t${f.lines}\t${f.text}`;
}
