// Shield against ads and trackers, like Brave's: Ghostery's adblocker engine (@ghostery/adblocker-electron,
// MPL-2.0) with EasyList, EasyPrivacy and their companions. It blocks requests and hides ad slots in
// the tabs' session, on every site except the ones the user turned it off for. The compiled engine is
// cached on disk and rebuilt in the background once a week.

const { ipcMain, webContents: allContents } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

/** Ghostery's page preload (cosmetic filters); a dependency of the Electron package, resolved from it. */
const PRELOAD_PATH = require.resolve("@ghostery/adblocker-electron-preload", {
  paths: [path.dirname(require.resolve("@ghostery/adblocker-electron"))],
});

/** Engine cache older than this is rebuilt from fresh lists. */
const ENGINE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ENGINE_FILE = "shield-engine.bin";
const SETTINGS_FILE = "shield.json";
/** Upper bound on remembered sites, so a corrupted file cannot grow without limit. */
const MAX_DISABLED_SITES = 5000;

/**
 * Site key the shield is turned off for: the host without a leading "www.".
 * @param {string} url Page URL.
 * @returns {string | null} Site, or null for non-web URLs.
 */
function siteOf(url) {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== "http:" && protocol !== "https:") return null;
    return hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Starts the shield in a session.
 * @param {object} options
 * @param {Electron.Session} options.session Tabs' session.
 * @param {string} options.dataPath Folder holding the engine cache and the per-site settings.
 * @param {boolean} options.readOnly True in a private instance: nothing is written, changes stay in memory.
 * @returns {{ status(webContentsId: number, url: string): { enabled: boolean, blocked: number }, setEnabled(url: string, enabled: boolean): boolean }}
 */
function setupShield({ session, dataPath, readOnly }) {
  /** @type {ElectronBlocker | null} */
  let blocker = null;
  /** @type {Set<string>} */
  let disabledSites = new Set();
  /** Blocked requests per page (webContents id), since its last navigation. */
  const blockedCounts = new Map();
  const enginePath = path.join(dataPath, ENGINE_FILE);
  const settingsPath = path.join(dataPath, SETTINGS_FILE);

  /**
   * Whether the shield applies to the page a request comes from.
   * @param {number | undefined} webContentsId Requesting page.
   * @returns {boolean} False when off for that site or the page is unknown.
   */
  const activeFor = (webContentsId) => {
    if (!blocker || webContentsId === undefined) return false;
    const contents = allContents.fromId(webContentsId);
    const site = contents && !contents.isDestroyed() ? siteOf(contents.getURL()) : null;
    return site !== null && !disabledSites.has(site);
  };

  /**
   * Builds the engine from fresh lists and caches it.
   * @returns {Promise<ElectronBlocker>} Engine.
   */
  const buildEngine = async () => {
    const engine = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
    if (!readOnly) await fs.writeFile(enginePath, engine.serialize()).catch(() => {});
    return engine;
  };

  /** Loads the cached engine at once, then refreshes it when stale or missing. */
  const loadEngine = async () => {
    let stale = true;
    try {
      const [buffer, info] = await Promise.all([fs.readFile(enginePath), fs.stat(enginePath)]);
      blocker = ElectronBlocker.deserialize(new Uint8Array(buffer));
      stale = Date.now() - info.mtimeMs > ENGINE_MAX_AGE_MS;
    } catch {
      // No usable cache: build one below.
    }
    if (stale) blocker = await buildEngine();
  };

  /** Reads the sites the shield is off for. */
  const loadSettings = async () => {
    try {
      const parsed = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      const sites = Array.isArray(parsed?.disabledSites) ? parsed.disabledSites.filter((s) => typeof s === "string") : [];
      disabledSites = new Set(sites.slice(0, MAX_DISABLED_SITES));
    } catch {
      disabledSites = new Set();
    }
  };

  /** Writes the sites the shield is off for (not in a private instance). */
  const saveSettings = () => {
    if (readOnly) return;
    fs.writeFile(settingsPath, JSON.stringify({ disabledSites: [...disabledSites] })).catch((error) =>
      console.error("[shield] settings not saved:", error),
    );
  };

  session.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
    if (details.resourceType === "mainFrame") blockedCounts.delete(details.webContentsId);
    if (!activeFor(details.webContentsId)) return callback({});
    blocker.onBeforeRequest(details, (response) => {
      if (response.cancel || response.redirectURL) {
        blockedCounts.set(details.webContentsId, (blockedCounts.get(details.webContentsId) ?? 0) + 1);
      }
      callback(response);
    });
  });
  session.webRequest.onHeadersReceived({ urls: ["<all_urls>"] }, (details, callback) => {
    if (!activeFor(details.webContentsId)) return callback({});
    blocker.onHeadersReceived(details, callback);
  });

  // Cosmetic filters (hidden ad slots, scriptlets): Ghostery's preload asks for them on each page.
  session.registerPreloadScript({ type: "frame", filePath: PRELOAD_PATH });
  ipcMain.handle("@ghostery/adblocker/inject-cosmetic-filters", (event, url, msg) => {
    const site = siteOf(event.sender.getURL());
    if (!blocker || site === null || disabledSites.has(site)) return;
    return blocker.onInjectCosmeticFilters(event, url, msg);
  });
  ipcMain.handle("@ghostery/adblocker/is-mutation-observer-enabled", (event) => blocker?.onIsMutationObserverEnabled(event) ?? false);

  void loadSettings();
  loadEngine().catch((error) => console.error("[shield] engine unavailable:", error));

  return {
    status(webContentsId, url) {
      const site = siteOf(url);
      return { enabled: site !== null && !disabledSites.has(site), blocked: blockedCounts.get(webContentsId) ?? 0 };
    },
    setEnabled(url, enabled) {
      const site = siteOf(url);
      if (site === null) return false;
      if (enabled) disabledSites.delete(site);
      else if (disabledSites.size < MAX_DISABLED_SITES) disabledSites.add(site);
      saveSettings();
      return true;
    },
  };
}

module.exports = { setupShield, siteOf };
