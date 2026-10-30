#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDiff } from '../lib/pixel-diff.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [feature, localUrl] = process.argv.slice(2);
if (!feature || !localUrl) {
  console.error('usage: pixel-diff.mjs <feature> <localUrl>');
  process.exit(1);
}
try {
  const results = await runDiff({ featureDir: path.join(root, 'artifacts', feature), localUrl });
  for (const { viewport, ratio, pass, diffPath, source } of results) {
    console.log(`${viewport}  ${(ratio * 100).toFixed(4)}%  ${pass ? 'PASS' : 'FAIL'}  ${path.relative(root, diffPath)}${source === 'baseline' ? '  (baseline)' : ''}`);
  }
  if (!results.every(({ pass }) => pass)) process.exitCode = 1;
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
