// Yzo's own pages (yzo://…): drawn by the UI in the tab's slot instead of a native page view.

const SITE_SETTINGS_PATTERN = /^yzo:\/\/settings\/sites\/([a-z0-9.-]+(?::\d{1,5})?)\/?$/i;

const EXTENSIONS_PATTERN = /^yzo:\/\/extensions(?:\/([a-p]{32}))?\/?$/i;

/** Address of the extensions page. */
export const EXTENSIONS_URL = "yzo://extensions";

/** Address of the download history. */
export const DOWNLOADS_URL = "yzo://downloads";

/** Sections of yzo://settings, in the left menu's order; yzo://settings alone opens the first. */
export const SETTINGS_SECTIONS = ["account", "search", "tabs", "downloads", "about"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const SETTINGS_PATTERN = /^yzo:\/\/settings(?:\/([a-z]+))?\/?$/i;
const DOWNLOADS_PATTERN = /^yzo:\/\/downloads\/?$/i;

export type InternalPage =
  | { kind: "siteSettings"; host: string }
  | { kind: "extensions" }
  | { kind: "extensionDetails"; id: string }
  | { kind: "settings"; section: SettingsSection }
  | { kind: "downloads" }
  | { kind: "notFound" };

/**
 * Whether a tab URL is one of Yzo's own pages.
 * @param url Tab URL.
 * @returns True for yzo:// URLs.
 */
export function isInternalUrl(url: string): boolean {
  return url.toLowerCase().startsWith("yzo://");
}

/**
 * Address of a site's settings page.
 * @param host Site host, with its port if any.
 * @returns yzo://settings/sites/<host>
 */
export function siteSettingsUrl(host: string): string {
  return `yzo://settings/sites/${host.toLowerCase()}`;
}

/**
 * Reads which Yzo page a URL points to.
 * @param url yzo:// URL.
 * @returns The page, or notFound.
 */
export function parseInternalUrl(url: string): InternalPage {
  const site = SITE_SETTINGS_PATTERN.exec(url);
  if (site) return { kind: "siteSettings", host: site[1].toLowerCase() };
  const extensions = EXTENSIONS_PATTERN.exec(url);
  if (extensions) return extensions[1] ? { kind: "extensionDetails", id: extensions[1].toLowerCase() } : { kind: "extensions" };
  if (DOWNLOADS_PATTERN.test(url)) return { kind: "downloads" };
  const settings = SETTINGS_PATTERN.exec(url);
  if (settings) {
    const section = (settings[1] ?? SETTINGS_SECTIONS[0]).toLowerCase();
    if ((SETTINGS_SECTIONS as readonly string[]).includes(section)) return { kind: "settings", section: section as SettingsSection };
  }
  return { kind: "notFound" };
}

/**
 * Address of a settings section.
 * @param section Section.
 * @returns yzo://settings/<section>
 */
export function settingsUrl(section: SettingsSection = SETTINGS_SECTIONS[0]): string {
  return `yzo://settings/${section}`;
}

/**
 * Address of one extension's details page.
 * @param id Extension id.
 * @returns yzo://extensions/<id>
 */
export function extensionDetailsUrl(id: string): string {
  return `${EXTENSIONS_URL}/${id}`;
}
