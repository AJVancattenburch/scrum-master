import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertBriefFits, assertShellLiteral, briefVars, MAX_BRIEF_LINES, modelFor, parseTask, renderTemplate, ROLES } from '../lib/brief.mjs';
import { loadProfiles } from '../lib/repo-profile.mjs';
import { makeTempRepo } from './helpers/temp-repo.mjs';

const profiles = loadProfiles();
const template = (role) => readFileSync(new URL(`../briefs/${role}.md`, import.meta.url), 'utf8');
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const BIN = path.join(ROOT, 'bin', 'brief.mjs');
const taskText = (repo, extra = '', worktree = '/abs/wt') => `---\nid: T9\nrepo: ${repo}\nworktree: ${worktree}\nlane: M\n${extra}---\n## Goal\nDo it.\n`;

const brief = (role, repo, extra) => {
  const task = parseTask(taskText(repo, extra));
  const vars = briefVars({ role, task, profile: { name: repo, ...profiles[repo] }, standards: '- KISS', standardsPath: '/abs/STANDARDS.md', root: '/abs/sm', taskFile: '/abs/sm/tickets/tasks/T9.md' });
  return renderTemplate(template(role), vars);
};

function runCli(args) {
  try {
    return { stdout: execFileSync(process.execPath, [BIN, ...args], { encoding: 'utf8' }), code: 0 };
  } catch (err) {
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.status };
  }
}

function writeTaskFile(t, text, prefix = 'brief-task-') {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'T9.md');
  writeFileSync(file, text);
  return file;
}

test('parseTask reads fields and body, and rejects bad input as an input error', () => {
  const { fields, body } = parseTask(taskText('monitiv-gateway'));
  assert.equal(fields.lane, 'M');
  assert.match(body, /Do it/);
  assert.equal(parseTask(taskText('monitiv-frontend', 'url: http://localhost:5174/insight/br\n')).fields.url, 'http://localhost:5174/insight/br');
  const bad = [
    ['## Goal\nno header', /front matter/],
    ['---\nid: T1\n---\n', /missing repo, worktree, lane/],
    [taskText('monitiv-gateway').replace('lane: M', 'lane: X'), /lane must be S, M or L/],
    [taskText('monitiv-gateway').replace('/abs/wt', 'rel/wt'), /absolute/],
    [taskText('monitiv-gateway').replace('id: T9', 'id: ../../x'), /id must be letters, digits, _ or -/],
    [taskText('monitiv-frontend', 'url: http://x/?a=1&b=2\n'), /url must not contain whitespace or shell metacharacters/],
    [taskText('monitiv-frontend', 'feature: a b\n'), /feature must not contain/],
  ];
  for (const [text, message] of bad) assert.throws(() => parseTask(text), { code: 'EINPUT', message }, text);
});

test('assertShellLiteral rejects a value a shell would split or expand', () => {
  assert.doesNotThrow(() => assertShellLiteral('root', '/abs/scrum-master'));
  assert.throws(() => assertShellLiteral('root', '/abs/my repo'), { code: 'EINPUT', message: /root must not contain whitespace/ });
});

test('modelFor follows the lane table', () => {
  assert.equal(modelFor('developer', 'S'), 'sonnet');
  assert.equal(modelFor('developer', 'S', { complex: true }), 'opus');
  assert.equal(modelFor('developer', 'M'), 'opus');
  assert.equal(modelFor('reviewer', 'M', { diffLines: 400 }), 'opus');
  assert.equal(modelFor('reviewer', 'M', { diffLines: 120 }), 'sonnet');
  assert.equal(modelFor('tester', 'L'), 'sonnet');
  assert.throws(() => modelFor('team-lead', 'S'), /no team-lead in lane S/);
});

test('renderTemplate fails loudly on an unfilled placeholder', () => {
  assert.equal(renderTemplate('a {{x}}', { x: '1' }), 'a 1');
  assert.throws(() => renderTemplate('a {{y}}', { x: '1' }), /unfilled placeholder {{y}}/);
});

test('every brief carries the standards, the escalations and the report path', () => {
  for (const role of ROLES) {
    const text = brief(role, 'monitiv-gateway');
    assert.match(text, /\/abs\/STANDARDS\.md/, role);
    assert.match(text, /- KISS/, role);
    assert.match(text, /real patient data/, role);
    assert.ok(text.includes(`/abs/sm/.superpowers/reports/T9-${role}.md`), role);
    assert.match(text.trimEnd(), new RegExp(`REPORT: /abs/sm/\\.superpowers/reports/T9-${role}\\.md$`), role);
  }
  assert.match(brief('developer', 'monitiv-gateway'), /WORKTREE: \/abs\/wt\nREPORT: /);
});

test('every template writes the full report with the Write tool and caps the returned message at 15 lines', () => {
  for (const role of ROLES) {
    assert.match(template(role), /with the Write tool to `{{reportPath}}`/, role);
    const caps = [...template(role).matchAll(/return at most (\d+) lines/g)].map(([, n]) => Number(n));
    assert.equal(caps.length, 1, role);
    assert.ok(caps[0] <= 15, `${role} returns ${caps[0]} lines`);
  }
});

test('reviewer and tester may not change the worktree but may write their report', () => {
  assert.match(template('reviewer'), /Do not edit anything in `{{worktree}}`\./);
  assert.match(template('tester'), /Do not fix anything in `{{worktree}}`; report it\./);
});

test('developer and team-lead briefs pin the profile base branch', () => {
  for (const role of ['developer', 'team-lead']) {
    assert.match(brief(role, 'monitiv-gateway'), /Branch from, diff against and open PRs into `dev` only\./, role);
  }
});

test('the team-lead brief allows up to 3 parallel developers on disjoint files', () => {
  assert.match(brief('team-lead', 'monitiv-gateway'), /up to 3 parallel developers/);
  assert.match(brief('team-lead', 'monitiv-gateway'), /accepted before any parallel developer starts/);
  assert.match(brief('team-lead', 'monitiv-gateway'), /If a worktree cannot be created, run the units sequentially in one worktree instead\./);
  assert.doesNotMatch(brief('team-lead', 'monitiv-gateway'), /does not exist yet/);
});

test('the team-lead brief prints literal brief commands for the real roles and task file', () => {
  const text = brief('team-lead', 'monitiv-gateway');
  for (const role of ['developer', 'tester', 'reviewer']) {
    assert.ok(text.includes(`\`node /abs/sm/bin/brief.mjs ${role} /abs/sm/tickets/tasks/T9.md\``), role);
  }
});

test('every command in a brief is one literal command', () => {
  for (const role of ROLES) {
    assert.match(template(role), /Run each command exactly as written; do not compose shell variables, pipes or loops\./, role);
    const text = brief(role, 'monitiv-frontend', 'feature: f\nurl: http://x\n');
    for (const [, cmd] of text.matchAll(/`([^`]+)`/g)) {
      assert.doesNotMatch(cmd, /\$|\||&&|;|<|>|\bcd\b|\bfor\b|\bwhile\b/, `${role}: ${cmd}`);
    }
  }
});

test('a brief carries only its own repo\'s workflow', () => {
  const tokens = (p) => [...p.readFirst, ...p.verification, ...p.gates.map((g) => g.cmd.join(' '))];
  const pairs = [['monitiv-gateway', 'monitiv-frontend'], ['monitiv-frontend', 'monitiv-gateway']];
  for (const [own, other] of pairs) {
    for (const role of ROLES) {
      const text = brief(role, own, own === 'monitiv-frontend' ? 'feature: f\nurl: http://x\n' : '');
      for (const token of tokens(profiles[other]).filter((t) => !tokens(profiles[own]).includes(t))) {
        assert.ok(!text.includes(token), `${role} brief for ${own} leaks "${token}"`);
      }
    }
  }
});

test('templates name no repo and no repo-specific tooling', () => {
  for (const role of ROLES) {
    assert.doesNotMatch(template(role), /monitiv|pnpm|svelte|golang|openapi|pixel|artifact|changelog/i, role);
  }
});

test('assertBriefFits rejects a brief over the line cap, naming the task file and the count', () => {
  assert.doesNotThrow(() => assertBriefFits('x\n'.repeat(MAX_BRIEF_LINES), '/abs/T9.md'));
  assert.throws(() => assertBriefFits('x\n'.repeat(MAX_BRIEF_LINES + 1), '/abs/T9.md'), /\/abs\/T9\.md.*201 lines/);
});

test('CLI prints the model (sonnet for a reviewer of an empty diff), an absolute report path and worktree', (t) => {
  const repo = makeTempRepo('monitiv-gateway', t);
  const { code, stdout } = runCli(['developer', writeTaskFile(t, taskText('monitiv-gateway', '', repo))]);
  assert.equal(code, 0);
  assert.match(stdout, /^MODEL: opus\n/);
  assert.ok(stdout.includes(`REPORT: ${ROOT}/.superpowers/reports/T9-developer.md`));
  assert.ok(stdout.includes(`WORKTREE: ${repo}`));
  assert.match(runCli(['reviewer', writeTaskFile(t, taskText('monitiv-gateway', '', repo))]).stdout, /^MODEL: sonnet\n/);
});

test('CLI exits 2 on bad input: usage, role, lane, brief size, task file, id or task path', (t) => {
  assert.equal(runCli([]).code, 2);
  const repo = makeTempRepo('monitiv-gateway', t);
  const taskFile = writeTaskFile(t, taskText('monitiv-gateway', '', repo));
  for (const role of ['nope', '../README']) {
    const unknown = runCli([role, taskFile]);
    assert.equal(unknown.code, 2, role);
    assert.match(unknown.stderr, /usage: brief\.mjs/, role);
  }
  const lead = runCli(['team-lead', taskFile]);
  assert.equal(lead.code, 2);
  assert.match(lead.stderr, /no team-lead in lane M/);
  const big = writeTaskFile(t, taskText('monitiv-gateway', '', repo) + '- line\n'.repeat(MAX_BRIEF_LINES));
  const oversized = runCli(['developer', path.relative(process.cwd(), big)]);
  assert.equal(oversized.code, 2);
  assert.match(oversized.stderr, new RegExp(`${big.replace(/[.]/g, '\\.')}.* \\d+ lines`));
  const invalid = [
    writeTaskFile(t, '## Goal\nno header\n'),
    writeTaskFile(t, taskText('monitiv-gateway', '', repo).replace('id: T9', 'id: ../x')),
    writeTaskFile(t, taskText('monitiv-gateway', '', repo), 'brief task '),
  ];
  for (const file of invalid) assert.equal(runCli(['developer', file]).code, 2, file);
});

test('CLI exits 1 when the task repo does not match the worktree', (t) => {
  const repo = makeTempRepo('monitiv-frontend', t);
  const { code, stderr } = runCli(['developer', writeTaskFile(t, taskText('monitiv-gateway', '', repo))]);
  assert.equal(code, 1);
  assert.match(stderr, /task says repo monitiv-gateway/);
});
