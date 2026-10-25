// Finds a site's icon without opening it in a tab: used for tabs that were never loaded (imported
// from Arc, restored, synced), which otherwise only show the host's first letter.
//
// The page is fetched in the tabs' session (same cookies and user agent as a real visit), its
// <link rel="icon"> tags are read, and the best candidate that actually serves an image wins; the
// classic /favicon.ico is the last resort. The image itself is returned as a data URL: icons behind a
// sign-in (Gmail, Calendar…) only load with the tabs' cookies, which the UI does not have.

const PAGE_TIMEOUT_MS = 6000;
const ICON_TIMEOUT_MS = 4000;
const MAX_HTML_CHARS = 512 * 1024;
const MAX_ICON_BYTES = 100 * 1024;
/** Preferred icon size: the sidebar shows 16–20 px icons on 2× screens. */
const TARGET_SIZE = 32;

/**
 * Reads one attribute of an HTML tag.
 * @param {string} tag Tag source, e.g. `<link rel="icon" href="/a.png">`.
 * @param {string} name Attribute name.
 * @returns {string | null} Value, or null when absent.
 */
function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[1] ?? match[2] ?? match[3] ?? "").trim() : null;
}

/**
 * Lists the icon URLs a page declares, best first: icons sized near 32 px (or SVG), then other
 * icons, then Apple touch icons. Relative URLs are resolved against the page URL.
 * @param {string} html Page source (only the <head> matters).
 * @param {string} pageUrl Final page URL, for relative hrefs.
 * @returns {string[]} Candidate icon URLs.
 */
function iconCandidates(html, pageUrl) {
  const head = html.slice(0, MAX_HTML_CHARS);
  /** @type {{ url: string, score: number }[]} */
  const found = [];
  for (const [tag] of head.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attribute(tag, "rel") ?? "").toLowerCase().split(/\s+/);
    const href = attribute(tag, "href");
    if (!href || !(rel.includes("icon") || rel.includes("apple-touch-icon"))) continue;
    let url;
    try {
      url = new URL(href.replace(/&amp;/g, "&"), pageUrl).href;
    } catch {
      continue;
    }
    if (!/^https?:|^data:image\//i.test(url)) continue;
    const sizes = (attribute(tag, "sizes") ?? "").toLowerCase();
    const size = Math.max(0, ...[...sizes.matchAll(/(\d+)x\d+/g)].map((m) => Number(m[1])));
    const type = (attribute(tag, "type") ?? "").toLowerCase();
    let score = rel.includes("icon") ? 100 : 50;
    if (type.includes("svg") || /\.svg(\?|$)/i.test(url) || sizes === "any") score += 40;
    else if (size) score += 40 - Math.min(39, Math.abs(size - TARGET_SIZE) / 4);
    found.push({ url, score });
  }
  return found.sort((a, b) => b.score - a.score).map((entry) => entry.url);
}

/**
 * Fetches with a timeout in the given session.
 * @param {Electron.Session} session Session to fetch in.
 * @param {string} url URL.
 * @param {number} timeoutMs Abort after this delay.
 * @returns {Promise<Response | null>} Response, or null on network error or timeout.
 */
async function fetchWithTimeout(session, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await session.fetch(url, { signal: controller.signal, redirect: "follow" });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Downloads an icon as a data URL.
 * @param {Electron.Session} session Session to fetch in.
 * @param {string} url Icon URL.
 * @returns {Promise<string | null>} data:image URL, or null when the URL does not serve a small image.
 */
async function fetchImage(session, url) {
  if (url.startsWith("data:image/")) return url.length <= MAX_ICON_BYTES * 2 ? url : null;
  const response = await fetchWithTimeout(session, url, ICON_TIMEOUT_MS);
  if (!response?.ok) return null;
  let type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  // Some servers send icons as octet-stream: trust the extension then, never an HTML or JSON page.
  if (!type.startsWith("image/")) {
    if (type.includes("html") || type.includes("json") || type.startsWith("text/")) return null;
    type = /\.svg(\?|$)/i.test(url) ? "image/svg+xml" : /\.png(\?|$)/i.test(url) ? "image/png" : "image/x-icon";
  }
  const bytes = Buffer.from(await response.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (!bytes.length || bytes.length > MAX_ICON_BYTES) return null;
  return `data:${type};base64,${bytes.toString("base64")}`;
}

/**
 * Finds the icon of a site.
 * @param {Electron.Session} session Tabs' session.
 * @param {unknown} pageUrl Page URL from the UI.
 * @returns {Promise<string | null>} Icon as a data URL, or null when none could be found.
 */
async function resolveFavicon(session, pageUrl) {
  if (typeof pageUrl !== "string" || !/^https?:\/\//i.test(pageUrl) || pageUrl.length > 4096) return null;
  const page = await fetchWithTimeout(session, pageUrl, PAGE_TIMEOUT_MS);
  const finalUrl = page?.url || pageUrl;
  const html = page?.ok && (page.headers.get("content-type") ?? "").includes("html") ? await page.text().catch(() => "") : "";
  // Signed-out redirects (Google Calendar to a marketing page…) can lose the icon: the original
  // site's /favicon.ico is the last resort.
  // The parent domain's icon (google.com for calendar.google.com) beats a letter when the site itself
  // only answers signed-in users.
  const host = new URL(pageUrl).hostname;
  const parent = host.split(".").length > 2 && !/^\d+(\.\d+){3}$/.test(host) ? "https://" + host.split(".").slice(-2).join(".") + "/favicon.ico" : null;
  const candidates = [...iconCandidates(html, finalUrl), new URL("/favicon.ico", finalUrl).href, new URL("/favicon.ico", pageUrl).href, ...(parent ? [parent] : [])];
  for (const candidate of [...new Set(candidates)].slice(0, 7)) {
    const image = await fetchImage(session, candidate);
    if (image) return image;
  }
  return null;
}

module.exports = { resolveFavicon, iconCandidates };
