// Chrome extensions: Chrome Web Store installs (electron-chrome-web-store, MIT) and the chrome.*
// APIs that give extensions a UI and tab access (electron-chrome-extensions, used under GPL-3.0 like
// Yzo itself).
const { dialog, session: electronSession } = require("electron");
const { randomUUID } = require("node:crypto");
const { ElectronChromeExtensions } = require("electron-chrome-extensions");
const { installChromeWebStore, installExtension, uninstallExtension } = require("electron-chrome-web-store");
const { t } = require("./i18n.cjs");
const { discoverInstalled, localize, readIcon, folderSize, readDisabled, writeDisabled, loadInstalled } = require("./extension-store.cjs");

const WEB_STORE_DETAIL_URL = "https://chromewebstore.google.com/detail/";

/**
 * Permissions that come with a warning, like Chrome's (install prompt and extension details). The
 * others (storage, alarms, contextMenus…) give no access to the user's data and are not listed.
 */
const LABELLED_PERMISSIONS = new Set([
  "<all_urls>",
  "tabs",
  "history",
  "bookmarks",
  "downloads",
  "clipboardRead",
  "clipboardWrite",
  "notifications",
  "declarativeNetRequest",
  "privacy",
  "geolocation",
  "management",
  "nativeMessaging",
  "topSites",
  "desktopCapture",
  "debugger",
  "contentSettings",
]);

/** Permissions that share another one's warning, as in Chrome. */
const PERMISSION_ALIASES = { proxy: "<all_urls>", webNavigation: "tabs", tabCapture: "desktopCapture", pageCapture: "desktopCapture" };

/** Host patterns that mean every site. */
const ALL_SITES_PATTERN = /^(<all_urls>|\*:\/\/\*\/\*|https?:\/\/\*\/\*)$/;

/**
 * Site a host pattern covers, as shown to the user ("*://*.example.com/*" gives "example.com").
 * @param {string} pattern Match pattern.
 * @returns {string} Host.
 */
function patternHost(pattern) {
  const host = /^[^:]+:\/\/([^/]+)/.exec(pattern)?.[1] ?? pattern;
  return host.replace(/^\*\./, "");
}

/**
 * Lists the warnings of an extension's permissions in plain words, like Chrome: access to sites
 * (permissions, host permissions and content scripts) first, then the sensitive APIs.
 * @param {chrome.runtime.Manifest} manifest Extension manifest.
 * @returns {string[]} One line per warning.
 */
function describePermissions(manifest) {
  const hosts = [
    ...(manifest.permissions ?? []),
    ...(/** @type {string[]} */ (manifest.host_permissions ?? [])),
    ...(manifest.content_scripts ?? []).flatMap((script) => script.matches ?? []),
  ].filter((p) => typeof p === "string" && (p.includes("://") || p === "<all_urls>"));
  const apis = (manifest.permissions ?? []).filter((p) => typeof p === "string" && !p.includes("://"));
  const lines = new Set();
  const allSites = hosts.some((p) => ALL_SITES_PATTERN.test(p)) || apis.includes("proxy");
  if (allSites) lines.add(t("permission.<all_urls>"));
  else for (const host of new Set(hosts.map(patternHost))) lines.add(t("permission.host", { host }));
  for (const permission of apis) {
    const label = PERMISSION_ALIASES[permission] ?? permission;
    // Access to every site already covers the browsing history.
    if (label === "<all_urls>" || (allSites && label === "tabs")) continue;
    if (LABELLED_PERMISSIONS.has(label)) lines.add(t("permission." + label));
  }
  return [...lines];
}

/**
 * Enables Chrome extensions for the tabs' session.
 * @param {object} options Wiring provided by the main process.
 * @param {Electron.Session} options.session Session shared by all tabs.
 * @param {() => Electron.BaseWindow | null} options.getWindow Returns the browser window.
 * @param {() => Electron.WebContents | null} options.getUi Returns the UI renderer's contents.
 * @param {() => ReturnType<import("./views.cjs").createViewManager> | null} options.getViews Returns
 *   the view manager of that window.
 * @returns {Promise<{
 *   extensions: ElectronChromeExtensions,
 *   list(): Promise<object[]>,
 *   setEnabled(id: string, enabled: boolean): Promise<boolean>,
 *   uninstall(id: string): Promise<boolean>,
 *   contextMenuItems(contents: Electron.WebContents, params: Electron.ContextMenuParams): Electron.MenuItem[],
 * }>} Extension controller.
 */
async function setupExtensions({ session, getWindow, getUi, getViews }) {
  /**
   * Asks the UI to create a tab and waits for its page to exist.
   * @param {string | undefined} url Tab URL.
   * @param {boolean} active Whether the tab becomes the selected one.
   * @returns {Promise<Electron.WebContents | null>} The new tab's contents.
   */
  const createTab = async (url, active) => {
    const ui = getUi();
    const views = getViews();
    if (!ui || !views) return null;
    const id = randomUUID();
    ui.send("tab:create", { id, url: url || "about:blank", active });
    return views.waitForView(id);
  };

  /**
   * Sends a tab command to the UI by page contents.
   * @param {string} channel IPC channel ("tab:activate" or "tab:close").
   * @param {Electron.WebContents} contents Tab page.
   */
  const toUiForTab = (channel, contents) => {
    const id = getViews()?.idOf(contents);
    if (id) getUi()?.send(channel, { id });
  };

  const extensions = new ElectronChromeExtensions({
    license: "GPL-3.0",
    session,
    async createTab(details) {
      const contents = await createTab(details.url, details.active !== false);
      const win = getWindow();
      if (!contents || !win) throw new Error("Yzo could not create the tab");
      return [contents, win];
    },
    selectTab(contents) {
      toUiForTab("tab:activate", contents);
    },
    removeTab(contents) {
      toUiForTab("tab:close", contents);
    },
    // Yzo has a single window: extension windows open as tabs in it.
    async createWindow(details) {
      const urls = Array.isArray(details.url) ? details.url : [details.url];
      for (const url of urls) await createTab(url, true);
      const win = getWindow();
      if (!win) throw new Error("Yzo has no window");
      return win;
    },
  });

  // Extension icons in the UI (<browser-action-list>) load through the crx:// protocol, served in
  // the session of the page that shows them: the UI's default session.
  ElectronChromeExtensions.handleCRXProtocol(electronSession.defaultSession);

  const disabled = await readDisabled();

  // Yzo loads the installs itself (below) so that turned-off extensions never run.
  await installChromeWebStore({
    session,
    loadExtensions: false,
    async beforeInstall({ localizedName, manifest }) {
      const win = getWindow();
      const permissions = describePermissions(manifest);
      const options = {
        type: "question",
        buttons: [t("extensionInstall.add"), t("common.cancel")],
        defaultId: 1,
        cancelId: 1,
        title: t("extensionInstall.title"),
        message: t("extensionInstall.message", { name: localizedName }),
        detail: permissions.length ? t("extensionInstall.canDo") + "\n• " + permissions.join("\n• ") : t("extensionInstall.noPermissions"),
      };
      const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
      return { action: response === 0 ? "allow" : "deny" };
    },
  });

  for (const [id, install] of await discoverInstalled()) {
    if (disabled.has(id) || session.extensions.getExtension(id)) continue;
    await loadInstalled(session, install.path).catch((error) => console.error(`Extension ${id} not loaded:`, error));
  }

  return {
    extensions,
    /**
     * Every installed extension, turned on or off, with what the extensions page shows.
     * @returns {Promise<object[]>} InstalledExtension entries (src/env.d.ts).
     */
    async list() {
      const installed = await discoverInstalled();
      // Extensions loaded from elsewhere (none today) are listed too.
      for (const ext of session.extensions.getAllExtensions()) {
        if (!installed.has(ext.id)) installed.set(ext.id, { path: ext.path, manifest: ext.manifest });
      }
      const entries = [];
      for (const [id, { path: dir, manifest }] of installed) {
        const loaded = session.extensions.getExtension(id);
        const optionsPage = manifest.options_ui?.page ?? manifest.options_page ?? null;
        entries.push({
          id,
          name: (await localize(dir, manifest, manifest.name)) || loaded?.name || id,
          description: await localize(dir, manifest, manifest.description),
          version: manifest.version ?? "",
          icon: await readIcon(dir, manifest),
          enabled: Boolean(loaded),
          optionsUrl: loaded && optionsPage ? `${loaded.url}${optionsPage.replace(/^\//, "")}` : null,
          permissions: describePermissions(manifest),
          size: await folderSize(dir),
          storeUrl: manifest.key || manifest.update_url ? WEB_STORE_DETAIL_URL + id : null,
        });
      }
      return entries.sort((a, b) => a.name.localeCompare(b.name));
    },
    /**
     * Turns an installed extension on (loads it) or off (unloads it, and it stays off on later starts).
     * @param {string} id Extension id.
     * @param {boolean} enabled New state.
     * @returns {Promise<boolean>} False when it is not installed or failed to load.
     */
    async setEnabled(id, enabled) {
      const install = (await discoverInstalled()).get(id);
      if (!install) return false;
      if (enabled) disabled.delete(id);
      else disabled.add(id);
      await writeDisabled(disabled).catch((error) => console.error("Extension state not saved:", error));
      try {
        if (!enabled && session.extensions.getExtension(id)) session.extensions.removeExtension(id);
        if (enabled && !session.extensions.getExtension(id)) await loadInstalled(session, install.path);
        return true;
      } catch (error) {
        console.error(`Extension ${id} could not be turned ${enabled ? "on" : "off"}:`, error);
        return false;
      }
    },
    /**
     * Installs an extension from the Chrome Web Store without the permission dialog (used by the
     * Arc import, which the user confirmed as a whole).
     * @param {string} id Extension id.
     * @returns {Promise<void>}
     */
    async install(id) {
      await installExtension(id, { session });
    },
    async uninstall(id) {
      if (disabled.delete(id)) await writeDisabled(disabled).catch(() => {});
      try {
        await uninstallExtension(id, { session });
        return true;
      } catch {
        // Not a Web Store install (or already gone): unload it from the session anyway.
        try {
          session.extensions.removeExtension(id);
          return true;
        } catch {
          return false;
        }
      }
    },
    contextMenuItems(contents, params) {
      return extensions.getContextMenuItems(contents, params);
    },
  };
}

module.exports = { setupExtensions };
