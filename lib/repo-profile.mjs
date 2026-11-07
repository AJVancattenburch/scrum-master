import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { git } from './git.mjs';

const PROFILES_PATH = fileURLToPath(new URL('../config/repos.json', import.meta.url));

export function repoNameFromRemote(url) {
  const match = /([^/:]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (!match) throw new Error(`cannot read a repo name from remote "${url.trim()}"`);
  return match[1];
}

export function loadProfiles() {
  const raw = readFileSync(PROFILES_PATH, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`invalid JSON in ${PROFILES_PATH}`, { cause: err });
  }
}

export function resolveProfile(worktree, profiles = loadProfiles()) {
  const name = repoNameFromRemote(git(worktree, ['remote', 'get-url', 'origin']));
  const profile = profiles[name];
  if (!profile) throw new Error(`no profile for repo "${name}" in config/repos.json; known: ${Object.keys(profiles).join(', ')}`);
  return { name, ...profile };
}
