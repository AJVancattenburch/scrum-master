import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditDiff, blockingFindings, parseAddedLines } from '../lib/diff-audit.mjs';

const diff = (file, start, lines) =>
  [`+++ b/${file}`, `@@ -0,0 +${start},${lines.length} @@`, ...lines.map((l) => `+${l}`)].join('\n');

test('parseAddedLines tracks new-file line numbers per hunk', () => {
  const files = parseAddedLines(diff('a.ts', 10, ['x', 'y']));
  assert.deepEqual(files.get('a.ts'), [{ line: 10, text: 'x' }, { line: 11, text: 'y' }]);
});

test('a multi-line comment block blocks', () => {
  const findings = auditDiff(diff('a.svelte', 1, ['  /** one', '   *  two', '   *  three */', 'const x = 1;']));
  assert.equal(blockingFindings(findings).length, 1);
  assert.equal(findings[0].kind, 'comment-block');
  assert.equal(findings[0].lines, 3);
});

test('a lone PHI tag is not reported', () => {
  assert.deepEqual(auditDiff(diff('a.ts', 1, ['// DATA CLASSIFICATION: PHI', 'export const x = 1;'])), []);
});

test('a single short comment is reported but does not block', () => {
  const findings = auditDiff(diff('a.ts', 1, ['// why: upstream bug', 'x();']));
  assert.equal(findings.length, 1);
  assert.deepEqual(blockingFindings(findings), []);
});

test('file growth over the limit blocks; non-code files are ignored', () => {
  const big = Array.from({ length: 5 }, (_, i) => `const v${i} = ${i};`);
  assert.equal(auditDiff(diff('a.ts', 1, big), { maxCommentRun: 2, maxFileGrowth: 4 })[0].kind, 'growth');
  assert.deepEqual(auditDiff(diff('notes.md', 1, ['// not code', '// still not', '// nope'])), []);
});

test('an unparseable hunk header throws', () => {
  assert.throws(() => parseAddedLines('+++ b/a.ts\n@@ garbage @@'), /unparseable hunk header/);
});
