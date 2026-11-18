import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('WSL Explorer handoff succeeds while conversion and launcher failures remain errors', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'openwith-wsl-'));
  const bin = path.join(dir, 'bin');
  const project = path.join(dir, 'project with spaces & $(literal)');
  const record = path.join(dir, 'argument.txt');
  const converted = '\\\\wsl.localhost\\Test\\project with spaces & $(literal)';
  mkdirSync(bin);
  mkdirSync(project);
  const script = (name: string, source: string) =>
    writeFileSync(path.join(bin, name), `#!/bin/sh\n${source}\n`, { mode: 0o755 });
  script('wslpath', `printf '%s\\n' '${converted}'`);
  script('explorer.exe', 'printf "%s" "$1" > "$OPENWITH_TEST_RECORD"\nexit 1');
  script('xdg-open', 'exit 4');
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const token = crypto.randomUUID();
  const child = spawn(process.execPath, ['dist/service/main.js'], {
    env: {
      PATH: `${bin}:/usr/bin:/bin`, HOME: dir, WSL_DISTRO_NAME: 'Test',
      OPENWITH_TEST_RECORD: record,
      OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: token,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let logs = '';
  try {
    await new Promise<void>((resolve, reject) => {
      child.stderr.on('data', (chunk) => {
        logs += chunk;
        if (logs.includes('service started')) resolve();
      });
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`Early service exit: ${code}`)));
    });
    const request = (route: string, body?: object) => fetch(`http://127.0.0.1:${port}${route}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const open = () => request('/open', { app: 'file-manager', directory: project });
    expect((await (await request('/apps')).json()).installed['file-manager']).toBe(true);
    expect((await open()).status).toBe(200);
    expect(readFileSync(record, 'utf8')).toBe(converted);
    expect(logs).toContain('launching file-manager: explorer.exe');
    script('explorer.exe', 'echo "Access denied" >&2\nexit 1');
    expect((await open()).status).toBe(502);
    script('explorer.exe', 'exit 2');
    expect((await open()).status).toBe(502);
    script('wslpath', 'exit 7');
    expect((await open()).status).toBe(500);
    unlinkSync(path.join(bin, 'explorer.exe'));
    expect((await open()).status).toBe(502);
    expect(logs).toContain('exited with code 4');
  } finally {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
    rmSync(dir, { recursive: true, force: true });
  }
}, 15000);
