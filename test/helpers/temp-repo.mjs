import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const run = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

export function makeTempRepo(repoName) {
  const dir = mkdtempSync(path.join(tmpdir(), `${repoName}-`));
  run(dir, 'init', '-q', '-b', 'dev');
  run(dir, 'config', 'user.email', 'test@example.com');
  run(dir, 'config', 'user.name', 'test');
  run(dir, 'remote', 'add', 'origin', `git@example.com:org/${repoName}.git`);
  writeFileSync(path.join(dir, 'README.md'), 'base\n');
  run(dir, 'add', '.');
  run(dir, 'commit', '-q', '-m', 'base');
  run(dir, 'update-ref', 'refs/remotes/origin/dev', 'HEAD');
  return dir;
}

export function commitFile(dir, file, content) {
  writeFileSync(path.join(dir, file), content);
  run(dir, 'add', file);
  run(dir, 'commit', '-q', '-m', `add ${file}`);
}
