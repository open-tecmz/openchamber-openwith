import { describe, expect, test } from 'bun:test';
import { appsForOS, findApp } from '../src/apps.ts';
import { APP_ICONS } from '../src/icons.ts';
import manifest from '../package.json';

describe('VSCodium', () => {
  for (const os of ['macos', 'windows', 'linux'] as const) {
    test(`has its own entry and icon on ${os}`, () => {
      const app = findApp(os, 'vscodium');
      expect(app).toMatchObject({
        name: 'VSCodium',
        command: 'codium',
        icon: 'vscodium',
      });
      if (os === 'macos') {
        expect(app).toMatchObject({ macApp: 'VSCodium', preferCommand: true });
      }
      expect(findApp(os, 'vscode')?.command).toBe('code');
      expect(new Set(appsForOS(os).map(({ id }) => id)).size).toBe(appsForOS(os).length);
    });
  }

  test('uses a distinct coral mark and permits its launcher', () => {
    expect(APP_ICONS.vscodium.glyph).toContain('M11.583.54');
    expect(APP_ICONS.vscodium.glyph).not.toBe(APP_ICONS.vscode.glyph);
    expect(manifest.openchamber.contributes.service.permissions.exec).toContain('codium');
  });
});
