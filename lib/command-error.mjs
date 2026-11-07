export class CommandError extends Error {
  constructor(cmd, args, cause) {
    super(`${cmd} ${args.join(' ')} failed: ${cause.stderr?.toString().trim() || cause.message}`);
    this.name = 'CommandError';
    this.code = cause.code;
  }
}
