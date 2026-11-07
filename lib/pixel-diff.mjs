import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';
import { readJson } from './read-json.mjs';

const DEFAULTS = { viewports: [{ width: 1440, height: 900 }, { width: 390, height: 844 }], threshold: 0.001, hide: [], remove: [], navigate: [] };

function sized(png) {
  const { width, height } = PNG.sync.read(png);
  return { png, width, height };
}

export function comparePngs(bufA, bufB, { threshold }) {
  const a = PNG.sync.read(bufA);
  const b = PNG.sync.read(bufB);
  if (a.width !== b.width || a.height !== b.height) throw new Error(`size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  const diff = new PNG({ width: a.width, height: a.height });
  const mismatched = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  const ratio = mismatched / (a.width * a.height);
  return { mismatched, ratio, pass: ratio <= threshold, diffPng: PNG.sync.write(diff) };
}

async function largestIframe(page) {
  let largest = null;
  let largestArea = 0;
  for (const frame of await page.locator('iframe').all()) {
    const box = await frame.boundingBox();
    const area = box ? box.width * box.height : 0;
    if (area > largestArea) [largest, largestArea] = [frame, area];
  }
  return largest;
}

// The artifact may render inside an iframe, so the mask goes into every frame.
async function hideSelectors(page, hide, remove) {
  if (!hide.length && !remove.length) return;
  const rules = [];
  if (hide.length) rules.push(`${hide.join(',')}{visibility:hidden !important}`);
  if (remove.length) rules.push(`${remove.join(',')}{display:none !important}`);
  const content = rules.join('');
  for (const frame of page.frames()) await frame.addStyleTag({ content });
}

// Prototypes keep their route in memory, so non-default pages are reached by clicking through.
export async function captureArtifact(page, url, { hide = [], remove = [], navigate = [] } = {}) {
  await page.goto(url, { waitUntil: 'networkidle' });
  const iframe = await largestIframe(page);
  const scope = iframe ? iframe.contentFrame() : page;
  for (const selector of navigate) await scope.locator(selector).first().click();
  await hideSelectors(page, hide, remove);
  return sized(await (iframe ?? page).screenshot());
}

export async function captureLocal(page, url, { width, height }, { hide = [], remove = [] } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'networkidle' });
  await hideSelectors(page, hide, remove);
  return page.screenshot();
}

async function artifactOrBaseline(page, link, viewport, baselinePath, steps) {
  await page.setViewportSize(viewport);
  let artifact;
  try {
    artifact = await captureArtifact(page, link, steps);
  } catch (err) {
    if (!existsSync(baselinePath)) throw new Error(`artifact unreachable and no baseline: ${link}`, { cause: err });
    return { ...sized(await readFile(baselinePath)), source: 'baseline' };
  }
  if (!existsSync(baselinePath)) await writeFile(baselinePath, artifact.png);
  return { ...artifact, source: 'live' };
}

async function diffViewport(page, { featureDir, link, localUrl, viewport, threshold, hide, remove, navigate }) {
  const name = `${viewport.width}x${viewport.height}`;
  const artifact = await artifactOrBaseline(page, link, viewport, path.join(featureDir, `baseline-${name}.png`), { hide, remove, navigate });
  const { ratio, pass, diffPng } = comparePngs(artifact.png, await captureLocal(page, localUrl, artifact, { hide, remove }), { threshold });
  const diffPath = path.join(featureDir, `diff-${name}.png`);
  await writeFile(diffPath, diffPng);
  return { viewport: name, ratio, pass, diffPath, source: artifact.source };
}

export async function runDiff({ featureDir, localUrl }) {
  const link = (await readFile(path.join(featureDir, 'link.txt'), 'utf8')).trim();
  const { viewports, threshold, hide, remove, navigate } = { ...DEFAULTS, ...readJson(path.join(featureDir, 'config.json'), {}) };
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const results = [];
    for (const viewport of viewports) results.push(await diffViewport(page, { featureDir, link, localUrl, viewport, threshold, hide, remove, navigate }));
    return results;
  } finally {
    await browser.close();
  }
}
