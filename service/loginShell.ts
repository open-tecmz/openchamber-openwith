import path from 'node:path';
import { userInfo } from 'node:os';

/** Only shells with the POSIX argument syntax used below are supported. */
export const loginShellCommand = (
  command: string,
  args: string[],
  shell = process.env.SHELL || userInfo().shell || '/bin/sh',
): { file: string; args: string[] } => {
  if (!path.isAbsolute(shell) || !['sh', 'bash', 'zsh', 'ksh', 'dash'].includes(path.basename(shell))) {
    throw new Error('Login shell requires sh, bash, zsh, ksh, or dash');
  }
  // Never interpolate app names or project paths into shell source. $0 is a
  // fixed label; the command and all its arguments are forwarded via "$@".
  return { file: shell, args: ['-lc', 'exec "$@"', 'openwith', command, ...args] };
};
