import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditDiff, auditReport, auditWorktree, blockingFindings, formatFinding, parseAddedLines } from '../lib/diff-audit.mjs';
import { loadProfiles } from '../lib/repo-profile.mjs';
import { commitFile, makeTempRepo } from './helpers/temp-repo.mjs';

const profiles = loadProfiles();
const FE = profiles['monitiv-frontend'].audit;
const GO = profiles['monitiv-gateway'].audit;

const diff = (file, start, lines) =>
  [`+++ b/${file}`, `@@ -0,0 +${start},${lines.length} @@`, ...lines.map((l) => `+${l}`)].join('\n');

test('parseAddedLines tracks new-file line numbers per hunk', () => {
  assert.deepEqual(parseAddedLines(diff('a.ts', 10, ['x', 'y'])).get('a.ts'), [{ line: 10, text: 'x' }, { line: 11, text: 'y' }]);
});

test('a multi-line comment block blocks', () => {
  const findings = auditDiff(diff('a.svelte', 1, ['  /** one', '   *  two', '   *  three */', 'const x = 1;']), FE);
  assert.equal(blockingFindings(findings).length, 1);
  assert.equal(findings[0].kind, 'comment-block');
  assert.equal(findings[0].lines, 3);
});

test('a lone PHI tag is exempt in either casing', () => {
  assert.deepEqual(auditDiff(diff('a.ts', 1, ['// DATA CLASSIFICATION: PHI', 'export const x = 1;']), FE), []);
  assert.deepEqual(auditDiff(diff('a.go', 1, ['// Data classification: PHI', 'var x = 1']), GO), []);
});

test('a single short comment is reported but does not block', () => {
  const findings = auditDiff(diff('a.ts', 1, ['// why: upstream bug', 'x();']), FE);
  assert.equal(findings.length, 1);
  assert.deepEqual(blockingFindings(findings), []);
});

test('Go doc comment blocks and Go growth count under the gateway profile', () => {
  const doc = ['// Foo does a thing.', '// It does it well.', '// Really well.', 'func Foo() {}'];
  assert.equal(blockingFindings(auditDiff(diff('a.go', 1, doc), GO))[0].kind, 'comment-block');
  const big = Array.from({ length: 5 }, (_, i) => `var v${i} = ${i}`);
  assert.equal(auditDiff(diff('a.go', 1, big), { ...GO, maxFileGrowth: 4 })[0].kind, 'growth');
});

test('growth counts net lines, so rewriting existing lines does not grow a file', () => {
  const rewrite = ['diff --git a/a.go b/a.go', '--- a/a.go', '+++ b/a.go', '@@ -1,5 +1,5 @@',
    ...Array.from({ length: 5 }, (_, i) => `-var v${i} = 0`), ...Array.from({ length: 5 }, (_, i) => `+var v${i} = 1`)].join('\n');
  assert.deepEqual(auditDiff(rewrite, { ...GO, maxFileGrowth: 4 }), []);
  const grown = rewrite.replace('@@ -1,5 +1,5 @@', '@@ -1,5 +1,10 @@') + '\n' + Array.from({ length: 5 }, (_, i) => `+var w${i} = 1`).join('\n');
  assert.deepEqual(auditDiff(grown, { ...GO, maxFileGrowth: 4 }).map((f) => [f.kind, f.lines]), [['growth', 5]]);
});

test('a profile\'s generated files get no comment or growth findings', () => {
  const api = 'packages/api-client/src/types/api.ts';
  const lines = ['/** one', ' * two', ' * three */', ...Array(FE.maxFileGrowth).fill('x: string;')];
  assert.deepEqual(auditDiff(diff(api, 1, lines), FE), []);
  assert.equal(auditDiff(diff('packages/api-client/src/insight.ts', 1, lines), FE).length, 2);
});

test('each profile ignores the other repo\'s file types and non-code files', () => {
  const block = ['// one', '// two', '// three'];
  assert.deepEqual(auditDiff(diff('a.go', 1, block), FE), []);
  assert.deepEqual(auditDiff(diff('a.ts', 1, block), GO), []);
  assert.deepEqual(auditDiff(diff('notes.md', 1, block), FE), []);
});

test('an unparseable hunk header throws', () => {
  assert.throws(() => parseAddedLines('+++ b/a.ts\n@@ garbage @@'), /unparseable hunk header/);
});

test('auditWorktree diffs HEAD against origin/<baseBranch>', (t) => {
  const repo = makeTempRepo('monitiv-frontend', t);
  commitFile(repo, 'a.ts', '// one\n// two\n// three\nexport const x = 1;\n');
  const findings = auditWorktree(repo, profiles['monitiv-frontend']);
  assert.equal(formatFinding(findings[0]), 'comment-block\ta.ts:1\t3\t// one');
});

test('auditReport returns the blocking findings and every finding formatted', (t) => {
  const repo = makeTempRepo('monitiv-frontend', t);
  commitFile(repo, 'a.ts', '// one\n// two\n// three\nexport const x = 1;\n// why\n');
  const { blocking, text } = auditReport(repo, profiles['monitiv-frontend']);
  assert.deepEqual(blocking.map((f) => f.kind), ['comment-block']);
  assert.equal(text, 'comment-block\ta.ts:1\t3\t// one\ncomment\ta.ts:5\t1\t// why');
});

test('auditReport lists blocking findings before single comments', (t) => {
  const repo = makeTempRepo('monitiv-frontend', t);
  commitFile(repo, 'a.ts', '// why\nexport const x = 1;\n// one\n// two\n// three\n');
  const { text } = auditReport(repo, profiles['monitiv-frontend']);
  assert.equal(text, 'comment-block\ta.ts:3\t3\t// one\ncomment\ta.ts:1\t1\t// why');
});

test('codeExtensions are escaped so "." only matches a literal dot', () => {
  const audit = { codeExtensions: ['t.s'], maxCommentRun: 2, maxFileGrowth: 200, phiTag: 'data classification' };
  assert.deepEqual(auditDiff(diff('file.tXs', 1, ['// one', '// two', '// three']), audit), []);
  assert.equal(auditDiff(diff('file.t.s', 1, ['// one', '// two', '// three']), audit).length, 1);
});

test('phiTag is escaped so "." only matches a literal dot, and must follow the comment marker', () => {
  const dotAudit = { ...FE, phiTag: 'a.b' };
  assert.deepEqual(auditDiff(diff('x.ts', 1, ['// a.b']), dotAudit), []);
  assert.equal(auditDiff(diff('x.ts', 1, ['// axb']), dotAudit).length, 1);
  assert.equal(auditDiff(diff('x.ts', 1, ['// TODO data classification later']), FE).length, 1);
});
