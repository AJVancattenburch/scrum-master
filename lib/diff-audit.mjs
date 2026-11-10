import { git } from './git.mjs';

const COMMENT_LINE = /^\s*(\/\/|\/\*|\*(?!\*\s*$)|\*\/|<!--|-->)/;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

// Exempt only when the tag sits immediately after the comment marker, so a
// run like "// TODO data classification later" still gets reported.
function isPhiTag(text, phiTag) {
  const marker = COMMENT_LINE.exec(text);
  if (!marker) return false;
  const rest = text.slice(marker[0].length).replace(/^\s+/, '');
  return new RegExp(`^${phiTag.source}`, 'i').test(rest);
}

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
  return runs.filter((r) => !(r.length === 1 && isPhiTag(r[0].text, phiTag)));
}

export function auditDiff(diffText, audit) {
  const codeFile = new RegExp(`\\.(${audit.codeExtensions.map(escapeRegExp).join('|')})$`);
  const phiTag = new RegExp(escapeRegExp(audit.phiTag), 'i');
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

// Single comments are reported for justification, not failed.
export function blockingFindings(findings) {
  return findings.filter((f) => f.kind !== 'comment');
}

export function formatFinding(f) {
  return `${f.kind}\t${f.file}:${f.line}\t${f.lines}\t${f.text}`;
}

export function auditReport(worktree, profile, baseRef) {
  const findings = auditWorktree(worktree, profile, baseRef);
  return { blocking: blockingFindings(findings), text: findings.map(formatFinding).join('\n') };
}
