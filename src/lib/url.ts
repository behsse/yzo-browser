import type { SearchEngine } from "../state/types";

const SEARCH_URLS: Record<SearchEngine, string> = {
  google: "https://www.google.com/search?q=",
  duckduckgo: "https://duckduckgo.com/?q=",
  bing: "https://www.bing.com/search?q=",
};

const ALLOWED_SCHEMES = new Set(["http:", "https:", "chrome-extension:"]);

/**
 * Builds the search-engine results URL for a free-text query.
 * @param query Text typed by the user.
 * @param engine Search engine selected in settings.
 * @returns Absolute https URL of the results page.
 */
export function buildSearchUrl(query: string, engine: SearchEngine): string {
  return SEARCH_URLS[engine] + encodeURIComponent(query.trim());
}

/**
 * Tells whether a URL may be loaded in a tab. Only http(s), extension pages and about:blank are
 * allowed so a page or a typed string can never make the browser open file://, javascript: or custom
 * protocol handlers.
 * @param url Candidate URL.
 * @returns True when the URL is safe to load in a tab.
 */
export function isNavigableUrl(url: string): boolean {
  if (url === "about:blank") return true;
  try {
    return ALLOWED_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Detects input that the user meant as an address rather than a search: an explicit http(s) URL,
 * localhost with an optional port, an IPv4 address, or a dotted host name without spaces.
 * @param input Raw text from the command bar.
 * @returns True when the input should be navigated to directly.
 */
export function looksLikeUrl(input: string): boolean {
  const text = input.trim();
  if (!text || /\s/.test(text)) return false;
  if (/^https?:\/\//i.test(text)) return isNavigableUrl(text);
  if (/^localhost(:\d+)?(\/.*)?$/i.test(text)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(text)) return true;
  return /^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)*\.[\p{L}]{2,}(:\d+)?([/?#].*)?$/u.test(text);
}

/**
 * Turns command-bar input into a URL that a tab can load: addresses get a scheme (http for local
 * hosts, https otherwise) and everything else becomes a search.
 * @param input Raw text typed by the user.
 * @param engine Search engine used for non-URL input.
 * @returns A navigable http(s) URL.
 */
export function toNavigableUrl(input: string, engine: SearchEngine): string {
  const text = input.trim();
  if (/^(https?|chrome-extension):\/\//i.test(text)) return isNavigableUrl(text) ? text : buildSearchUrl(text, engine);
  if (looksLikeUrl(text)) {
    const isLocal = /^(localhost|\d{1,3}(\.\d{1,3}){3})/i.test(text);
    return (isLocal ? "http://" : "https://") + text;
  }
  return buildSearchUrl(text, engine);
}

/**
 * Extracts the host name shown in the sidebar URL pill, without a leading "www.".
 * @param url Any URL string.
 * @returns Host name, or the input itself when it cannot be parsed.
 */
export function displayHost(url: string): string {
  // Yzo's own pages show their whole address.
  if (url.toLowerCase().startsWith("yzo://")) return url;
  try {
    const host = new URL(url).hostname;
    return host.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}
