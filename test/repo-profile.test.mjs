import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProfiles, repoNameFromRemote, resolveProfile } from '../lib/repo-profile.mjs';
import { makeTempRepo } from './helpers/temp-repo.mjs';

test('repoNameFromRemote reads ssh and https remotes', () => {
  assert.equal(repoNameFromRemote('git@github.com:org/monitiv-frontend.git\n'), 'monitiv-frontend');
  assert.equal(repoNameFromRemote('https://github.com/org/monitiv-gateway'), 'monitiv-gateway');
});

test('repoNameFromRemote handles a trailing slash and an scp remote with no .git', () => {
  assert.equal(repoNameFromRemote('https://github.com/org/monitiv-frontend/'), 'monitiv-frontend');
  assert.equal(repoNameFromRemote('git@github.com:org/monitiv-gateway'), 'monitiv-gateway');
});

test('every profile has the fields the scripts rely on', () => {
  for (const [name, p] of Object.entries(loadProfiles())) {
    assert.ok(p.baseBranch && p.readFirst.length && p.gates.length && p.verification.length, name);
    assert.equal(typeof p.pixelDiff, 'boolean', name);
    assert.ok(p.audit.codeExtensions.length && p.audit.phiTag, name);
  }
});

test('gate tools are pinned to the version the repo CI runs, never @latest', () => {
  for (const [name, p] of Object.entries(loadProfiles())) {
    for (const g of p.gates) assert.ok(!g.cmd.some((arg) => arg.endsWith('@latest')), `${name} ${g.name}`);
  }
  assert.ok(loadProfiles()['monitiv-gateway'].gates.some((g) => g.cmd.includes('@redocly/cli@2.5.0')));
});

test('the frontend profile reads the repo PR template first', () => {
  assert.ok(loadProfiles()['monitiv-frontend'].readFirst.includes('.github/pull_request_template.md'));
});

test('resolveProfile picks the profile named by the origin remote', (t) => {
  const profile = resolveProfile(makeTempRepo('monitiv-gateway', t));
  assert.equal(profile.name, 'monitiv-gateway');
  assert.equal(profile.pixelDiff, false);
});

test('an unknown repo throws instead of falling back', (t) => {
  assert.throws(() => resolveProfile(makeTempRepo('some-other-repo', t)), /no profile for repo "some-other-repo"/);
});
