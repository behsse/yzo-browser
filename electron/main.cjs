// Electron main process: owns the frameless window, persistence and every tab page (WebContentsView).
const electron = require("electron");
const { app, BaseWindow, WebContentsView, ipcMain, Menu, clipboard, screen, session } = electron;
const path = require("node:path");
const fs = require("node:fs");
const shortcuts = require("../shared/shortcuts.json");
const { createViewManager } = require("./views.cjs");
const { createMenuPopup } = require("./menu-popup.cjs");
const { setupExtensions } = require("./extensions.cjs");
const { createAccount, AccountError } = require("./account.cjs");
const { readArc, countTabs, EXTENSION_ID } = require("./arc-import.cjs");
const { resolveFavicon } = require("./favicon.cjs");
const { startNativeWindowDrag } = require("./window-drag.cjs");
const { isPrivateInstance, launchPrivateInstance, claimPrivateProfile, mainProfilePath } = require("./private-mode.cjs");
const { setupShield } = require("./shield.cjs");
const { createSiteInfo } = require("./site-info.cjs");
const { t } = require("./i18n.cjs");

/** Private instance (electron/private-mode.cjs): nothing it browses or changes is kept. */
const PRIVATE = isPrivateInstance();
// Without the "persist:" prefix the session lives in memory only.
const PARTITION = PRIVATE ? "yzo-private" : "persist:yzo";
const STATE_FILE = () => path.join(app.getPath("userData"), "yzo-state.json");
const MAX_STATE_BYTES = 10 * 1024 * 1024;
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
// "mediaKeySystem" lets sites use the Widevine CDM (Netflix, Spotify, Disney+…).
const ALLOWED_PERMISSIONS = new Set(["fullscreen", "clipboard-sanitized-write", "pointerLock", "mediaKeySystem"]);
/** Longest wait for the Widevine CDM at startup, so an offline first launch still opens the window. */
const WIDEVINE_TIMEOUT_MS = 15_000;

/**
 * User agent sent to sites: the default Electron one minus the "yzo/x" and "Electron/x" tokens, with
 * the reduced "Chrome/<major>.0.0.0" form real Chrome uses. Google and other services refuse sign-in
 * from "embedded" browsers and mostly detect them through the Electron token.
 */
const USER_AGENT = app.userAgentFallback
  .replace(/ yzo\/\S+/i, "")
  .replace(/ Electron\/\S+/, "")
  .replace(/Chrome\/[\d.]+/, `Chrome/${process.versions.chrome.split(".")[0]}.0.0.0`);
app.userAgentFallback = USER_AGENT;

/** @type {BaseWindow | null} */
let mainWindow = null;
/**
 * The browser UI. It is a view of its own (not the window's built-in contents) so it can be stacked
 * above the tab views while an overlay is open, with a transparent background where the pages are.
 * @type {WebContentsView | null}
 */
let uiView = null;
/** @type {ReturnType<typeof createViewManager> | null} */
let viewManager = null;
/** @type {ReturnType<typeof createMenuPopup> | null} */
let menuPopup = null;
/** @type {Awaited<ReturnType<typeof setupExtensions>> | null} */
let extensionController = null;
/** @type {ReturnType<typeof createAccount> | null} */
let account = null;
/** @type {ReturnType<typeof setupShield> | null} */
let shield = null;
/** @type {ReturnType<typeof createSiteInfo> | null} */
let siteInfo = null;

/** Official Yzo sync server (private yzo-cloud deployment). */
const PRODUCTION_SYNC_URL = "https://yzo-browser-backend.vercel.app";

/**
 * Sync server used until the user picks another one in the Account panel: YZO_SYNC_URL if set,
 * the official server in packaged builds, the local yzo-cloud dev server otherwise.
 */
const DEFAULT_SYNC_URL = process.env.YZO_SYNC_URL ?? (app.isPackaged ? PRODUCTION_SYNC_URL : "http://127.0.0.1:3100");

/**
 * Tells whether a URL may be loaded in a tab.
 * @param {string} url Candidate URL.
 * @returns {boolean} True for http(s), extension pages (options, extension tabs) and about:blank.
 */
function isNavigableUrl(url) {
  if (url === "about:blank") return true;
  try {
    return ["http:", "https:", "chrome-extension:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Finds the shortcut action bound to a key press (same table and rules as src/lib/shortcuts.ts).
 * @param {Electron.Input} input Keyboard input from before-input-event.
 * @returns {string | null} Action name or null.
 */
function matchShortcut(input) {
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  const found = shortcuts.find(
    (b) =>
      b.key === key &&
      Boolean(b.ctrl) === input.control &&
      Boolean(b.shift) === input.shift &&
      Boolean(b.alt) === input.alt,
  );
  return found ? found.action : null;
}

/**
 * Tells whether an IPC message comes from the browser UI itself and not from a web page.
 * @param {Electron.IpcMainEvent | Electron.IpcMainInvokeEvent} event IPC event.
 * @returns {boolean} True when the sender is the main window's own renderer.
 */
function isTrustedSender(event) {
  return uiView !== null && event.sender === uiView.webContents;
}

/**
 * Reads the persisted UI state.
 * @returns {string | null} Raw JSON, or null on first launch or unreadable file.
 */
function readState() {
  try {
    return fs.readFileSync(STATE_FILE(), "utf8");
  } catch {
    return null;
  }
}

/**
 * Writes the UI state atomically (temp file + rename) so a crash never leaves a truncated file.
 * The previous version is kept as a .bak copy, like Arc's timestamped Storable*.json backups.
 * @param {string} json Serialized state, already validated.
 */
function writeState(json) {
  const file = STATE_FILE();
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, json, "utf8");
  if (fs.existsSync(file)) fs.copyFileSync(file, file + ".bak");
  fs.renameSync(tmp, file);
}

/**
 * Builds the right-click menu shown inside web pages.
 * @param {Electron.WebContents} guest Tab page.
 * @param {Electron.ContextMenuParams} params Click context.
 * @returns {Electron.Menu} Menu to pop up.
 */
function buildPageMenu(guest, params) {
  const host = uiContents();
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [];
  if (params.linkURL && isNavigableUrl(params.linkURL)) {
    template.push(
      { label: t("page.openInNewTab"), click: () => host?.send("tab:open", { url: params.linkURL, background: true }) },
      { label: t("common.peek"), click: () => host?.send("peek:open", { url: params.linkURL }) },
      { label: t("common.copyLink"), click: () => clipboard.writeText(params.linkURL) },
      { type: "separator" },
    );
  }
  if (params.selectionText) template.push({ role: "copy", label: t("common.copy") });
  if (params.isEditable) template.push({ role: "cut", label: t("page.cut") }, { role: "paste", label: t("page.paste") });
  if (params.selectionText || params.isEditable) template.push({ type: "separator" });
  const extensionItems = extensionController?.contextMenuItems(guest, params) ?? [];
  if (extensionItems.length) template.push(...extensionItems, { type: "separator" });
  template.push(
    { label: t("page.back"), enabled: guest.navigationHistory.canGoBack(), click: () => guest.navigationHistory.goBack() },
    { label: t("page.forward"), enabled: guest.navigationHistory.canGoForward(), click: () => guest.navigationHistory.goForward() },
    { label: t("page.reload"), click: () => guest.reload() },
    { type: "separator" },
    { label: t("page.inspect"), click: () => guest.inspectElement(params.x, params.y) },
  );
  return Menu.buildFromTemplate(template);
}

/**
 * Browser-window options for real popups opened by pages (window.open with features, used by "Sign
 * in with Google" and other OAuth flows). They share the tabs' session so the login lands in the
 * same cookies, and stay above the main window. Size and position come from the page's features.
 * @returns {Electron.BrowserWindowConstructorOptions} Popup options.
 */
function popupWindowOptions() {
  return {
    parent: mainWindow ?? undefined,
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}

/**
 * Decides what happens when a page opens a new window. Real popups are kept as windows because
 * OAuth flows need `window.opener` to send the result back to the page; destroying that link (by
 * opening the URL elsewhere) leaves the site waiting forever. Links meant for a new tab
 * (target=_blank, middle click) open as Yzo tabs instead.
 * @param {Electron.WebContents} contents Page that may open windows (tab or popup).
 */
function routeWindowOpen(contents) {
  contents.setWindowOpenHandler(({ url, disposition }) => {
    if (!isNavigableUrl(url)) return { action: "deny" };
    if (disposition === "new-window") return { action: "allow", overrideBrowserWindowOptions: popupWindowOptions() };
    uiContents()?.send("tab:open", { url, background: disposition === "background-tab" });
    return { action: "deny" };
  });
  contents.on("did-create-window", (popup) => setupPopup(popup));
}

/**
 * Locks down a popup window: same scheme filter as tabs, nested popups follow the same rules.
 * @param {BrowserWindow} popup Popup window created for a page.
 */
function setupPopup(popup) {
  popup.setMenu(null);
  popup.webContents.on("will-navigate", (event, url) => {
    if (!isNavigableUrl(url)) event.preventDefault();
  });
  routeWindowOpen(popup.webContents);
}

/**
 * Applies page-level policy to a tab's contents: shortcut forwarding (so browser shortcuts work while
 * the page has focus), popup and new-tab routing, scheme filtering and the page context menu.
 * @param {Electron.WebContents} guest Tab page contents.
 */
function setupPageContents(guest) {
  guest.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const action = matchShortcut(input);
    if (!action) return;
    event.preventDefault();
    uiContents()?.send("shortcut", action);
  });

  routeWindowOpen(guest);

  guest.on("will-navigate", (event, url) => {
    if (!isNavigableUrl(url)) event.preventDefault();
  });

  guest.on("context-menu", (_event, params) => {
    buildPageMenu(guest, params).popup({ window: mainWindow ?? undefined });
  });
}

/**
 * Returns the UI renderer's contents while it is alive.
 * @returns {Electron.WebContents | null} UI contents.
 */
function uiContents() {
  return uiView && !uiView.webContents.isDestroyed() ? uiView.webContents : null;
}

/**
 * Stacks the UI above or below the tab views. Below, the pages cover their slots as usual; above
 * (overlay open, floating sidebar, divider drag), the UI draws over live pages through its
 * transparent slots, so videos keep playing behind command bars, panels and the floating sidebar.
 * Peek and the popup menu stay on top in both cases.
 * @param {boolean} raised Whether the UI goes above the pages.
 */
function stackUi(raised) {
  const win = mainWindow;
  if (!win || win.isDestroyed() || !uiView) return;
  if (raised) {
    win.contentView.addChildView(uiView);
    viewManager?.bringPeekToFront();
    menuPopup?.bringToFront();
    // Overlays (command bar, panels) need the keyboard.
    uiView.webContents.focus();
  } else {
    win.contentView.addChildView(uiView, 0);
  }
}

/**
 * Creates the frameless browser window: the UI view at the bottom, tab views above it.
 */
function createWindow() {
  mainWindow = new BaseWindow({
    width: 1400,
    height: 900,
    minWidth: 760,
    minHeight: 480,
    frame: false,
    backgroundColor: "#1d1d22",
    show: false,
    ...(PRIVATE && { title: `Yzo (${t("topbar.private")})` }),
  });
  uiView = new WebContentsView({
    webPreferences: {
      // Generated from preload.cjs by scripts/build-preload.mjs (adds extension icon support).
      preload: path.join(__dirname, "preload.generated.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The UI drives the native tab views (layout sync) from animation frames and timers; they must
      // keep running when the window is occluded or in the background.
      backgroundThrottling: false,
    },
  });
  // Transparent so that, once stacked above the tabs, the pages show through the UI's empty slots.
  uiView.setBackgroundColor("#00000000");

  const win = mainWindow;
  const ui = uiView;
  const fitUi = () => {
    const { width, height } = win.getContentBounds();
    ui.setBounds({ x: 0, y: 0, width, height });
  };
  win.contentView.addChildView(ui);
  fitUi();
  win.on("resize", fitUi);
  ui.webContents.once("did-finish-load", () => win.show());
  win.on("maximize", () => ui.webContents.send("window:maximized", true));
  win.on("unmaximize", () => ui.webContents.send("window:maximized", false));
  win.on("enter-full-screen", () => ui.webContents.send("window:fullscreen", true));
  win.on("leave-full-screen", () => ui.webContents.send("window:fullscreen", false));
  // Lets the UI keep a revealed top bar open while the user drags the window by it.
  win.on("move", () => ui.webContents.send("window:moved"));
  win.on("closed", () => {
    viewManager = null;
    menuPopup = null;
    uiView = null;
    mainWindow = null;
    if (!ui.webContents.isDestroyed()) ui.webContents.close();
  });
  menuPopup = createMenuPopup({ getWindow: () => mainWindow, getUi: uiContents });
  viewManager = createViewManager({
    getWindow: () => mainWindow,
    getUi: uiContents,
    partition: PARTITION,
    isNavigableUrl,
    setupContents: setupPageContents,
    // Every tab page is exposed to extensions as a Chrome tab of this window.
    hooks: {
      onCreated: (_id, contents) => extensionController?.extensions.addTab(contents, win),
      onDestroyed: (_id, contents) => extensionController?.extensions.removeTab(contents),
      onActivated: (_id, contents) => extensionController?.extensions.selectTab(contents),
      onRaise: stackUi,
    },
  });

  // The UI never navigates or opens windows itself; only guests do.
  ui.webContents.on("will-navigate", (event) => event.preventDefault());
  ui.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  ui.webContents.on("before-input-event", (event, input) => {
    // Ctrl+R / F5 would reload the whole UI instead of the page: route them to the renderer.
    if (input.type === "keyDown" && matchShortcut(input) === "reload") {
      event.preventDefault();
      ui.webContents.send("shortcut", "reload");
    }
  });

  // Tabs are native views managed here; the UI is not allowed to embed <webview> guests.
  ui.webContents.on("will-attach-webview", (event) => event.preventDefault());

  // The UI reads "?private" to show the private look and leave out account and import.
  const query = PRIVATE ? { private: "1" } : {};
  if (DEV_URL) ui.webContents.loadURL(`${DEV_URL}${PRIVATE ? "?private=1" : ""}`);
  else ui.webContents.loadFile(path.join(__dirname, "..", "dist", "index.html"), { query });
}

// A private instance starts from a fresh state and keeps it in memory only.
ipcMain.handle("state:load", (event) => (isTrustedSender(event) && !PRIVATE ? readState() : null));

ipcMain.handle("state:save", (event, json) => {
  if (!isTrustedSender(event) || typeof json !== "string" || json.length > MAX_STATE_BYTES) return false;
  if (PRIVATE) return true;
  try {
    JSON.parse(json);
    writeState(json);
    return true;
  } catch {
    return false;
  }
});

ipcMain.on("window:control", (event, action) => {
  if (!isTrustedSender(event) || !mainWindow) return;
  if (action === "minimize") mainWindow.minimize();
  else if (action === "maximize") mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  else if (action === "fullscreen") mainWindow.setFullScreen(!mainWindow.isFullScreen());
  else if (action === "close") mainWindow.close();
});

// Floating top bar pressed: Windows moves the window like from its title bar (electron/window-drag.cjs).
ipcMain.on("window:drag", (event) => {
  if (!isTrustedSender(event) || !mainWindow || mainWindow.isDestroyed()) return;
  const cursor = screen.dipToScreenPoint(screen.getCursorScreenPoint());
  startNativeWindowDrag(mainWindow, cursor);
});

// Menus are drawn above the live pages (electron/menu-popup.cjs); resolves to the picked index or null.
ipcMain.handle("menu:popup", (event, entries, x, y) => (isTrustedSender(event) && menuPopup ? menuPopup.show(entries, x, y) : null));

/**
 * "Import from Arc": reads Arc's spaces, tabs, favorites and extensions, asks for confirmation, then
 * installs the extensions Yzo does not have yet (in the background) and returns the sidebar data for
 * the UI to add.
 * @returns {Promise<{ status: "notFound" | "cancelled" | "imported", data?: object, extensions?: number }>} Outcome.
 */
async function importFromArc() {
  const arc = readArc();
  const win = mainWindow;
  if (!arc || !win) return { status: "notFound" };
  const installed = new Set(extensionController?.list().map((ext) => ext.id) ?? []);
  const extensions = arc.extensions.filter((id) => EXTENSION_ID.test(id) && !installed.has(id));
  const tabs = arc.spaces.reduce((sum, space) => sum + countTabs(space.pinned) + countTabs(space.today), 0) + arc.favorites.length;
  const { response } = await electron.dialog.showMessageBox(win, {
    type: "question",
    buttons: [t("arcImport.import"), t("common.cancel")],
    defaultId: 0,
    cancelId: 1,
    title: t("arcImport.title"),
    message: t("arcImport.title"),
    detail: t("arcImport.detail", { spaces: arc.spaces.length, tabs, extensions: extensions.length }),
  });
  if (response !== 0) return { status: "cancelled" };
  // Web Store installs, one at a time; failures (removed from the store…) are skipped.
  void (async () => {
    for (const id of extensions) await extensionController?.install(id).catch(() => undefined);
  })();
  return { status: "imported", data: { spaces: arc.spaces, favorites: arc.favorites }, extensions: extensions.length };
}

// Icon of a tab that was never opened (imported, restored, synced), found without loading it.
ipcMain.handle("favicon:resolve", (event, url) => (isTrustedSender(event) ? resolveFavicon(session.fromPartition(PARTITION), url) : null));

ipcMain.handle("arc:import", (event) => (isTrustedSender(event) && !PRIVATE ? importFromArc() : null));

ipcMain.handle("window:isMaximized", (event) => isTrustedSender(event) && Boolean(mainWindow?.isMaximized()));
ipcMain.handle("window:isFullScreen", (event) => isTrustedSender(event) && Boolean(mainWindow?.isFullScreen()));

// Cursor position relative to the window content, in DIPs. Used by the floating sidebar because
// pointer events over a webview are delivered to the guest process, not to the UI.
ipcMain.handle("window:cursor", (event) => {
  if (!isTrustedSender(event) || !mainWindow) return null;
  const point = screen.getCursorScreenPoint();
  const bounds = mainWindow.getContentBounds();
  return { x: point.x - bounds.x, y: point.y - bounds.y, width: bounds.width, height: bounds.height };
});

ipcMain.on("views:sync", (event, payload) => {
  if (isTrustedSender(event)) viewManager?.sync(payload);
});


ipcMain.handle("extensions:list", (event) => (isTrustedSender(event) ? (extensionController?.list() ?? []) : []));

ipcMain.handle("extensions:uninstall", (event, id) => {
  if (!isTrustedSender(event) || typeof id !== "string" || !/^[a-p]{32}$/.test(id)) return false;
  return extensionController?.uninstall(id) ?? false;
});

/**
 * Registers an account IPC handler that only answers the UI and turns failures into stable codes.
 * @param {string} channel IPC channel.
 * @param {(...args: unknown[]) => Promise<unknown> | unknown} handler Account operation.
 */
function handleAccount(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event) || !account) return { ok: false, code: "unavailable" };
    try {
      return { ok: true, value: await handler(...args) };
    } catch (error) {
      if (error instanceof AccountError) return { ok: false, code: error.code };
      console.error(channel, error);
      return { ok: false, code: "internal" };
    }
  });
}

handleAccount("account:status", () => account.status());
handleAccount("account:signUp", (serverUrl, email, password) => account.signUp(serverUrl, email, password));
handleAccount("account:signIn", (serverUrl, email, password) => account.signIn(serverUrl, email, password));
handleAccount("account:signOut", () => account.signOut());
handleAccount("account:delete", () => account.deleteAccount());
handleAccount("sync:push", (records) => account.push(records));
handleAccount("sync:pull", (since) => account.pull(since));

ipcMain.handle("tab:command", (event, tabId, command, arg) =>
  isTrustedSender(event) ? (viewManager?.command(tabId, command, arg) ?? null) : null,
);

/**
 * Waits for the Widevine CDM (castLabs Electron for Content Security): installed on first launch,
 * updated in the background afterwards. Stock Electron has no `components` API; then this is a no-op.
 */
async function prepareWidevine() {
  const { components } = electron;
  if (!components) return;
  try {
    await Promise.race([components.whenReady(), new Promise((resolve) => setTimeout(resolve, WIDEVINE_TIMEOUT_MS))]);
  } catch (error) {
    console.error("Widevine CDM unavailable:", error);
  }
}

/**
 * Checks GitHub releases for a newer Yzo in packaged builds and installs it on quit
 * (electron-updater; feed configured by electron-builder's "publish" setting).
 */
function checkForUpdates() {
  if (!app.isPackaged) return;
  const { autoUpdater } = require("electron-updater");
  autoUpdater.checkForUpdatesAndNotify().catch((error) => console.error("Update check failed:", error.message));
}

/**
 * Manual update check from the Yzo menu. A found update downloads in the background and installs
 * on quit, like the startup check.
 * @returns {Promise<{ status: "dev" | "upToDate" | "available" | "error", version?: string }>} Outcome.
 */
async function checkForUpdatesNow() {
  if (!app.isPackaged) return { status: "dev" };
  try {
    const { autoUpdater } = require("electron-updater");
    const result = await autoUpdater.checkForUpdatesAndNotify();
    if (result?.isUpdateAvailable) return { status: "available", version: result.updateInfo.version };
    return { status: "upToDate", version: app.getVersion() };
  } catch (error) {
    console.error("Update check failed:", error.message);
    return { status: "error" };
  }
}

ipcMain.handle("app:checkForUpdates", (event) => (isTrustedSender(event) ? checkForUpdatesNow() : null));

// Site menu: shield state and blocked count, connection security, certificate, clearing site data.
ipcMain.handle("site:info", (event, webContentsId, url) => {
  if (!isTrustedSender(event) || typeof url !== "string" || !Number.isInteger(webContentsId)) return null;
  let host = "";
  let https = false;
  try {
    ({ hostname: host } = new URL(url));
    https = new URL(url).protocol === "https:";
  } catch {
    return null;
  }
  return {
    shield: shield?.status(webContentsId, url) ?? { enabled: false, blocked: 0 },
    secure: https,
    certificate: https && Boolean(siteInfo?.hasCertificate(host)),
  };
});

ipcMain.handle("site:setShield", (event, url, enabled) =>
  isTrustedSender(event) && typeof url === "string" && typeof enabled === "boolean" ? (shield?.setEnabled(url, enabled) ?? false) : false,
);

ipcMain.handle("site:certificate", (event, host) =>
  isTrustedSender(event) && typeof host === "string" && mainWindow ? (siteInfo?.showCertificate(mainWindow, host) ?? false) : false,
);

ipcMain.handle("site:clear", (event, url, kind) =>
  isTrustedSender(event) && typeof url === "string" && (kind === "cache" || kind === "cookies") ? (siteInfo?.clear(url, kind) ?? false) : false,
);

ipcMain.on("app:openPrivate", (event) => {
  if (!isTrustedSender(event)) return;
  try {
    launchPrivateInstance();
  } catch (error) {
    console.error("Private browsing unavailable:", error);
  }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await prepareWidevine();
  const tabsSession = session.fromPartition(PARTITION);
  tabsSession.setUserAgent(USER_AGENT);
  tabsSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  siteInfo = createSiteInfo(tabsSession);
  // A private instance uses the normal profile's engine and site choices, but writes neither.
  shield = setupShield({ session: tabsSession, dataPath: PRIVATE ? mainProfilePath() : app.getPath("userData"), readOnly: PRIVATE });
  if (PRIVATE) {
    // No account, sync, extensions or updates: they would keep data or run outside the private session.
    claimPrivateProfile();
    createWindow();
    return;
  }
  account = createAccount({ userDataPath: app.getPath("userData"), defaultServerUrl: DEFAULT_SYNC_URL });
  // Extensions load before the first tab exists so every tab is registered with them.
  try {
    extensionController = await setupExtensions({ session: tabsSession, getWindow: () => mainWindow, getUi: uiContents, getViews: () => viewManager });
  } catch (error) {
    console.error("Chrome extensions unavailable:", error);
  }
  createWindow();
  checkForUpdates();
});

app.on("window-all-closed", () => app.quit());
