// Yzo's own pages (yzo://…): drawn by the UI in the tab's slot instead of a native page view.

const SITE_SETTINGS_PATTERN = /^yzo:\/\/settings\/sites\/([a-z0-9.-]+(?::\d{1,5})?)\/?$/i;

export type InternalPage = { kind: "siteSettings"; host: string } | { kind: "notFound" };

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
  const match = SITE_SETTINGS_PATTERN.exec(url);
  return match ? { kind: "siteSettings", host: match[1].toLowerCase() } : { kind: "notFound" };
}
