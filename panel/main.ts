/**
 * OpenChamber Open With — rail panel (and full-screen page).
 *
 * The panel lists the apps a project can be opened with and calls the local
 * service to start the one the user clicks. Which apps are installed is the
 * service's answer (it can look at the filesystem and PATH); the catalog and the
 * icons come from the shared `src/apps.ts` / `src/icons.ts`.
 *
 * Installed apps show in their brand colour and open the project when clicked;
 * the rest are greyed out. Detection is cached by the service, so a Refresh
 * re-checks the machine.
 *
 * Panel copy follows the OpenChamber language (`ctx.locale`); see `src/i18n.ts`.
 */

import { HostRequestError, connectHost, type HostClient } from '@openchamber/sdk';
import {
  applyHostReady,
  mountBadge,
  mountBanner,
  mountButton,
  mountEmpty,
  mountSpinner,
} from '@openchamber/sdk/ui';

import { appName, appsForOS, type OpenApp, type OpenAppOS } from '../src/apps.ts';
import { APP_ICONS } from '../src/icons.ts';
import { createTranslator, type Translator } from '../src/i18n.ts';

const host: HostClient = connectHost({ requestTimeoutMs: 25_000 });
const root = document.querySelector('#root') as HTMLElement;

/** Slow beat: only health detection while the service is off. */
const BEAT_MS = 5000;
/** While the service is off, retry the health check at this cadence. */
const DETECT_EVERY_MS = 5000;

type Mode = 'service' | 'off' | 'error' | 'unknown';

type ProjectRef = { directory: string; name: string };

type AppsAnswer = {
  ok: boolean;
  os: OpenAppOS;
  installed: Record<string, boolean>;
  at: number;
  error?: string;
};

let t: Translator = createTranslator('en');
let localeTag = 'en';
let mode: Mode = 'unknown';
let project: ProjectRef | null = null;
let directory: string | null = null;
let os: OpenAppOS = 'unknown';
let installed: Record<string, boolean> = {};
let appsLoaded = false;
let loadError: string | null = null;
/** App id currently being launched, so its tile shows a spinner. */
let openingApp: string | null = null;
let refreshing = false;
let renderKey = '';
let panelMounted = false;
let mounted = false;
let beatTimer: number | null = null;
let lastDetectAt = 0;

const disposables: Array<{ dispose: () => void }> = [];

// ---------------------------------------------------------------------------
// Service client
// ---------------------------------------------------------------------------

const service = {
  async json<T>(method: string, path: string, query?: Record<string, string>, body?: string): Promise<T> {
    const result = await host.serviceRequest({
      method: method as never,
      path,
      ...(query ? { query } : {}),
      ...(body ? { body } : {}),
    });
    return JSON.parse(result.body) as T;
  },
  async text(method: string, path: string): Promise<string> {
    const result = await host.serviceRequest({ method: method as never, path });
    return result.body;
  },
  health(): Promise<string> {
    return this.text('GET', '/health');
  },
  apps(refresh: boolean): Promise<AppsAnswer> {
    return this.json('GET', '/apps', refresh ? { refresh: '1' } : undefined);
  },
  open(directory: string, app: string): Promise<{ ok: boolean; error?: string }> {
    return this.json('POST', '/open', undefined, JSON.stringify({ directory, app }));
  },
};

const isNoService = (error: unknown): boolean =>
  error instanceof HostRequestError && (error.code === 'NO_SERVICE' || error.code === 'DISABLED');

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

const projectNameFor = (dir: string): string => dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;

const catalog = (): OpenApp[] => appsForOS(os);

const installedCount = (): number => catalog().filter((app) => installed[app.id] === true).length;

const modeLabel = (): string =>
  mode === 'service' ? t('mode.service') : mode === 'off' ? t('mode.off') : t('mode.unknown');

const modeTone = (): 'info' | 'error' | 'warning' | 'neutral' =>
  mode === 'service' ? 'info' : mode === 'error' ? 'error' : mode === 'off' ? 'warning' : 'neutral';

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const detectMode = async (): Promise<Mode> => {
  lastDetectAt = Date.now();
  try {
    await service.health();
    mode = 'service';
  } catch (error) {
    if (error instanceof HostRequestError) {
      if (error.code === 'NO_SERVICE' || error.code === 'DISABLED') mode = 'off';
      else if (error.code === 'SERVICE_FAILED') mode = 'error';
      else mode = 'unknown';
    } else {
      mode = 'unknown';
    }
  }
  return mode;
};

const handleServiceLost = async (): Promise<void> => {
  await detectMode();
  render();
};

/** Read the installed-app flags from the service and repaint. */
const loadApps = async (force: boolean): Promise<boolean> => {
  if (mode !== 'service') return false;
  try {
    const answer = await service.apps(force);
    os = answer.os;
    installed = answer.installed ?? {};
    appsLoaded = true;
    loadError = null;
    render();
    return true;
  } catch (error) {
    if (isNoService(error)) {
      await handleServiceLost();
      return false;
    }
    appsLoaded = true;
    loadError = error instanceof Error ? error.message : String(error);
    render();
    return false;
  }
};

const refresh = async (): Promise<void> => {
  if (refreshing || mode !== 'service') return;
  refreshing = true;
  render();
  try {
    await loadApps(true);
  } finally {
    refreshing = false;
    render();
  }
};

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

const openApp = async (app: OpenApp): Promise<void> => {
  if (mode !== 'service' || !directory || openingApp !== null) return;
  const name = appName(app, t);
  openingApp = app.id;
  render();
  try {
    const answer = await service.open(directory, app.id);
    if (!answer.ok) {
      const reason = answer.error ? ` · ${answer.error}` : '';
      await host.toast({ kind: 'error', message: `${t('toast.openFailed', { app: name })}${reason}` });
      return;
    }
    await host.toast({ kind: 'success', message: t('toast.opened', { app: name }) });
  } catch (error) {
    if (isNoService(error)) await handleServiceLost();
    else await host.toast({ kind: 'error', message: t('toast.openFailed', { app: name }) });
  } finally {
    openingApp = null;
    render();
  }
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const el = (tag: string, className?: string, text?: string): HTMLElement => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const clearDisposables = (): void => {
  while (disposables.length > 0) disposables.pop()?.dispose();
};

/** The 24×24 tile markup for one app: a brand-coloured square with its mark. */
const iconMarkup = (app: OpenApp): string => {
  const icon = APP_ICONS[app.icon];
  return (
    `<svg class="ow-icon" viewBox="0 0 24 24" aria-hidden="true" style="--ow-brand:${icon.color}">`
    + '<rect class="ow-icon-bg" width="24" height="24" rx="5.5"></rect>'
    + `<g transform="translate(12 12) scale(0.62) translate(-12 -12)">${icon.glyph}</g>`
    + '</svg>'
  );
};

const renderTile = (app: OpenApp): HTMLElement => {
  const isInstalled = installed[app.id] === true;
  const busy = openingApp === app.id;
  const name = appName(app, t);

  const tile = el('button', `ow-tile${isInstalled ? '' : ' ow-missing'}${busy ? ' ow-busy' : ''}`) as HTMLButtonElement;
  tile.type = 'button';
  tile.disabled = !isInstalled || openingApp !== null;
  tile.title = isInstalled ? t('open.ariaLabel', { app: name }) : `${name} · ${t('status.missing')}`;
  tile.setAttribute('aria-label', isInstalled ? t('open.ariaLabel', { app: name }) : `${name} · ${t('status.missing')}`);

  const iconWrap = tile.appendChild(el('span', 'ow-icon-wrap'));
  if (busy) disposables.push(mountSpinner(iconWrap, { size: 'sm' }));
  else iconWrap.innerHTML = iconMarkup(app);

  tile.appendChild(el('span', 'ow-name', name));
  tile.appendChild(el('span', 'ow-tile-status', isInstalled ? t('status.installed') : t('status.missing')));

  if (isInstalled) tile.addEventListener('click', () => void openApp(app));
  return tile;
};

const installedSignature = (): string =>
  Object.keys(installed).sort().map((id) => `${id}:${installed[id] ? 1 : 0}`).join(',');

const render = (): void => {
  if (!panelMounted) return;
  const key = JSON.stringify({
    localeTag,
    mode,
    directory,
    os,
    appsLoaded,
    loadError,
    installed: installedSignature(),
    openingApp,
    refreshing,
  });
  if (key === renderKey) return;
  renderKey = key;
  paint();
};

const paint = (): void => {
  clearDisposables();
  root.textContent = '';

  const apps = catalog();
  const available = installedCount();

  const header = root.appendChild(el('div', 'ow-header'));
  const titleRow = header.appendChild(el('div', 'ow-title-row'));
  titleRow.appendChild(el('span', 'ow-title', t('title')));
  titleRow.appendChild(el('span', 'ow-project', project?.name ?? t('noProject')));
  disposables.push(mountBadge(titleRow, { label: modeLabel(), tone: modeTone() }));

  const countsRow = header.appendChild(el('div', 'ow-counts'));
  if (mode === 'service' && appsLoaded) {
    disposables.push(mountBadge(countsRow, {
      label: available > 0 ? t('count.available', { n: available }) : t('count.none'),
      tone: available > 0 ? 'info' : 'warning',
    }));
  } else if (mode === 'service') {
    disposables.push(mountBadge(countsRow, { label: t('count.detecting'), tone: 'neutral' }));
  }
  countsRow.appendChild(el('span', 'ow-spacer'));
  disposables.push(mountButton(countsRow, {
    label: t('refresh'),
    size: 'xs',
    variant: 'outline',
    loading: refreshing,
    disabled: mode !== 'service',
    onClick: () => void refresh(),
  }));

  if (mode === 'off') {
    disposables.push(mountBanner(root, { tone: 'warning', title: t('banner.off.title'), body: t('banner.off.body') }));
  } else if (mode === 'error' || mode === 'unknown') {
    disposables.push(mountBanner(root, { tone: 'error', title: t('banner.error.title'), body: t('banner.error.body') }));
  }

  if (!project || !directory) {
    disposables.push(mountEmpty(root, { title: t('empty.noProject.title'), body: t('empty.noProject.body') }));
    return;
  }

  if (mode !== 'service') return;

  if (!appsLoaded) {
    const loading = root.appendChild(el('div', 'ow-loading'));
    disposables.push(mountSpinner(loading, { label: t('detecting') }));
    return;
  }

  if (loadError) {
    disposables.push(mountBanner(root, { tone: 'error', title: t('toast.loadFailed'), body: loadError }));
  }

  if (apps.length === 0) {
    disposables.push(mountEmpty(root, { title: t('empty.none.title'), body: t('empty.none.body') }));
    return;
  }

  if (available === 0) {
    disposables.push(mountBanner(root, { tone: 'info', title: t('empty.none.title'), body: t('empty.none.body') }));
  }

  // Installed apps come first; each group keeps its catalog order.
  const ordered = [...apps].sort(
    (a, b) => Number(installed[b.id] === true) - Number(installed[a.id] === true),
  );
  const grid = root.appendChild(el('div', 'ow-grid'));
  for (const app of ordered) grid.appendChild(renderTile(app));
};

// ---------------------------------------------------------------------------
// Beat: health detection only
// ---------------------------------------------------------------------------

const beat = async (): Promise<void> => {
  if (!panelMounted || !directory) return;
  if (mode === 'service') return;
  if (Date.now() - lastDetectAt <= DETECT_EVERY_MS) return;
  const next = await detectMode();
  if (next === 'service') await loadApps(false);
  render();
};

const startBeat = (): void => {
  if (beatTimer !== null) window.clearInterval(beatTimer);
  beatTimer = window.setInterval(() => void beat(), BEAT_MS);
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const switchDirectory = async (next: string | null): Promise<void> => {
  directory = next;
  project = next ? { directory: next, name: projectNameFor(next) } : null;
  render();
  if (next && mode !== 'service') {
    const nextMode = await detectMode();
    if (nextMode === 'service' && !appsLoaded) await loadApps(false);
    render();
  }
};

const preparePanel = async (): Promise<void> => {
  await detectMode();
  render();
  if (mode === 'service') await loadApps(false);
  render();
  startBeat();
};

host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  localeTag = ctx.locale;
  t = createTranslator(ctx.locale);
  document.documentElement.lang = ctx.locale;
  document.body.dataset.surface = ctx.surface;

  if (!mounted) {
    mounted = true;
    panelMounted = true;
    directory = ctx.directory;
    project = ctx.directory ? { directory: ctx.directory, name: projectNameFor(ctx.directory) } : null;
    void preparePanel();
    return;
  }
  if (ctx.directory !== directory) void switchDirectory(ctx.directory);
});

host.onDirectory((next) => {
  if (!panelMounted) return;
  if (next === directory) return;
  void switchDirectory(next);
});
