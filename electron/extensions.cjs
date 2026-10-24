// Chrome extensions: Chrome Web Store installs (electron-chrome-web-store, MIT) and the chrome.*
// APIs that give extensions a UI and tab access (electron-chrome-extensions, used under GPL-3.0 like
// Yzo itself).
const { dialog, session: electronSession } = require("electron");
const { randomUUID } = require("node:crypto");
const { ElectronChromeExtensions } = require("electron-chrome-extensions");
const { installChromeWebStore, uninstallExtension } = require("electron-chrome-web-store");
const { t } = require("./i18n.cjs");

/** Permissions shown in plain words in the install confirmation (others are listed as-is). */
const LABELLED_PERMISSIONS = new Set([
  "tabs",
  "history",
  "bookmarks",
  "cookies",
  "downloads",
  "clipboardRead",
  "clipboardWrite",
  "notifications",
  "webRequest",
  "declarativeNetRequest",
  "storage",
  "scripting",
  "<all_urls>",
]);

/**
 * Lists an extension manifest's permissions in readable form for the install prompt.
 * @param {chrome.runtime.Manifest} manifest Extension manifest.
 * @returns {string[]} One line per permission.
 */
function describePermissions(manifest) {
  const raw = [
    ...(manifest.permissions ?? []),
    ...(/** @type {string[]} */ (manifest.host_permissions ?? [])),
  ].filter((p) => typeof p === "string");
  const allSites = raw.some((p) => p === "<all_urls>" || p === "*://*/*" || p === "http://*/*" || p === "https://*/*");
  const lines = new Set(allSites ? [t("permission.<all_urls>")] : []);
  for (const permission of raw) {
    if (/^(<all_urls>|\*:\/\/\*\/\*|https?:\/\/\*\/\*)$/.test(permission)) continue;
    if (LABELLED_PERMISSIONS.has(permission)) lines.add(t("permission." + permission));
    else lines.add(permission.includes("/") ? t("permission.host", { host: permission }) : permission);
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
 *   list(): { id: string, name: string, version: string, optionsUrl: string | null }[],
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

  await installChromeWebStore({
    session,
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

  return {
    extensions,
    list() {
      return session.extensions.getAllExtensions().map((ext) => {
        const optionsPage = ext.manifest.options_ui?.page ?? ext.manifest.options_page ?? null;
        return {
          id: ext.id,
          name: ext.name,
          version: ext.version,
          optionsUrl: optionsPage ? `${ext.url}${optionsPage.replace(/^\//, "")}` : null,
        };
      });
    },
    async uninstall(id) {
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
