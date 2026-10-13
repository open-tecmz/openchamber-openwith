/**
 * The apps a project can be opened with, and the rules for detecting and
 * launching them.
 *
 * Shared by the rail panel (which draws the list) and the local service (which
 * detects what is installed and starts the app). The catalog is pure data, so
 * the service imports it without pulling in any panel code.
 *
 * Detection and launching differ per platform:
 *   - macOS: an app is present when its `.app` bundle sits in one of the usual
 *     locations; `open -a "<name>" <directory>` launches it.
 *   - Windows / Linux: an app is present when its command is on PATH; the
 *     command itself is run with the directory as its argument.
 */

import type { MessageKey } from './i18n.ts';

export type OpenAppOS = 'macos' | 'windows' | 'linux' | 'unknown';

/** Icons shipped by the panel; see `src/icons.ts`. */
export type AppIconId =
  | 'vscode'
  | 'cursor'
  | 'zed'
  | 'sublime-text'
  | 'textmate'
  | 'antigravity'
  | 'xcode'
  | 'android-studio'
  | 'powershell'
  | 'terminal'
  | 'iterm2'
  | 'ghostty'
  | 'warp'
  | 'file-manager';

export type OpenApp = {
  /** Stable id used on the wire and in the panel. */
  id: string;
  /** Brand name, shown when there is no localized label. */
  name: string;
  /** Localized label key, for names that are common nouns (Terminal, Finder). */
  labelKey?: MessageKey;
  icon: AppIconId;
  /** macOS: the application name handed to `open -a`. */
  macApp?: string;
  /** CLI binary used on Windows/Linux, and as a macOS fallback. */
  command?: string;
  /**
   * macOS: prefer `command <directory>` over `open -a`. Editor CLIs open the
   * folder in a running instance and raise its window, and they still work when
   * LaunchServices refuses to launch the app from a background process.
   */
  preferCommand?: boolean;
};

/** Apps offered on macOS, most common first. */
const MAC_APPS: OpenApp[] = [
  { id: 'vscode', name: 'Visual Studio Code', icon: 'vscode', macApp: 'Visual Studio Code', command: 'code', preferCommand: true },
  { id: 'cursor', name: 'Cursor', icon: 'cursor', macApp: 'Cursor', command: 'cursor', preferCommand: true },
  { id: 'zed', name: 'Zed', icon: 'zed', macApp: 'Zed', command: 'zed', preferCommand: true },
  { id: 'sublime-text', name: 'Sublime Text', icon: 'sublime-text', macApp: 'Sublime Text', command: 'subl', preferCommand: true },
  { id: 'textmate', name: 'TextMate', icon: 'textmate', macApp: 'TextMate' },
  { id: 'antigravity', name: 'Antigravity', icon: 'antigravity', macApp: 'Antigravity' },
  { id: 'xcode', name: 'Xcode', icon: 'xcode', macApp: 'Xcode' },
  { id: 'android-studio', name: 'Android Studio', icon: 'android-studio', macApp: 'Android Studio' },
  { id: 'iterm2', name: 'iTerm2', icon: 'iterm2', macApp: 'iTerm' },
  { id: 'ghostty', name: 'Ghostty', icon: 'ghostty', macApp: 'Ghostty', command: 'ghostty' },
  { id: 'warp', name: 'Warp', icon: 'warp', macApp: 'Warp', command: 'warp' },
  { id: 'terminal', name: 'Terminal', labelKey: 'app.terminal', icon: 'terminal', macApp: 'Terminal' },
  { id: 'file-manager', name: 'Finder', labelKey: 'app.fileManager', icon: 'file-manager', macApp: 'Finder' },
];

/** Apps offered on Windows. */
const WINDOWS_APPS: OpenApp[] = [
  { id: 'vscode', name: 'Visual Studio Code', icon: 'vscode', command: 'code' },
  { id: 'cursor', name: 'Cursor', icon: 'cursor', command: 'cursor' },
  { id: 'zed', name: 'Zed', icon: 'zed', command: 'zed' },
  { id: 'sublime-text', name: 'Sublime Text', icon: 'sublime-text', command: 'subl' },
  { id: 'powershell', name: 'PowerShell', icon: 'powershell', command: 'powershell' },
  { id: 'file-manager', name: 'File Explorer', labelKey: 'app.fileManager', icon: 'file-manager', command: 'explorer' },
];

/** Apps offered on Linux. */
const LINUX_APPS: OpenApp[] = [
  { id: 'vscode', name: 'Visual Studio Code', icon: 'vscode', command: 'code' },
  { id: 'cursor', name: 'Cursor', icon: 'cursor', command: 'cursor' },
  { id: 'zed', name: 'Zed', icon: 'zed', command: 'zed' },
  { id: 'sublime-text', name: 'Sublime Text', icon: 'sublime-text', command: 'subl' },
  { id: 'file-manager', name: 'Files', labelKey: 'app.fileManager', icon: 'file-manager', command: 'xdg-open' },
];

/** The catalog for a platform; empty when the platform is not known. */
export const appsForOS = (os: OpenAppOS): OpenApp[] => {
  if (os === 'macos') return MAC_APPS;
  if (os === 'windows') return WINDOWS_APPS;
  if (os === 'linux') return LINUX_APPS;
  return [];
};

export const findApp = (os: OpenAppOS, id: string): OpenApp | null =>
  appsForOS(os).find((app) => app.id === id) ?? null;

/** The name a tile shows: the localized label when there is one, else the brand. */
export const appName = (app: OpenApp, translate: (key: MessageKey) => string): string =>
  app.labelKey ? translate(app.labelKey) : app.name;
