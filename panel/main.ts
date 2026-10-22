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
 * In the same grid as the apps the panel also shows the user's own **web
 * links**: URL templates such as `https://example.com/?path={path}` that are
 * filled with the project directory and handed to the host, which opens them in
 * the browser. They need no service, so they stay usable while it is off, and
 * they live in extension storage (`src/webLinks.ts` holds the templates and the
 * validation). Adding and editing happen in a modal over the panel.
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
  mountTextField,
} from '@openchamber/sdk/ui';

import { appName, appsForOS, type OpenApp, type OpenAppOS } from '../src/apps.ts';
import { APP_ICONS, WEB_LINK_ICON, type AppIcon } from '../src/icons.ts';
import { createTranslator, type Translator } from '../src/i18n.ts';
import {
  WEB_LINKS_KEY,
  WEB_LINKS_MAX,
  checkWebLink,
  fillWebLink,
  isHttpUrl,
  newWebLinkId,
  parseWebLinks,
  webLinkHost,
  webLinkLabel,
  type WebLink,
  type WebLinkIssue,
} from '../src/webLinks.ts';

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

/** The user's custom web links, read from and written to extension storage. */
let webLinks: WebLink[] = [];
let linksError: string | null = null;
/** The link editor's open draft, or null when it is closed. */
let linkDraft: LinkDraft | null = null;
/** A save or delete is in flight, so the section's controls are locked. */
let savingLink = false;

type LinkDraft = {
  /** The link being edited, or null while adding a new one. */
  id: string | null;
  name: string;
  url: string;
  /** What stopped the last save, shown under the URL field. */
  issue: WebLinkIssue | 'limit' | 'save' | null;
  /** The Delete button has been pressed once and waits for confirmation. */
  confirmDelete: boolean;
};

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
// Web links
// ---------------------------------------------------------------------------

/** Read the stored links. Storage is JSON, so `parseWebLinks` drops junk. */
const loadWebLinks = async (): Promise<void> => {
  try {
    webLinks = parseWebLinks(await host.storage.get(WEB_LINKS_KEY));
    linksError = null;
  } catch (error) {
    webLinks = [];
    linksError = error instanceof Error ? error.message : String(error);
  }
  render();
};

/** Write the whole list; on failure the previous list stays in place. */
const persistWebLinks = async (next: WebLink[]): Promise<boolean> => {
  try {
    await host.storage.set(WEB_LINKS_KEY, next.map(({ id, name, url }) => ({ id, name, url })));
    webLinks = next;
    linksError = null;
    return true;
  } catch {
    await host.toast({ kind: 'error', message: t('webLinks.error.save') });
    return false;
  }
};

const editWebLink = (link?: WebLink): void => {
  linkDraft = link
    ? { id: link.id, name: link.name, url: link.url, issue: null, confirmDelete: false }
    : { id: null, name: '', url: '', issue: null, confirmDelete: false };
  render();
};

/** Validate the draft, then add or update the link. */
const saveLinkDraft = async (): Promise<void> => {
  const draft = linkDraft;
  if (!draft || savingLink) return;
  const checked = checkWebLink(draft);
  if (!checked.ok) {
    draft.issue = checked.issue;
    render();
    return;
  }
  const editing = draft.id !== null && webLinks.some((link) => link.id === draft.id);
  if (!editing && webLinks.length >= WEB_LINKS_MAX) {
    draft.issue = 'limit';
    render();
    return;
  }
  const next = editing
    ? webLinks.map((link) =>
        link.id === draft.id ? { id: link.id, name: checked.name, url: checked.url } : link)
    : [...webLinks, { id: newWebLinkId(), name: checked.name, url: checked.url }];

  savingLink = true;
  render();
  const saved = await persistWebLinks(next);
  savingLink = false;
  if (saved) linkDraft = null;
  else if (linkDraft) linkDraft.issue = 'save';
  render();
};

const deleteWebLink = async (id: string): Promise<void> => {
  if (savingLink) return;
  savingLink = true;
  render();
  const saved = await persistWebLinks(webLinks.filter((link) => link.id !== id));
  savingLink = false;
  if (saved && linkDraft?.id === id) linkDraft = null;
  render();
};

/** Fill the template with the project directory and let the host open it. */
const openWebLink = async (link: WebLink): Promise<void> => {
  if (!directory) return;
  const url = fillWebLink(link.url, directory);
  if (!isHttpUrl(url)) {
    await host.toast({ kind: 'error', message: t('toast.linkInvalid') });
    return;
  }
  try {
    await host.openUrl(url);
  } catch {
    await host.toast({ kind: 'error', message: t('toast.linkFailed', { name: webLinkLabel(link) }) });
  }
};

const linkIssueText = (issue: WebLinkIssue | 'limit' | 'save'): string => {
  switch (issue) {
    case 'empty-url':
      return t('webLinks.error.empty');
    case 'invalid-url':
      return t('webLinks.error.invalid');
    case 'unknown-placeholder':
      return t('webLinks.error.placeholder');
    case 'too-long':
      return t('webLinks.error.tooLong');
    case 'limit':
      return t('webLinks.error.limit', { n: WEB_LINKS_MAX });
    default:
      return t('webLinks.error.save');
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

/** The 24×24 tile markup for one icon: a coloured square with its mark on top. */
const iconMarkup = (icon: AppIcon): string =>
  `<svg class="ow-icon" viewBox="0 0 24 24" aria-hidden="true" style="--ow-brand:${icon.color}">`
  + '<rect class="ow-icon-bg" width="24" height="24" rx="5.5"></rect>'
  + `<g transform="translate(12 12) scale(0.62) translate(-12 -12)">${icon.glyph}</g>`
  + '</svg>';

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
  else iconWrap.innerHTML = iconMarkup(APP_ICONS[app.icon]);

  tile.appendChild(el('span', 'ow-name', name));
  tile.appendChild(el('span', 'ow-tile-status', isInstalled ? t('status.installed') : t('status.missing')));

  if (isInstalled) tile.addEventListener('click', () => void openApp(app));
  return tile;
};

const installedSignature = (): string =>
  Object.keys(installed).sort().map((id) => `${id}:${installed[id] ? 1 : 0}`).join(',');

/** A pencil for a tile's edit control; the mark is drawn in the theme's colour. */
const PENCIL_ICON =
  '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">'
  + '<path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z"/>'
  + '</svg>';

/** A cross for the dialog's close control. */
const CLOSE_ICON =
  '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">'
  + '<path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
  + '</svg>';

/** One saved link, drawn as a grid tile with an edit control in its corner. */
const renderLinkTile = (link: WebLink): HTMLElement => {
  const label = webLinkLabel(link);
  const tile = el('div', `ow-tile ow-link-tile${linkDraft?.id === link.id ? ' ow-editing' : ''}`);

  const open = tile.appendChild(el('button', 'ow-link-hit')) as HTMLButtonElement;
  open.type = 'button';
  open.title = t('webLinks.open', { name: label });
  open.setAttribute('aria-label', t('webLinks.open', { name: label }));
  open.disabled = savingLink;
  const iconWrap = open.appendChild(el('span', 'ow-icon-wrap'));
  iconWrap.innerHTML = iconMarkup(WEB_LINK_ICON);
  open.appendChild(el('span', 'ow-name', label));
  open.appendChild(el('span', 'ow-tile-status ow-link-host', webLinkHost(link.url) || link.url));
  open.addEventListener('click', () => void openWebLink(link));

  const edit = tile.appendChild(el('button', 'ow-link-edit')) as HTMLButtonElement;
  edit.type = 'button';
  edit.title = t('webLinks.edit');
  edit.setAttribute('aria-label', t('webLinks.edit'));
  edit.disabled = savingLink;
  edit.innerHTML = PENCIL_ICON;
  edit.addEventListener('click', () => editWebLink(link));
  return tile;
};

/** A plus for the add tile, in the tile's own colour rather than a brand mark. */
const ADD_TILE_ICON =
  '<svg class="ow-add-icon" viewBox="0 0 24 24" aria-hidden="true">'
  + '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
  + '</svg>';

/** The tile that opens the editor for a new link; hidden once the list is full. */
const renderAddTile = (): HTMLElement => {
  const tile = el('button', 'ow-tile ow-add-tile') as HTMLButtonElement;
  tile.type = 'button';
  tile.title = t('webLinks.add');
  tile.setAttribute('aria-label', t('webLinks.add'));
  tile.disabled = savingLink;
  const iconWrap = tile.appendChild(el('span', 'ow-icon-wrap ow-add-icon-wrap'));
  iconWrap.innerHTML = ADD_TILE_ICON;
  tile.appendChild(el('span', 'ow-name', t('webLinks.add')));
  tile.appendChild(el('span', 'ow-tile-status', t('webLinks.url')));
  tile.addEventListener('click', () => editWebLink());
  return tile;
};

/** The add/edit form. Field edits stay in the draft, so typing never repaints. */
const renderLinkForm = (): HTMLElement => {
  const draft = linkDraft as LinkDraft;
  const form = el('div', 'ow-link-form');

  disposables.push(mountTextField(form, {
    label: t('webLinks.name'),
    value: draft.name,
    placeholder: t('webLinks.namePlaceholder'),
    disabled: savingLink,
    onChange: (value) => {
      if (linkDraft) linkDraft.name = value;
    },
  }));

  disposables.push(mountTextField(form, {
    label: t('webLinks.url'),
    value: draft.url,
    placeholder: t('webLinks.urlPlaceholder'),
    mono: true,
    disabled: savingLink,
    helper: t('webLinks.hint'),
    ...(draft.issue ? { error: linkIssueText(draft.issue) } : {}),
    onChange: (value) => {
      if (linkDraft) linkDraft.url = value;
    },
  }));

  const actions = form.appendChild(el('div', 'ow-link-actions'));
  if (draft.confirmDelete && draft.id) {
    form.appendChild(el('p', 'ow-link-warn', t('webLinks.confirmDelete')));
    disposables.push(mountButton(actions, {
      label: t('webLinks.delete'),
      size: 'xs',
      variant: 'destructive',
      disabled: savingLink,
      onClick: () => void deleteWebLink(draft.id as string),
    }));
    disposables.push(mountButton(actions, {
      label: t('webLinks.cancel'),
      size: 'xs',
      variant: 'outline',
      disabled: savingLink,
      onClick: () => {
        if (linkDraft) linkDraft.confirmDelete = false;
        render();
      },
    }));
    return form;
  }

  disposables.push(mountButton(actions, {
    label: t('webLinks.save'),
    size: 'xs',
    loading: savingLink,
    disabled: savingLink,
    onClick: () => void saveLinkDraft(),
  }));
  disposables.push(mountButton(actions, {
    label: t('webLinks.cancel'),
    size: 'xs',
    variant: 'outline',
    disabled: savingLink,
    onClick: closeLinkDialog,
  }));
  if (draft.id) {
    disposables.push(mountButton(actions, {
      label: t('webLinks.delete'),
      size: 'xs',
      variant: 'ghost',
      disabled: savingLink,
      onClick: () => {
        if (linkDraft) linkDraft.confirmDelete = true;
        render();
      },
    }));
  }
  return form;
};

/** Dismiss the editor. A save in flight keeps it open. */
const closeLinkDialog = (): void => {
  if (savingLink) return;
  linkDraft = null;
  render();
};

/**
 * The add/edit dialog: a dimmed layer with a centred card. It lives inside the
 * panel iframe, so `position: fixed` covers the whole surface; Escape, the close
 * button and a click on the backdrop all dismiss it.
 */
const renderLinkDialog = (): HTMLElement => {
  const draft = linkDraft as LinkDraft;
  const title = draft.id ? t('webLinks.editTitle') : t('webLinks.addTitle');

  const overlay = el('div', 'ow-modal');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', title);

  const card = overlay.appendChild(el('div', 'ow-modal-card'));
  const head = card.appendChild(el('div', 'ow-modal-head'));
  head.appendChild(el('span', 'ow-modal-title', title));
  const close = head.appendChild(el('button', 'ow-modal-close')) as HTMLButtonElement;
  close.type = 'button';
  close.title = t('webLinks.cancel');
  close.setAttribute('aria-label', t('webLinks.cancel'));
  close.disabled = savingLink;
  close.innerHTML = CLOSE_ICON;
  close.addEventListener('click', closeLinkDialog);

  card.appendChild(renderLinkForm());

  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) closeLinkDialog();
  });

  // Keep Tab inside the card while it is open.
  overlay.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [...card.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)',
    )].filter((node) => node.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeLinkDialog();
  };
  document.addEventListener('keydown', onKey);
  disposables.push({ dispose: () => document.removeEventListener('keydown', onKey) });

  // Focus the first field after the card is in the document.
  window.requestAnimationFrame(() => {
    if (!document.contains(card)) return;
    const input = card.querySelector('input') as HTMLInputElement | null;
    if (input && !input.disabled && document.activeElement !== input) input.focus();
  });

  return overlay;
};

/** Repaint when a visible state changed; draft text is deliberately not one. */
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
    // Draft text is left out on purpose: a repaint would replace the field and
    // drop the caret, so only the draft's identity and its error repaint it.
    webLinks: webLinks.map((link) => `${link.id}:${link.name}:${link.url}`).join('|'),
    linksError,
    savingLink,
    linkDraft: linkDraft
      ? `${linkDraft.id ?? 'new'}:${linkDraft.issue ?? ''}:${linkDraft.confirmDelete ? 1 : 0}`
      : '',
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

  // The app grid needs the service; the web links do not, so both live in the
  // body and the links stay visible while the service is off or still starting.
  const body = root.appendChild(el('div', 'ow-body'));

  if (linksError) {
    disposables.push(mountBanner(body, { tone: 'error', title: t('webLinks.loadFailed'), body: linksError }));
  }

  if (mode === 'service') {
    if (!appsLoaded) {
      const loading = body.appendChild(el('div', 'ow-loading'));
      disposables.push(mountSpinner(loading, { label: t('detecting') }));
    } else {
      if (loadError) {
        disposables.push(mountBanner(body, { tone: 'error', title: t('toast.loadFailed'), body: loadError }));
      }
      if (apps.length === 0 || available === 0) {
        disposables.push(mountBanner(body, {
          tone: apps.length === 0 ? 'warning' : 'info',
          title: t('empty.none.title'),
          body: t('empty.none.body'),
        }));
      }
    }
  }

  // One grid for everything usable: installed apps, then the custom links, the
  // add tile, and last the apps that were not found. Links stay in it while the
  // service is off, because they need no local process.
  const grid = body.appendChild(el('div', 'ow-grid'));
  if (mode === 'service' && appsLoaded) {
    const installedApps = apps.filter((app) => installed[app.id] === true);
    const missingApps = apps.filter((app) => installed[app.id] !== true);
    for (const app of installedApps) grid.appendChild(renderTile(app));
    for (const link of webLinks) grid.appendChild(renderLinkTile(link));
    if (webLinks.length < WEB_LINKS_MAX) grid.appendChild(renderAddTile());
    for (const app of missingApps) grid.appendChild(renderTile(app));
  } else {
    for (const link of webLinks) grid.appendChild(renderLinkTile(link));
    if (webLinks.length < WEB_LINKS_MAX) grid.appendChild(renderAddTile());
  }

  if (linkDraft) root.appendChild(renderLinkDialog());
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
  // The links come from storage and the apps from the service; neither waits on
  // the other, so a slow or missing service still shows the saved links.
  await Promise.all([detectMode(), loadWebLinks()]);
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
