/**
 * Rolling file log for the Open With service.
 *
 * The service runs on the user's own machine, so when opening an app misbehaves
 * there is nothing to look at afterwards. Every line is written to
 * `~/.config/openchamber-openwith/logs/service.log` as well as stderr; the file
 * rolls at 10 MB and keeps a few previous files (`service.log.1`, `.2`, …), so a
 * problem can be read long after it happened.
 *
 * Logging is best-effort: a failed write never breaks a request.
 */

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const LOG_DIR = path.join(os.homedir(), '.config', 'openchamber-openwith', 'logs');
export const LOG_FILE = path.join(LOG_DIR, 'service.log');

/** Roll once the file would grow past this. */
const MAX_BYTES = 10 * 1024 * 1024;
/** Previous files kept: `service.log.1` … `service.log.N`. */
const MAX_BACKUPS = 3;

/** Current file size; -1 until the first write measures it. */
let size = -1;
/** Serialises writes so two lines never interleave. */
let queue: Promise<void> = Promise.resolve();

const rotate = async (): Promise<void> => {
  for (let i = MAX_BACKUPS - 1; i >= 1; i -= 1) {
    await fsp.rename(`${LOG_FILE}.${i}`, `${LOG_FILE}.${i + 1}`).catch(() => undefined);
  }
  await fsp.rename(LOG_FILE, `${LOG_FILE}.1`).catch(() => undefined);
};

const append = async (line: string): Promise<void> => {
  try {
    if (size < 0) {
      await fsp.mkdir(LOG_DIR, { recursive: true });
      size = (await fsp.stat(LOG_FILE).catch(() => null))?.size ?? 0;
    }
    const bytes = Buffer.byteLength(line);
    if (size + bytes > MAX_BYTES) {
      await rotate();
      size = 0;
    }
    await fsp.appendFile(LOG_FILE, line);
    size += bytes;
  } catch {
    // best-effort: never break a request over a log line
  }
};

/** Write one line to stderr and the rolling log file. */
export const log = (message: string): void => {
  const line = `${new Date().toISOString()} ${message}\n`;
  process.stderr.write(`[openwith] ${message}\n`);
  queue = queue.then(() => append(line));
};
