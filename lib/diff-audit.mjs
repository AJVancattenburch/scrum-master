const COMMENT_LINE = /^\s*(\/\/|\/\*|\*(?!\*\s*$)|\*\/|<!--|-->)/;
const PHI_TAG = /DATA CLASSIFICATION/;
const CODE_FILE = /\.(m?[jt]s|svelte)$/;

export const DEFAULT_LIMITS = { maxCommentRun: 2, maxFileGrowth: 200 };

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
function commentRuns(added) {
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
  return runs.filter((r) => !(r.length === 1 && PHI_TAG.test(r[0].text)));
}

/** Returns findings for added comment runs and per-file growth; an empty list means the diff passes. */
export function auditDiff(diffText, limits = DEFAULT_LIMITS) {
  const findings = [];
  for (const [file, added] of parseAddedLines(diffText)) {
    if (!CODE_FILE.test(file)) continue;
    for (const run of commentRuns(added)) {
      const kind = run.length > limits.maxCommentRun ? 'comment-block' : 'comment';
      findings.push({ kind, file, line: run[0].line, lines: run.length, text: run[0].text.trim() });
    }
    if (added.length > limits.maxFileGrowth) {
      findings.push({ kind: 'growth', file, line: 1, lines: added.length, text: `+${added.length} lines` });
    }
  }
  return findings;
}

/** Findings that fail the gate; single short comments are reported for justification but don't fail. */
export function blockingFindings(findings) {
  return findings.filter((f) => f.kind !== 'comment');
}
