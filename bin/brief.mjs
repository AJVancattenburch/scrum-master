#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBriefFits, assertShellLiteral, briefVars, modelFor, parseTask, renderTemplate, ROLES } from '../lib/brief.mjs';
import { addedLineCount } from '../lib/diff-audit.mjs';
import { resolveProfile } from '../lib/repo-profile.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = `usage: brief.mjs <${ROLES.join('|')}> <task-file>`;
const INPUT_ERRORS = ['ENOENT', 'EINPUT'];

function main([role, taskArg]) {
  if (!ROLES.includes(role) || !taskArg) {
    console.error(USAGE);
    return 2;
  }
  const taskFile = path.resolve(taskArg);
  try {
    assertShellLiteral('scrum-master root', root);
    assertShellLiteral('task file path', taskFile);
    const task = parseTask(readFileSync(taskFile, 'utf8'));
    const profile = resolveProfile(task.fields.worktree);
    if (profile.name !== task.fields.repo) throw new Error(`task says repo ${task.fields.repo} but ${task.fields.worktree} is ${profile.name}`);
    const standardsPath = path.join(root, 'STANDARDS.md');
    const standards = readFileSync(standardsPath, 'utf8').replace(/^# .*\n+/, '').trim();
    const template = readFileSync(path.join(root, 'briefs', `${role}.md`), 'utf8');
    const diffLines = role === 'reviewer' ? addedLineCount(task.fields.worktree, profile) : undefined;
    const model = modelFor(role, task.fields.lane, { complex: task.fields.complex === 'true', diffLines });
    const output = `MODEL: ${model}\n\n${renderTemplate(template, briefVars({ role, task, profile, standards, standardsPath, root, taskFile }))}`;
    assertBriefFits(output, taskFile);
    console.log(output);
    return 0;
  } catch (error) {
    console.error(`brief: ${error.message}`);
    return INPUT_ERRORS.includes(error.code) ? 2 : 1;
  }
}

process.exitCode = main(process.argv.slice(2));
