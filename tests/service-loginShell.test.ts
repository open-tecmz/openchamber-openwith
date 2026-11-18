import { expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('login-shell detection and launching use the same environment, with separate caches', async () => {
  if (spawnSync('/usr/bin/zsh', ['--version']).error) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'openwith-service-'));
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(path.join(bin, 'code'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(path.join(dir, '.zprofile'), `export PATH="${bin}:$PATH"\n`);
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const token = crypto.randomUUID();
  const child = spawn(process.execPath, ['dist/service/main.js'], {
    env: {
      PATH: '/usr/bin:/bin', HOME: dir, ZDOTDIR: dir, SHELL: '/usr/bin/zsh',
      OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: token,
      OPENCHAMBER_OPENWITH_DRY_RUN: '1',
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
      child.once('exit', (code) => reject(new Error(`Service exited early: ${code}`)));
    });
    const request = (route: string, body?: object) => fetch(`http://127.0.0.1:${port}${route}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    expect((await (await request('/apps')).json()).installed.vscode).toBe(false);
    expect((await (await request('/apps?loginShell=1')).json()).installed.vscode).toBe(true);
    expect((await (await request('/apps')).json()).installed.vscode).toBe(false);
    expect((await request('/open', { directory: dir, app: 'vscode' })).status).toBe(409);
    expect((await request('/open', { directory: dir, app: 'vscode', loginShell: true })).status).toBe(200);
    expect(logs).toContain('"file":"/usr/bin/zsh"');
    expect(logs).toContain('"-lc"');
  } finally {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
    rmSync(dir, { recursive: true, force: true });
  }
}, 15000);
