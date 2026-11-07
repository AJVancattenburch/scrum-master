export class CommandError extends Error {
  constructor(cmd, args, cause) {
    super(`${cmd} ${args.join(' ')} failed: ${cause.stderr?.toString().trim() || cause.message}`);
    this.name = 'CommandError';
    this.code = cause.code;
    // Sync callers carry the exit code in `status`, async ones in `code`; null means it never ran.
    this.status = cause.status ?? (Number.isInteger(cause.code) ? cause.code : null);
  }
}
