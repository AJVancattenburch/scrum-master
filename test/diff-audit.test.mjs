import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { addedLineCount, auditDiff, auditWorktree, blockingFindings, formatFinding, parseAddedLines } from '../lib/diff-audit.mjs';
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
  assert.equal(addedLineCount(repo, profiles['monitiv-frontend']), 4);
});

test('addedLineCount accepts an explicit base-ref, like auditWorktree', (t) => {
  const repo = makeTempRepo('monitiv-frontend', t);
  commitFile(repo, 'a.ts', 'const x = 1;\n');
  const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  commitFile(repo, 'b.ts', 'const y = 2;\nconst z = 3;\n');
  assert.equal(addedLineCount(repo, profiles['monitiv-frontend'], head), 2);
  assert.equal(addedLineCount(repo, profiles['monitiv-frontend']), 3);
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
