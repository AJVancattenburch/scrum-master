import path from 'node:path';
import { renderTemplate } from './template.mjs';

export const ROLES = ['plan-reviewer', 'developer', 'reviewer', 'tester', 'team-lead'];
const HELPER_ROLES = ['plan-reviewer', 'developer', 'tester', 'reviewer'];
const REQUIRED = ['id', 'repo', 'worktree', 'lane'];
// These fields are pasted into commands a helper must run exactly as written.
const COMMAND_FIELDS = ['worktree', 'feature', 'url'];
const SHELL_LITERAL = /^[\w./:@%+=,-]*$/;
// The id names the report file, so it must not climb out of the reports folder.
const TASK_ID = /^[\w-]+$/;
const MODELS = {
  S: { 'plan-reviewer': 'opus', developer: 'sonnet', reviewer: 'sonnet', tester: 'sonnet' },
  M: { 'plan-reviewer': 'opus', developer: 'opus', reviewer: 'opus', tester: 'sonnet' },
  L: { 'plan-reviewer': 'opus', developer: 'opus', reviewer: 'opus', tester: 'sonnet', 'team-lead': 'opus' },
};
// A unit inherits its parent task's lane, so only a top-level task can mismatch the table.
const LANE_CHECK = (lane) => `The plan's lane is not lane ${lane}, or lane ${lane} does not fit the lane table, applied in this order: L if the plan needs more than one PR, both repos, or an API contract change; else S if it is one package, about 150 lines or fewer, with no contract or shared state; else M, one repo and one PR however large, with no lead. The plan must state its lane and the table row it matches.`;
const SMALL_DIFF_LINES = 150;
// An oversized brief eats the helper's context before it starts work.
export const MAX_BRIEF_LINES = 200;
const ESCALATIONS = [
  'the work needs an API contract change that the task\'s plan items don\'t list;',
  'the work needs anything beyond the task\'s plan items;',
  'the work needs real patient data (data needs describe shape and source, never values);',
  'another open PR owns a file you need;',
  'a tool call is denied (never retry a variant).',
];

export function inputError(message) {
  const error = new Error(message);
  error.code = 'EINPUT';
  return error;
}

export function assertShellLiteral(name, value) {
  if (!SHELL_LITERAL.test(value)) throw inputError(`${name} must not contain whitespace or shell metacharacters`);
}

export function parseTask(text) {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) throw inputError('task file must start with a --- front matter block');
  const fields = Object.fromEntries(
    match[1].split('\n').filter((l) => l.trim()).map((l) => {
      const i = l.indexOf(':');
      if (i < 1) throw inputError(`bad task field line: ${l}`);
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
  );
  const missing = REQUIRED.filter((k) => !fields[k]);
  if (missing.length) throw inputError(`task file missing ${missing.join(', ')}`);
  if (!TASK_ID.test(fields.id)) throw inputError('id must be letters, digits, _ or -');
  if (!MODELS[fields.lane]) throw inputError('lane must be S, M or L');
  if (!path.isAbsolute(fields.worktree)) throw inputError('worktree must be an absolute path');
  for (const key of COMMAND_FIELDS) assertShellLiteral(key, fields[key] ?? '');
  return { fields, body: match[2].trim() };
}

export function modelFor(role, lane, { complex = false, diffLines = Infinity } = {}) {
  const model = MODELS[lane]?.[role];
  if (!model) throw inputError(`no ${role} in lane ${lane}`);
  if (role === 'developer' && complex) return 'opus';
  if (role === 'reviewer' && diffLines < SMALL_DIFF_LINES) return 'sonnet';
  return model;
}

export { renderTemplate };

export function assertBriefFits(brief, taskFile) {
  const lines = brief.trimEnd().split('\n').length;
  if (lines <= MAX_BRIEF_LINES) return;
  throw inputError(`${taskFile} renders a brief of ${lines} lines, over the ${MAX_BRIEF_LINES}-line cap; split the task`);
}

const bullets = (items) => items.map((i) => `- ${i}`).join('\n');

export function briefVars({ role, task, profile, standards, standardsPath, root, taskFile }) {
  const { fields } = task;
  const pixel = profile.pixelDiff && fields.feature && fields.url ? ` --feature ${fields.feature} --url ${fields.url}` : '';
  return {
    id: fields.id,
    repo: profile.name,
    worktree: fields.worktree,
    lane: fields.lane,
    laneCheck: fields.parent ? `Skip the lane check: this is a unit of ${fields.parent}, which owns the lane.` : LANE_CHECK(fields.lane),
    baseBranch: profile.baseBranch,
    baseRef: `origin/${profile.baseBranch}`,
    readFirst: bullets(profile.readFirst.map((f) => path.join(fields.worktree, f))),
    standards,
    standardsPath,
    task: task.body,
    reportPath: path.join(root, '.superpowers', 'reports', `${fields.id}-${role}.md`),
    auditCommand: `node ${path.join(root, 'bin', 'diff-audit.mjs')} ${fields.worktree}`,
    gateCommand: `node ${path.join(root, 'bin', 'gate.mjs')} ${fields.worktree}${pixel}`,
    taskFile,
    briefCommands: bullets(HELPER_ROLES.map((r) => `\`node ${path.join(root, 'bin', 'brief.mjs')} ${r} ${taskFile}\``)),
    verification: bullets(profile.verification),
    escalations: bullets(ESCALATIONS),
  };
}
