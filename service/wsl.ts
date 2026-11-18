import { execFile } from 'node:child_process';
import { release } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const isWsl = (env: NodeJS.ProcessEnv = process.env, kernel = release()): boolean =>
  Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP || /microsoft/i.test(kernel));

/** Explorer uses Windows paths, including UNC paths for the WSL filesystem. */
export const explorerDirectory = async (directory: string): Promise<string> => {
  const { stdout } = await execFileAsync('wslpath', ['-aw', directory], {
    timeout: 5000,
    maxBuffer: 64 * 1024,
    encoding: 'utf8',
  });
  const converted = stdout.replace(/[\r\n]+$/, '');
  if (!converted || /[\r\n\0]/.test(converted)) throw new Error('wslpath returned an invalid path');
  return converted;
};

/**
 * Explorer can return 1 after handing a folder to its existing desktop process.
 * Only tolerate that result for the explicit WSL Explorer plan, with no error
 * output. Never reinterpret xdg-open's generic failure code as success.
 */
export const explorerHandoff = (code: number | null, stderr: string): boolean =>
  code === 1 && stderr.trim() === '';
