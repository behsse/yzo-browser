// Electron main process: owns the frameless windows, persistence and every tab page (WebContentsView).
const electron = require("electron");
const { app, BaseWindow, WebContentsView, ipcMain, Menu, clipboard, screen, session } = electron;
const path = require("node:path");
const fs = require("node:fs");
const shortcuts = require("../shared/shortcuts.json");
const { createViewManager, windowOf, windowOfTab } = require("./views.cjs");
const { createMenuPopup } = require("./menu-popup.cjs");
const { setupExtensions } = require("./extensions.cjs");
const { createAccount, AccountError } = require("./account.cjs");
const { readArc, countTabs, EXTENSION_ID } = require("./arc-import.cjs");
const { resolveFavicon } = require("./favicon.cjs");
const { startNativeWindowDrag } = require("./window-drag.cjs");
const { isPrivateInstance, launchPrivateInstance, claimPrivateProfile, mainProfilePath } = require("./private-mode.cjs");
const { setupShield } = require("./shield.cjs");
const { hasPrivateExtensions } = require("./extension-store.cjs");
const { createSiteInfo } = require("./site-info.cjs");
const { setupDownloads } = require("./downloads.cjs");
const { t } = require("./i18n.cjs");

// Development runs keep their own profile (%APPDATA%\Yzo Dev), apart from the installed Yzo's
// (%APPDATA%\Yzo): both would otherwise share tabs, extensions, settings and the account. An explicit
// --user-data-dir (private instances, tests) wins. Must run before anything reads the profile path.
if (!app.isPackaged && !process.argv.some((arg) => arg.startsWith("--user-data-dir"))) {
  app.setPath("userData", path.join(app.getPath("appData"), "Yzo Dev"));
}

/** Private instance (electron/private-mode.cjs): nothing it browses or changes is kept. */
const PRIVATE = isPrivateInstance();
/**
 * Private windows that run extensions (allowed by the user) need an on-disk session: Electron cannot
 * load extensions in an in-memory one. It lives in the throwaway profile and is wiped when the
 * window closes (below); the others stay in memory only (no "persist:" prefix).
 */
const PRIVATE_EXTENSIONS = PRIVATE && hasPrivateExtensions(mainProfilePath());
const PARTITION = PRIVATE ? (PRIVATE_EXTENSIONS ? "persist:yzo-private" : "yzo-private") : "persist:yzo";
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

// Chromium's overlay scrollbars, like Arc's: drawn over the page (no column, no track), thin and rounded,
// shown while scrolling, dark on light pages and light on dark ones. A site that styles its own
// scrollbars keeps them.
app.commandLine.appendSwitch("enable-features", "OverlayScrollbar");

/**
 * One browser window. The UI is a view of its own (not the window's built-in contents) so it can be
 * stacked above the tab views while an overlay is open, with a transparent background where the pages
 * are. Windows share the sidebar (one state, see state:save) and each shows its own tab.
 * @typedef {{
 *   win: BaseWindow,
 *   ui: WebContentsView,
 *   views: ReturnType<typeof createViewManager>,
 *   menuPopup: ReturnType<typeof createMenuPopup>,
 *   lastStateJson?: string,
 *   closing?: boolean,
 *   closeReady?: boolean,
 *   closeTimer?: NodeJS.Timeout,
 * }} BrowserWindowContext
 */

/** Longest wait for a closing window's UI to archive its tabs before it closes anyway. */
const CLOSE_TIMEOUT_MS = 2000;
/** Set once the app is quitting: windows then close as they are (their tabs come back next time). */
let quitting = false;

/** Open windows, oldest first. The oldest runs the account sync. @type {BrowserWindowContext[]} */
const windows = [];
/** Window the user used last: extensions and outside requests act in it. @type {BrowserWindowContext | null} */
let focusedContext = null;
/** Last state saved by any window, and its part shared by all windows (everything but `window`). */
let lastStateJson = null;
let lastSharedJson = null;
/** @type {Awaited<ReturnType<typeof setupExtensions>> | null} */
let extensionController = null;
/** @type {ReturnType<typeof createAccount> | null} */
let account = null;
/** @type {ReturnType<typeof setupShield> | null} */
let shield = null;
/** @type {ReturnType<typeof createSiteInfo> | null} */
let siteInfo = null;
/** @type {ReturnType<typeof setupDownloads> | null} */
let downloads = null;

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
 * Finds the window whose browser UI sent an IPC message.
 * @param {Electron.IpcMainEvent | Electron.IpcMainInvokeEvent} event IPC event.
 * @returns {BrowserWindowContext | null} The window, or null when a web page (or anything else) sent it.
 */
function contextOf(event) {
  return windows.find((ctx) => !ctx.ui.webContents.isDestroyed() && event.sender === ctx.ui.webContents) ?? null;
}

/**
 * Tells whether an IPC message comes from a browser UI itself and not from a web page.
 * @param {Electron.IpcMainEvent | Electron.IpcMainInvokeEvent} event IPC event.
 * @returns {boolean} True when the sender is one of the windows' own renderer.
 */
function isTrustedSender(event) {
  return contextOf(event) !== null;
}

/**
 * Finds the context of a native window.
 * @param {Electron.BaseWindow | null} win Window.
 * @returns {BrowserWindowContext | null} Its context, or null.
 */
function contextOfWindow(win) {
  return (win && windows.find((ctx) => ctx.win === win)) ?? null;
}

/**
 * Window the user used last (falls back to the newest open one).
 * @returns {BrowserWindowContext | null} Context, or null when no window is open.
 */
function currentContext() {
  return focusedContext && windows.includes(focusedContext) ? focusedContext : (windows.at(-1) ?? null);
}

/**
 * UI of the window the user used last.
 * @returns {Electron.WebContents | null} UI contents.
 */
function currentUi() {
  const ctx = currentContext();
  return ctx && !ctx.ui.webContents.isDestroyed() ? ctx.ui.webContents : null;
}

/**
 * UI of the window a page is in (the window used last for pages not in a window yet).
 * @param {Electron.WebContents} contents Tab or Peek page.
 * @returns {Electron.WebContents | null} UI contents.
 */
function uiFor(contents) {
  const ctx = contextOfWindow(windowOf(contents)) ?? currentContext();
  return ctx && !ctx.ui.webContents.isDestroyed() ? ctx.ui.webContents : null;
}

/**
 * Sends a message to every window's UI.
 * @param {string} channel IPC channel.
 * @param {...unknown} args Payload.
 */
function sendToAllUis(channel, ...args) {
  for (const ctx of windows) if (!ctx.ui.webContents.isDestroyed()) ctx.ui.webContents.send(channel, ...args);
}

/**
 * Part of a saved state that all windows share: everything but the window's own layout, selection and
 * today tabs (each window has its own, see withLocalToday in src/state/reducer.ts). Comparing it tells
 * whether the other windows need the state, and keeps them from echoing it back and forth.
 * @param {string} json Serialized state.
 * @returns {string | null} Shared part, or null when the JSON is invalid.
 */
function sharedPartOf(json) {
  try {
    const { window: _window, ...shared } = JSON.parse(json);
    const items = { ...shared.items };
    const spaces = {};
    for (const [id, space] of Object.entries(shared.spaces ?? {})) {
      const stack = [space.todayId];
      while (stack.length) {
        const item = items[stack.pop()];
        if (!item) continue;
        stack.push(...item.childrenIds);
        delete items[item.id];
      }
      const { todayId: _today, ...rest } = space;
      spaces[id] = rest;
    }
    return JSON.stringify({ ...shared, items, spaces });
  } catch {
    return null;
  }
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
  const host = uiFor(guest);
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
 * same cookies, and stay above the window of the page that opened them. Size and position come from
 * the page's features.
 * @param {Electron.BaseWindow | null} parent Window of the opening page.
 * @returns {Electron.BrowserWindowConstructorOptions} Popup options.
 */
function popupWindowOptions(parent) {
  return {
    parent: parent ?? currentContext()?.win ?? undefined,
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
    if (disposition === "new-window") return { action: "allow", overrideBrowserWindowOptions: popupWindowOptions(windowOf(contents)) };
    uiFor(contents)?.send("tab:open", { url, background: disposition === "background-tab" });
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
    uiFor(guest)?.send("shortcut", action);
  });

  routeWindowOpen(guest);

  guest.on("will-navigate", (event, url) => {
    if (!isNavigableUrl(url)) event.preventDefault();
  });

  guest.on("context-menu", (_event, params) => {
    const win = windowOf(guest) ?? currentContext()?.win;
    buildPageMenu(guest, params).popup({ window: /** @type {Electron.BaseWindow} */ (win) ?? undefined });
  });
}

/**
 * Stacks a window's UI above or below its tab views. Below, the pages cover their slots as usual;
 * above (overlay open, floating sidebar, divider drag), the UI draws over live pages through its
 * transparent slots, so videos keep playing behind command bars, panels and the floating sidebar.
 * Peek and the popup menu stay on top in both cases.
 * @param {BrowserWindowContext} ctx Window.
 * @param {boolean} raised Whether the UI goes above the pages.
 */
function stackUi(ctx, raised) {
  const { win, ui } = ctx;
  if (win.isDestroyed()) return;
  if (raised) {
    win.contentView.addChildView(ui);
    ctx.views.bringPeekToFront();
    ctx.menuPopup.bringToFront();
    // Overlays (command bar, panels) need the keyboard.
    ui.webContents.focus();
  } else {
    win.contentView.addChildView(ui, 0);
  }
}

/**
 * Lets a closing window go, once its UI has archived its tabs (or did not answer in time).
 * @param {BrowserWindowContext} ctx Closing window.
 */
function finishClose(ctx) {
  clearTimeout(ctx.closeTimer);
  ctx.closeReady = true;
  if (!ctx.win.isDestroyed()) ctx.win.close();
}

/**
 * Creates a frameless browser window: the UI view at the bottom, tab views above it. The first one
 * opens the saved state; the next ones ("New window") share its sidebar and start without a tab.
 * @returns {BrowserWindowContext} The new window.
 */
function createWindow() {
  const additional = windows.length > 0;
  const previous = currentContext()?.win;
  const win = new BaseWindow({
    width: 1400,
    height: 900,
    minWidth: 760,
    minHeight: 480,
    frame: false,
    backgroundColor: "#1d1d22",
    show: false,
    ...(PRIVATE && { title: `Yzo (${t("topbar.private")})` }),
  });
  // A new window opens a little below and right of the one it was opened from, like other browsers.
  if (additional && previous && !previous.isDestroyed() && !previous.isMaximized() && !previous.isFullScreen()) {
    const { x, y } = previous.getBounds();
    win.setPosition(x + 28, y + 28);
  }
  const ui = new WebContentsView({
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
  ui.setBackgroundColor("#00000000");

  /** @type {BrowserWindowContext} */
  const ctx = /** @type {BrowserWindowContext} */ ({ win, ui });
  ctx.menuPopup = createMenuPopup({ getWindow: () => (win.isDestroyed() ? null : win), getUi: () => (ui.webContents.isDestroyed() ? null : ui.webContents) });
  ctx.views = createViewManager({
    getWindow: () => (win.isDestroyed() ? null : win),
    getUi: () => (ui.webContents.isDestroyed() ? null : ui.webContents),
    partition: PARTITION,
    isNavigableUrl,
    setupContents: setupPageContents,
    // Every tab page is exposed to extensions as a Chrome tab of the window it is in.
    hooks: {
      onCreated: (_id, contents) => extensionController?.addTab(contents, win),
      onDestroyed: (_id, contents) => extensionController?.removeTab(contents),
      onMoved: (_id, contents) => extensionController?.moveTab(contents, win),
      onActivated: (_id, contents) => extensionController?.selectTab(contents),
      onRaise: (raised) => stackUi(ctx, raised),
    },
  });
  windows.push(ctx);
  focusedContext = ctx;

  const fitUi = () => {
    const { width, height } = win.getContentBounds();
    ui.setBounds({ x: 0, y: 0, width, height });
  };
  win.contentView.addChildView(ui);
  fitUi();
  win.on("resize", () => {
    fitUi();
    ctx.views.relayout();
  });
  win.on("focus", () => {
    focusedContext = ctx;
  });
  ui.webContents.once("did-finish-load", () => win.show());
  // A reloaded UI lost the pages' colors; the views keep them.
  ui.webContents.on("did-finish-load", () => ctx.views.resendColors());
  win.on("maximize", () => ui.webContents.send("window:maximized", true));
  win.on("unmaximize", () => ui.webContents.send("window:maximized", false));
  win.on("enter-full-screen", () => ui.webContents.send("window:fullscreen", true));
  win.on("leave-full-screen", () => {
    ui.webContents.send("window:fullscreen", false);
    ctx.views.exitFullScreen();
  });
  // Lets the UI keep a revealed top bar open while the user drags the window by it.
  win.on("move", () => ui.webContents.send("window:moved"));
  // A window closed while others stay open archives its today tabs first (its UI does, then answers
  // window:closeReady). The last window, or quitting, keeps them for the next launch.
  win.on("close", (event) => {
    if (ctx.closeReady || quitting || windows.length <= 1 || ui.webContents.isDestroyed()) return;
    event.preventDefault();
    if (ctx.closing) return;
    ctx.closing = true;
    ui.webContents.send("window:closing");
    ctx.closeTimer = setTimeout(() => finishClose(ctx), CLOSE_TIMEOUT_MS);
  });
  win.on("closed", () => {
    clearTimeout(ctx.closeTimer);
    const wasLeader = windows[0] === ctx;
    windows.splice(windows.indexOf(ctx), 1);
    if (focusedContext === ctx) focusedContext = windows.at(-1) ?? null;
    ctx.menuPopup.dispose();
    ctx.views.destroyAll();
    if (!ui.webContents.isDestroyed()) ui.webContents.close();
    // The oldest window runs the account sync and writes the state file: the next one takes over.
    const leader = windows[0];
    if (wasLeader && leader && !leader.ui.webContents.isDestroyed()) {
      leader.ui.webContents.send("sync:leader", true);
      if (leader.lastStateJson && !PRIVATE) writeState(leader.lastStateJson);
    }
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

  // The UI reads "?private" to show the private look and leave out account and import, "partition"
  // to reach the extensions of the tabs' session, and "window=new" to start without a tab.
  const query = {
    ...(PRIVATE && { private: "1", partition: PARTITION }),
    ...(additional && { window: "new" }),
  };
  const search = new URLSearchParams(query).toString();
  if (DEV_URL) ui.webContents.loadURL(`${DEV_URL}${search ? `?${search}` : ""}`);
  else ui.webContents.loadFile(path.join(__dirname, "..", "dist", "index.html"), { query });
  return ctx;
}

// The first window reads the saved state; the next ones get the latest state of the open windows. A
// private instance starts from a fresh state and keeps it in memory only.
ipcMain.handle("state:load", (event) => {
  if (!isTrustedSender(event)) return null;
  if (lastStateJson !== null) return lastStateJson;
  return PRIVATE ? null : readState();
});

// Every window saves its whole state. When the shared part changed, the other windows take it, so they
// all show the same spaces, pinned tabs and favorites. Only the oldest window writes the file: its today
// tabs are the ones a relaunch brings back (the others' are archived when they close).
ipcMain.handle("state:save", (event, json) => {
  const ctx = contextOf(event);
  // A window that has archived its tabs and is closing: a late save (page unload) must not undo that.
  if (!ctx || ctx.closeReady || typeof json !== "string" || json.length > MAX_STATE_BYTES) return false;
  const shared = sharedPartOf(json);
  if (shared === null) return false;
  lastStateJson = json;
  ctx.lastStateJson = json;
  if (shared !== lastSharedJson) {
    lastSharedJson = shared;
    for (const other of windows) if (other !== ctx && !other.ui.webContents.isDestroyed()) other.ui.webContents.send("state:shared", json);
  }
  if (PRIVATE || windows[0] !== ctx) return true;
  try {
    writeState(json);
    return true;
  } catch {
    return false;
  }
});

// The account sync runs in one window only (the oldest), or two windows would push the same changes.
ipcMain.handle("sync:isLeader", (event) => {
  const ctx = contextOf(event);
  return ctx !== null && windows[0] === ctx;
});

ipcMain.on("app:newWindow", (event) => {
  if (isTrustedSender(event)) createWindow();
});

// The closing window's UI archived its today tabs and saved.
ipcMain.on("window:closeReady", (event) => {
  const ctx = contextOf(event);
  if (ctx?.closing) finishClose(ctx);
});

ipcMain.on("window:control", (event, action) => {
  const win = contextOf(event)?.win;
  if (!win || win.isDestroyed()) return;
  if (action === "minimize") win.minimize();
  else if (action === "maximize") win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === "fullscreen") win.setFullScreen(!win.isFullScreen());
  else if (action === "close") win.close();
  else if (action === "quit") app.quit();
});

// Floating top bar pressed: Windows moves the window like from its title bar (electron/window-drag.cjs).
ipcMain.on("window:drag", (event) => {
  const win = contextOf(event)?.win;
  if (!win || win.isDestroyed()) return;
  const cursor = screen.dipToScreenPoint(screen.getCursorScreenPoint());
  startNativeWindowDrag(win, cursor);
});

// Menus are drawn above the live pages (electron/menu-popup.cjs); resolves to the picked index or null.
ipcMain.handle("menu:popup", (event, entries, x, y) => contextOf(event)?.menuPopup.show(entries, x, y) ?? null);
ipcMain.on("menu:updateZoom", (event, index, value) => {
  contextOf(event)?.menuPopup.updateZoom(index, value);
});

/**
 * "Import from Arc": reads Arc's spaces, tabs, favorites and extensions, asks for confirmation, then
 * installs the extensions Yzo does not have yet (in the background) and returns the sidebar data for
 * the UI to add.
 * @returns {Promise<{ status: "notFound" | "cancelled" | "imported", data?: object, extensions?: number }>} Outcome.
 */
async function importFromArc() {
  const arc = readArc();
  const win = currentContext()?.win;
  if (!arc || !win) return { status: "notFound" };
  const installed = new Set((await extensionController?.list())?.map((ext) => ext.id) ?? []);
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

ipcMain.handle("window:isMaximized", (event) => Boolean(contextOf(event)?.win.isMaximized()));
ipcMain.handle("window:isFullScreen", (event) => Boolean(contextOf(event)?.win.isFullScreen()));

// Cursor position relative to the window content, in DIPs. Used by the floating sidebar because
// pointer events over a webview are delivered to the guest process, not to the UI.
ipcMain.handle("window:cursor", (event) => {
  const win = contextOf(event)?.win;
  if (!win || win.isDestroyed()) return null;
  const point = screen.getCursorScreenPoint();
  const bounds = win.getContentBounds();
  return { x: point.x - bounds.x, y: point.y - bounds.y, width: bounds.width, height: bounds.height };
});

ipcMain.on("views:sync", (event, payload) => {
  contextOf(event)?.views.sync(payload);
});

// Placeholder of a tab whose page another window shows: bring the page here, or go to that window.
ipcMain.on("views:claim", (event, tabId) => {
  contextOf(event)?.views.claim(tabId);
});
ipcMain.on("views:showOwner", (event, tabId) => {
  if (!isTrustedSender(event) || typeof tabId !== "string") return;
  const win = windowOfTab(tabId);
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});


ipcMain.handle("extensions:list", (event) => (isTrustedSender(event) ? (extensionController?.list() ?? []) : []));

ipcMain.handle("extensions:setEnabled", (event, id, enabled) => {
  if (!isTrustedSender(event) || typeof id !== "string" || !/^[a-p]{32}$/.test(id) || typeof enabled !== "boolean") return false;
  return extensionController?.setEnabled(id, enabled) ?? false;
});

ipcMain.handle("extensions:setPrivateAllowed", (event, id, allowed) => {
  if (!isTrustedSender(event) || typeof id !== "string" || !/^[a-p]{32}$/.test(id) || typeof allowed !== "boolean") return false;
  return extensionController?.setPrivateAllowed(id, allowed) ?? false;
});

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

/**
 * Runs an account change, then tells every window (the one that syncs may not be the one used).
 * @template T
 * @param {() => Promise<T>} change Sign-in, sign-out…
 * @returns {Promise<T>} Its result.
 */
async function changeAccount(change) {
  try {
    return await change();
  } finally {
    sendToAllUis("account:changed");
  }
}

handleAccount("account:status", () => account.status());
handleAccount("account:signUp", (serverUrl, email, password) => changeAccount(() => account.signUp(serverUrl, email, password)));
handleAccount("account:signIn", (serverUrl, email, password) => changeAccount(() => account.signIn(serverUrl, email, password)));
handleAccount("account:signOut", () => changeAccount(() => account.signOut()));
handleAccount("account:delete", () => changeAccount(() => account.deleteAccount()));
handleAccount("sync:push", (records) => account.push(records));
handleAccount("sync:pull", (since) => account.pull(since));

ipcMain.handle("tab:command", (event, tabId, command, arg) =>
  contextOf(event)?.views.command(tabId, command, arg) ?? null,
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
ipcMain.handle("app:version", (event) => (isTrustedSender(event) ? app.getVersion() : ""));

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
  typeof host === "string" && contextOf(event) ? (siteInfo?.showCertificate(contextOf(event).win, host) ?? false) : false,
);

ipcMain.handle("site:clear", (event, url, kind) =>
  isTrustedSender(event) && typeof url === "string" && (kind === "cache" || kind === "cookies") ? (siteInfo?.clear(url, kind) ?? false) : false,
);

// Downloads panel, yzo://downloads and yzo://settings/downloads (electron/downloads.cjs).
ipcMain.handle("downloads:list", (event) => (isTrustedSender(event) ? (downloads?.list() ?? []) : []));
ipcMain.handle("downloads:act", (event, id, action) =>
  isTrustedSender(event) && typeof id === "string" && typeof action === "string" ? (downloads?.act(id, action) ?? false) : false,
);
ipcMain.handle("downloads:clear", (event) => {
  if (isTrustedSender(event)) downloads?.clear();
});
ipcMain.handle("downloads:getSettings", (event) => (isTrustedSender(event) ? (downloads?.getSettings() ?? null) : null));
ipcMain.handle("downloads:updateSettings", (event, change) =>
  isTrustedSender(event) && change && typeof change === "object" ? (downloads?.updateSettings(change) ?? null) : null,
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
  downloads = setupDownloads({
    session: tabsSession,
    profile: PRIVATE ? mainProfilePath() : app.getPath("userData"),
    privateMode: PRIVATE,
    getUi: currentUi,
    broadcast: sendToAllUis,
    getWindow: () => currentContext()?.win ?? null,
  });
  // A private instance uses the normal profile's engine and site choices, but writes neither.
  shield = setupShield({ session: tabsSession, dataPath: PRIVATE ? mainProfilePath() : app.getPath("userData"), readOnly: PRIVATE });
  if (PRIVATE) {
    // No account, sync or updates. Only the extensions the user allowed in private windows run, in the
    // in-memory session.
    claimPrivateProfile();
    try {
      extensionController = await setupExtensions({
        session: tabsSession,
        getWindow: () => currentContext()?.win ?? null,
        getUi: currentUi,
        getUiOf: (win) => contextOfWindow(win)?.ui.webContents ?? null,
        profile: mainProfilePath(),
        privateMode: true,
      });
    } catch (error) {
      console.error("Chrome extensions unavailable:", error);
    }
    createWindow();
    return;
  }
  account = createAccount({ userDataPath: app.getPath("userData"), defaultServerUrl: DEFAULT_SYNC_URL });
  // Extensions load before the first tab exists so every tab is registered with them.
  try {
    extensionController = await setupExtensions({
      session: tabsSession,
      getWindow: () => currentContext()?.win ?? null,
      getUi: currentUi,
      getUiOf: (win) => contextOfWindow(win)?.ui.webContents ?? null,
      profile: app.getPath("userData"),
    });
  } catch (error) {
    console.error("Chrome extensions unavailable:", error);
  }
  createWindow();
  checkForUpdates();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  quitting = true;
});

// A private window with extensions browsed in an on-disk session: wipe it before quitting.
let privateSessionWiped = false;
app.on("before-quit", (event) => {
  if (!PRIVATE_EXTENSIONS || privateSessionWiped) return;
  event.preventDefault();
  const tabs = session.fromPartition(PARTITION);
  Promise.allSettled([tabs.clearStorageData(), tabs.clearCache()]).finally(() => {
    privateSessionWiped = true;
    app.quit();
  });
});
