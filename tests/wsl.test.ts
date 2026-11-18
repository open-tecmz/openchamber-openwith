import { expect, test } from 'bun:test';
import { explorerHandoff, isWsl } from '../service/wsl.ts';

test('detects WSL using environment or kernel, not generic Linux', () => {
  expect(isWsl({ WSL_DISTRO_NAME: 'Ubuntu' }, 'linux')).toBe(true);
  expect(isWsl({ WSL_INTEROP: '/run/WSL/1_interop' }, 'linux')).toBe(true);
  expect(isWsl({}, '6.18-microsoft-standard-WSL2')).toBe(true);
  expect(isWsl({}, '6.18-generic')).toBe(false);
});

test('only accepts Explorer exit 1 with no error output as a handoff', () => {
  expect(explorerHandoff(1, '')).toBe(true);
  expect(explorerHandoff(1, '  \n')).toBe(true);
  expect(explorerHandoff(1, 'Access denied')).toBe(false);
  expect(explorerHandoff(4, '')).toBe(false);
  expect(explorerHandoff(null, '')).toBe(false);
});
