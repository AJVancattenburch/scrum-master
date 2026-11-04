import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { comparePngs, runDiff } from '../lib/pixel-diff.mjs';

const fixture = (name) => new URL(`fixtures/${name}`, import.meta.url).href;

function solidPng(width, height, paint = () => [255, 255, 255]) {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) png.data.set([...paint(i), 255], i * 4);
  return PNG.sync.write(png);
}

function featureDir({ link = fixture('artifact.html'), config } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pixel-diff-'));
  writeFileSync(path.join(dir, 'link.txt'), `${link}\n`);
  if (config) writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
  return dir;
}

const small = { viewports: [{ width: 400, height: 300 }], threshold: 0.001 };

test('comparePngs passes identical images', () => {
  const result = comparePngs(solidPng(10, 10), solidPng(10, 10), { threshold: 0 });
  assert.equal(result.mismatched, 0);
  assert.equal(result.pass, true);
  assert.equal(PNG.sync.read(result.diffPng).width, 10);
});

test('comparePngs counts differing pixels against the threshold', () => {
  const result = comparePngs(solidPng(10, 10), solidPng(10, 10, (i) => (i < 5 ? [0, 0, 0] : [255, 255, 255])), { threshold: 0.01 });
  assert.equal(result.mismatched, 5);
  assert.equal(result.ratio, 0.05);
  assert.equal(result.pass, false);
});

test('comparePngs rejects a size mismatch', () => {
  assert.throws(() => comparePngs(solidPng(10, 10), solidPng(10, 12), { threshold: 1 }), /^Error: size mismatch 10x10 vs 10x12$/);
});

test('runDiff passes the iframe content against itself and writes default-viewport baselines', async () => {
  const dir = featureDir();
  const results = await runDiff({ featureDir: dir, localUrl: fixture('inner.html') });
  assert.deepEqual(results.map(({ viewport, pass }) => [viewport, pass]), [['1440x900', true], ['390x844', true]]);
  for (const name of ['baseline-1440x900.png', 'baseline-390x844.png', 'diff-1440x900.png']) assert.ok(existsSync(path.join(dir, name)), name);
});

test('runDiff fails a shifted page', async () => {
  const [result] = await runDiff({ featureDir: featureDir({ config: small }), localUrl: fixture('shifted.html') });
  assert.equal(result.pass, false);
  assert.ok(result.ratio > 0.001);
});

test('runDiff falls back to the baseline when the artifact is unreachable', async () => {
  const dir = featureDir({ config: small });
  await runDiff({ featureDir: dir, localUrl: fixture('inner.html') });
  writeFileSync(path.join(dir, 'link.txt'), fixture('missing.html'));
  const [result] = await runDiff({ featureDir: dir, localUrl: fixture('inner.html') });
  assert.equal(result.pass, true);
  assert.equal(result.source, 'baseline');
});

test('runDiff throws when the artifact is unreachable and there is no baseline', async () => {
  const dir = featureDir({ link: fixture('missing.html'), config: small });
  await assert.rejects(runDiff({ featureDir: dir, localUrl: fixture('inner.html') }), /^Error: artifact unreachable and no baseline: file:.*missing\.html$/);
});

test('runDiff masks hide selectors in both captures', async () => {
  const link = fixture('badge.html');
  const [unmasked] = await runDiff({ featureDir: featureDir({ link, config: small }), localUrl: fixture('inner.html') });
  assert.equal(unmasked.pass, false);
  const [masked] = await runDiff({ featureDir: featureDir({ link, config: { ...small, hide: ['#badge'] } }), localUrl: fixture('inner.html') });
  assert.equal(masked.pass, true);
});

test('runDiff takes remove selectors out of the layout, where hide leaves their space', async () => {
  const link = fixture('flow.html');
  const localUrl = fixture('flow-extra.html');
  const [hidden] = await runDiff({ featureDir: featureDir({ link, config: { ...small, hide: ['#extra'] } }), localUrl });
  assert.equal(hidden.pass, false);
  const [removed] = await runDiff({ featureDir: featureDir({ link, config: { ...small, remove: ['#extra'] } }), localUrl });
  assert.equal(removed.pass, true);
});

test('runDiff clicks navigate selectors in order on the artifact only', async () => {
  const link = fixture('nav.html');
  const [unnavigated] = await runDiff({ featureDir: featureDir({ link, config: small }), localUrl: fixture('inner.html') });
  assert.equal(unnavigated.pass, false);
  const [navigated] = await runDiff({ featureDir: featureDir({ link, config: { ...small, navigate: ['#open', '#go'] } }), localUrl: fixture('inner.html') });
  assert.equal(navigated.pass, true);
});
