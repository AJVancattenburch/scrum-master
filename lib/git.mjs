import { execFileSync } from 'node:child_process';
import { CommandError } from './command-error.mjs';

export function git(cwd, args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    throw new CommandError('git', args, err);
  }
}
