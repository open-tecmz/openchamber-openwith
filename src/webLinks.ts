/**
 * Custom web links: a URL template filled with the open project's directory.
 *
 * A link looks like `https://example.com/?path={path}`. Two placeholders are
 * understood:
 *   - `{path}` — the project directory exactly as the host reports it;
 *   - `{pathUrlEncode}` — the same path passed through `encodeURIComponent`,
 *     which is what a query value needs (a raw path can contain `&`, `#`, `?`).
 *
 * Links are panel-only: the panel keeps them in extension storage and hands the
 * filled URL to the host (`openUrl`), so no service, project file or extra
 * permission is involved. This module is pure data and string work, so it can be
 * unit-tested without a host.
 */

/** Storage key inside the extension's namespace. */
export const WEB_LINKS_KEY = 'webLinks';

/** How many links one extension may keep; the panel also stops offering Add. */
export const WEB_LINKS_MAX = 8;

export const WEB_LINK_NAME_MAX = 60;
export const WEB_LINK_URL_MAX = 2048;

/** The placeholders a template may use. Anything else is treated as a typo. */
export const WEB_LINK_PLACEHOLDERS = ['path', 'pathUrlEncode'] as const;
export type WebLinkPlaceholder = (typeof WEB_LINK_PLACEHOLDERS)[number];

/** A saved link: a display name (may be empty) and a URL template. */
export type WebLink = {
  id: string;
  name: string;
  url: string;
};

/** What the editor form holds before it is saved. */
export type WebLinkDraft = {
  name: string;
  url: string;
};

export type WebLinkIssue = 'empty-url' | 'invalid-url' | 'unknown-placeholder' | 'too-long';

export type WebLinkCheck =
  | { ok: true; name: string; url: string }
  | { ok: false; issue: WebLinkIssue };

/** A path used to make a template parseable while it is validated. */
const SAMPLE_PATH = '/Users/you/project';

/** The placeholder pattern; braces cannot nest, so anything inside one is a name. */
const PLACEHOLDER = /\{([^{}]*)\}/g;

const isPlaceholder = (name: string): name is WebLinkPlaceholder =>
  (WEB_LINK_PLACEHOLDERS as readonly string[]).includes(name);

/** Is this an absolute http(s) URL the host can open? */
export const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

/** Fill a template with the project directory. */
export const fillWebLink = (template: string, directory: string): string =>
  template
    .split('{path}')
    .join(directory)
    .split('{pathUrlEncode}')
    .join(encodeURIComponent(directory));

/**
 * Validate and normalize a draft. The name is optional and trimmed; the URL is
 * checked against the placeholders and parsed after they are filled with a
 * sample path, so a missing scheme or a broken address is caught before saving.
 */
export const checkWebLink = (draft: WebLinkDraft): WebLinkCheck => {
  const name = draft.name.trim();
  const url = draft.url.trim();

  if (url.length === 0) return { ok: false, issue: 'empty-url' };
  if (name.length > WEB_LINK_NAME_MAX || url.length > WEB_LINK_URL_MAX) {
    return { ok: false, issue: 'too-long' };
  }

  for (const match of url.matchAll(PLACEHOLDER)) {
    if (!isPlaceholder(match[1])) return { ok: false, issue: 'unknown-placeholder' };
  }

  const sample = fillWebLink(url, SAMPLE_PATH);
  if (!isHttpUrl(sample)) return { ok: false, issue: 'invalid-url' };

  return { ok: true, name, url };
};

/** The host of a template, without `www.`; empty when the URL has none. */
export const webLinkHost = (template: string): string => {
  const host = /^https?:\/\/([^/?#]+)/i.exec(template)?.[1] ?? '';
  return host.replace(/^www\./i, '');
};

/** A saved link's label: its name, else the template's host. */
export const webLinkLabel = (link: WebLink): string => {
  const name = link.name.trim();
  if (name) return name;
  return webLinkHost(link.url) || link.url;
};

/** A fresh id for a link. Time plus randomness avoids a dependency on Web Crypto. */
export const newWebLinkId = (): string =>
  `wl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Read stored links defensively: storage is JSON that an older build or a hand
 * edit may have written, so invalid entries are dropped instead of breaking the
 * panel. Duplicate ids are dropped too.
 */
export const parseWebLinks = (value: unknown): WebLink[] => {
  if (!Array.isArray(value)) return [];
  const links: WebLink[] = [];
  const ids = new Set<string>();
  for (const entry of value) {
    if (links.length >= WEB_LINKS_MAX) break;
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    if (!id || id.length > 64 || ids.has(id)) continue;
    if (typeof record.name !== 'string' || typeof record.url !== 'string') continue;
    const checked = checkWebLink({ name: record.name, url: record.url });
    if (!checked.ok) continue;
    ids.add(id);
    links.push({ id, name: checked.name, url: checked.url });
  }
  return links;
};
