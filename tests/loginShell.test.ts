import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loginShellCommand } from '../service/loginShell.ts';

test('uses -lc, not interactive mode, and keeps arguments out of shell source', () => {
  const directory = '/tmp/project with spaces/$(touch unsafe); "quoted"';
  expect(loginShellCommand('codium', [directory], '/bin/zsh')).toEqual({
    file: '/bin/zsh',
    args: ['-lc', 'exec "$@"', 'openwith', 'codium', directory],
  });
});

test('rejects unsupported shells rather than guessing their syntax', () => {
  expect(() => loginShellCommand('codium', [], '/bin/fish')).toThrow();
  expect(() => loginShellCommand('codium', [], 'zsh')).toThrow();
});

test('loads login initialization without loading interactive initialization', () => {
  const shell = '/usr/bin/zsh';
  if (spawnSync(shell, ['--version']).error) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'openwith-shell-'));
  try {
    writeFileSync(path.join(dir, '.zprofile'), 'export OPENWITH_PROFILE=loaded\n');
    writeFileSync(path.join(dir, '.zshrc'), 'export OPENWITH_INTERACTIVE=loaded\n');
    const argument = 'spaces; $(printf injected) "quotes" & \'apostrophe\'';
    const plan = loginShellCommand(process.execPath, [
      '-e',
      'console.log(JSON.stringify([process.env.OPENWITH_PROFILE, process.env.OPENWITH_INTERACTIVE, process.argv[1]]))',
      argument,
    ], shell);
    const result = spawnSync(plan.file, plan.args, {
      env: { PATH: '/usr/bin:/bin', HOME: dir, ZDOTDIR: dir },
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(['loaded', null, argument]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
