// Electron main process: owns the frameless window, persistence and every tab page (WebContentsView).
const { app, BrowserWindow, ipcMain, Menu, clipboard, screen, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const shortcuts = require("../shared/shortcuts.json");
const { createViewManager } = require("./views.cjs");
const { setupExtensions } = require("./extensions.cjs");
const { createAccount, AccountError } = require("./account.cjs");

const PARTITION = "persist:yzo";
const STATE_FILE = () => path.join(app.getPath("userData"), "yzo-state.json");
const MAX_STATE_BYTES = 10 * 1024 * 1024;
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const ALLOWED_PERMISSIONS = new Set(["fullscreen", "clipboard-sanitized-write", "pointerLock"]);

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

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {ReturnType<typeof createViewManager> | null} */
let viewManager = null;
/** @type {Awaited<ReturnType<typeof setupExtensions>> | null} */
let extensionController = null;
/** @type {ReturnType<typeof createAccount> | null} */
let account = null;

/**
 * Sync server used until the user picks one: YZO_SYNC_URL, or the local development server.
 * Packaged builds without YZO_SYNC_URL start empty so the user must enter the server address.
 */
const DEFAULT_SYNC_URL = process.env.YZO_SYNC_URL ?? (app.isPackaged ? "" : "http://127.0.0.1:3100");

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
  return mainWindow !== null && event.sender === mainWindow.webContents;
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
  const host = mainWindow?.webContents;
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [];
  if (params.linkURL && isNavigableUrl(params.linkURL)) {
    template.push(
      { label: "Ouvrir dans un nouvel onglet", click: () => host?.send("tab:open", { url: params.linkURL, background: true }) },
      { label: "Aperçu (Peek)", click: () => host?.send("peek:open", { url: params.linkURL }) },
      { label: "Copier le lien", click: () => clipboard.writeText(params.linkURL) },
      { type: "separator" },
    );
  }
  if (params.selectionText) template.push({ role: "copy", label: "Copier" });
  if (params.isEditable) template.push({ role: "cut", label: "Couper" }, { role: "paste", label: "Coller" });
  if (params.selectionText || params.isEditable) template.push({ type: "separator" });
  const extensionItems = extensionController?.contextMenuItems(guest, params) ?? [];
  if (extensionItems.length) template.push(...extensionItems, { type: "separator" });
  template.push(
    { label: "Précédent", enabled: guest.navigationHistory.canGoBack(), click: () => guest.navigationHistory.goBack() },
    { label: "Suivant", enabled: guest.navigationHistory.canGoForward(), click: () => guest.navigationHistory.goForward() },
    { label: "Recharger", click: () => guest.reload() },
    { type: "separator" },
    { label: "Inspecter", click: () => guest.inspectElement(params.x, params.y) },
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
    mainWindow?.webContents.send("tab:open", { url, background: disposition === "background-tab" });
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
    mainWindow?.webContents.send("shortcut", action);
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
 * Creates the frameless browser window and locks down its own renderer.
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 760,
    minHeight: 480,
    frame: false,
    backgroundColor: "#1d1d22",
    show: false,
    webPreferences: {
      // Generated from preload.cjs by scripts/build-preload.mjs (adds extension icon support).
      preload: path.join(__dirname, "preload.generated.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The UI drives the native tab views (layout sync, freeze screenshots) from animation frames
      // and timers; they must keep running when the window is occluded or in the background.
      backgroundThrottling: false,
    },
  });

  const win = mainWindow;
  win.once("ready-to-show", () => win.show());
  win.on("maximize", () => win.webContents.send("window:maximized", true));
  win.on("unmaximize", () => win.webContents.send("window:maximized", false));
  win.on("closed", () => {
    viewManager = null;
    mainWindow = null;
  });
  viewManager = createViewManager({
    getWindow: () => mainWindow,
    partition: PARTITION,
    isNavigableUrl,
    setupContents: setupPageContents,
    // Every tab page is exposed to extensions as a Chrome tab of this window.
    hooks: {
      onCreated: (_id, contents) => extensionController?.extensions.addTab(contents, win),
      onDestroyed: (_id, contents) => extensionController?.extensions.removeTab(contents),
      onActivated: (_id, contents) => extensionController?.extensions.selectTab(contents),
    },
  });

  // The UI never navigates or opens windows itself; only guests do.
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("before-input-event", (event, input) => {
    // Ctrl+R / F5 would reload the whole UI instead of the page: route them to the renderer.
    if (input.type === "keyDown" && matchShortcut(input) === "reload") {
      event.preventDefault();
      win.webContents.send("shortcut", "reload");
    }
  });

  // Tabs are native views managed here; the UI is not allowed to embed <webview> guests.
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

ipcMain.handle("state:load", (event) => (isTrustedSender(event) ? readState() : null));

ipcMain.handle("state:save", (event, json) => {
  if (!isTrustedSender(event) || typeof json !== "string" || json.length > MAX_STATE_BYTES) return false;
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
  else if (action === "close") mainWindow.close();
});

ipcMain.handle("window:isMaximized", (event) => isTrustedSender(event) && Boolean(mainWindow?.isMaximized()));

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

ipcMain.on("views:ack", (event, token) => {
  if (isTrustedSender(event)) viewManager?.ackSnapshots(token);
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

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const tabsSession = session.fromPartition(PARTITION);
  tabsSession.setUserAgent(USER_AGENT);
  tabsSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  account = createAccount({ userDataPath: app.getPath("userData"), defaultServerUrl: DEFAULT_SYNC_URL });
  // Extensions load before the first tab exists so every tab is registered with them.
  try {
    extensionController = await setupExtensions({ session: tabsSession, getWindow: () => mainWindow, getViews: () => viewManager });
  } catch (error) {
    console.error("Chrome extensions unavailable:", error);
  }
  createWindow();
});

app.on("window-all-closed", () => app.quit());
