// Tab views: one WebContentsView per loaded tab (plus one for Peek), driven by the UI renderer.
//
// The renderer owns layout. It sends the list of loaded tabs with the on-screen rectangle of each
// visible one (views:sync); this module creates, positions, shows and destroys native views to
// match. The tab views normally sit above the UI view; while an overlay is open (command bar, floating
// sidebar, panels, divider drag) the UI asks to be "raised" above them and draws over the live pages
// through its transparent slots (see stackUi in main.cjs).
const { WebContentsView, app, dialog } = require("electron");
const path = require("node:path");
const { dominantColor } = require("./page-color.cjs");

const PEEK_ID = "__peek__";
const ID_PATTERN = /^[\w-]{1,64}$/;
const MAX_TABS = 500;
const VIEW_RADIUS = 10;

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Bounds
 * @typedef {{ id: string, url: string, bounds: Bounds | null }} TabEntry
 * @typedef {{ tabs: TabEntry[], raised: boolean, peek: { url: string, bounds: Bounds | null } | null, activeTabId: string | null }} SyncPayload
 * @typedef {{
 *   onCreated?(id: string, contents: Electron.WebContents): void,
 *   onDestroyed?(id: string, contents: Electron.WebContents): void,
 *   onActivated?(id: string, contents: Electron.WebContents): void,
 *   onRaise?(raised: boolean): void,
 * }} ViewHooks
 */

/**
 * Validates and rounds a rectangle coming from the renderer.
 * @param {unknown} value Candidate bounds.
 * @returns {Bounds | null} Integer bounds, or null when absent or invalid.
 */
function toBounds(value) {
  if (!value || typeof value !== "object") return null;
  const { x, y, width, height } = /** @type {Record<string, unknown>} */ (value);
  const numbers = [x, y, width, height];
  if (!numbers.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const rect = { x: Math.round(Number(x)), y: Math.round(Number(y)), width: Math.round(Number(width)), height: Math.round(Number(height)) };
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

/** Rows of pixels read at the top of a page for its color. */
const COLOR_STRIP_HEIGHT = 4;
/** Wait after a page settles before reading its color (late styles, fades). */
const COLOR_DELAY_MS = 350;
/** How often the color of the shown pages is read again. */
const COLOR_REFRESH_MS = 2000;

/** Zoom steps, like Chrome's. */
const ZOOM_FACTORS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

/**
 * Zooms a page one step in or out, back to 100 %, or reads its zoom. Chromium keeps the zoom per site.
 * @param {Electron.WebContents} contents Page.
 * @param {unknown} step "in", "out", "reset" or "get".
 * @returns {number} Zoom factor after the change.
 */
function zoomPage(contents, step) {
  const current = contents.getZoomFactor();
  let next = current;
  if (step === "in") next = ZOOM_FACTORS.find((f) => f > current + 0.001) ?? current;
  else if (step === "out") next = [...ZOOM_FACTORS].reverse().find((f) => f < current - 0.001) ?? current;
  else if (step === "reset") next = 1;
  if (next !== current) contents.setZoomFactor(next);
  return next;
}

/**
 * Saves a page with its resources ("Save page as…"), where the user picks.
 * @param {Electron.WebContents} contents Page.
 * @param {Electron.BaseWindow | null} win Parent of the save dialog.
 * @returns {Promise<boolean>} Whether it was saved.
 */
async function savePage(contents, win) {
  const name = (contents.getTitle() || "page").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 120);
  const options = { defaultPath: path.join(app.getPath("downloads"), `${name}.html`), filters: [{ name: "HTML", extensions: ["html", "htm"] }] };
  const result = win && !win.isDestroyed() ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return false;
  await contents.savePage(result.filePath, "HTMLComplete");
  return true;
}

/**
 * Creates the view manager for one browser window.
 * @param {object} options Wiring provided by the main process.
 * @param {() => Electron.BaseWindow | null} options.getWindow Returns the owning window.
 * @param {() => Electron.WebContents | null} options.getUi Returns the UI renderer's contents.
 * @param {string} options.partition Session partition shared by all tabs.
 * @param {(url: string) => boolean} options.isNavigableUrl URL allow-list check.
 * @param {(contents: Electron.WebContents) => void} options.setupContents Applies page-level policy
 *   (shortcuts, popups, scheme filter, context menu) to a new view's contents.
 * @param {ViewHooks} [options.hooks] Lifecycle callbacks (used to expose tabs to extensions).
 * @returns {{
 *   sync(payload: unknown): void,
 *   bringPeekToFront(): void,
 *   command(id: unknown, command: unknown, arg: unknown): unknown,
 *   waitForView(id: string, timeoutMs?: number): Promise<Electron.WebContents | null>,
 *   idOf(contents: Electron.WebContents): string | null,
 *   destroyAll(): void,
 * }}
 */
function createViewManager({ getWindow, getUi, partition, isNavigableUrl, setupContents, hooks = {} }) {
  /** @type {Map<string, WebContentsView>} */
  const views = new Map();
  /** @type {Map<string, Bounds | null>} */
  const bounds = new Map();
  /** Whether the UI is stacked above the tab views. */
  let raised = false;
  /** @type {string | null} */
  let activeTabId = null;
  /** @type {Map<string, ((contents: Electron.WebContents) => void)[]>} */
  const waiters = new Map();
  /** Last color sent per tab, and the tabs shown on screen. */
  const colors = new Map();
  const shown = new Set();
  const colorTimers = new Map();

  /**
   * Sends a message to the UI renderer if the window is alive.
   * @param {string} channel IPC channel.
   * @param {unknown} payload Message payload.
   */
  const toUi = (channel, payload) => getUi()?.send(channel, payload);

  /**
   * Reads the color at the top of a shown page and tells the UI when it changed (split pane bars).
   * @param {string} id Tab id.
   */
  const sampleColor = async (id) => {
    const view = views.get(id);
    if (!view || view.webContents.isDestroyed() || !shown.has(id)) return;
    const { width } = view.getBounds();
    if (width < 8) return;
    try {
      const image = await view.webContents.capturePage({ x: 0, y: 0, width: Math.min(width, 800), height: COLOR_STRIP_HEIGHT });
      const color = image.isEmpty() ? null : dominantColor(image.toBitmap());
      if (!color || colors.get(id) === color) return;
      colors.set(id, color);
      toUi("tab:event", { tabId: id, type: "color", color });
    } catch {
      // The page went away meanwhile.
    }
  };

  /**
   * Reads a page's color a moment from now (debounced).
   * @param {string} id Tab id.
   */
  const scheduleColor = (id) => {
    clearTimeout(colorTimers.get(id));
    colorTimers.set(id, setTimeout(() => void sampleColor(id), COLOR_DELAY_MS));
  };

  // Pages change color without loading (banners closing, overlays, themes): shown pages are read again
  // every few seconds; only changes reach the UI.
  const colorRefresh = setInterval(() => {
    for (const id of shown) void sampleColor(id);
  }, COLOR_REFRESH_MS);

  /**
   * Creates a view for a tab (or Peek), forwards its page events to the UI and loads its URL.
   * @param {string} id Tab id or PEEK_ID.
   * @param {string} url Initial URL.
   * @returns {WebContentsView | null} The view, or null when the window is gone.
   */
  const createView = (id, url) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return null;
    const view = new WebContentsView({
      webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    view.setBackgroundColor("#ffffff");
    view.setBorderRadius(VIEW_RADIUS);
    view.setVisible(false);
    const contents = view.webContents;
    setupContents(contents);
    contents.on("did-navigate", (_e, navigatedUrl) => toUi("tab:event", { tabId: id, type: "navigate", url: navigatedUrl }));
    contents.on("did-navigate-in-page", (_e, navigatedUrl, isMainFrame) => {
      if (isMainFrame) toUi("tab:event", { tabId: id, type: "navigate-in-page", url: navigatedUrl });
    });
    contents.on("page-title-updated", (_e, title) => toUi("tab:event", { tabId: id, type: "title", title, url: contents.getURL() }));
    contents.on("page-favicon-updated", (_e, favicons) => toUi("tab:event", { tabId: id, type: "favicon", favicon: favicons[0] ?? null }));
    contents.on("focus", () => toUi("tab:event", { tabId: id, type: "focus" }));
    if (id !== PEEK_ID) {
      contents.on("did-stop-loading", () => scheduleColor(id));
      contents.on("did-navigate-in-page", () => scheduleColor(id));
    }
    win.contentView.addChildView(view);
    views.set(id, view);
    if (id !== PEEK_ID) {
      toUi("tab:event", { tabId: id, type: "attached", webContentsId: contents.id });
      hooks.onCreated?.(id, contents);
      for (const resolve of waiters.get(id) ?? []) resolve(contents);
      waiters.delete(id);
    }
    contents.loadURL(isNavigableUrl(url) ? url : "about:blank").catch(() => {});
    return view;
  };

  /**
   * Removes a view from the window and closes its page.
   * @param {string} id Tab id or PEEK_ID.
   */
  const destroyView = (id) => {
    const view = views.get(id);
    if (!view) return;
    views.delete(id);
    bounds.delete(id);
    shown.delete(id);
    colors.delete(id);
    clearTimeout(colorTimers.get(id));
    colorTimers.delete(id);
    if (activeTabId === id) activeTabId = null;
    const win = getWindow();
    if (win && !win.isDestroyed()) win.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) {
      if (id !== PEEK_ID) hooks.onDestroyed?.(id, view.webContents);
      view.webContents.close();
    }
  };

  /** Keeps Peek above the tabs and the UI (Peek is shown inside an overlay of the UI). */
  const bringPeekToFront = () => {
    const peek = views.get(PEEK_ID);
    const win = getWindow();
    if (peek && win && !win.isDestroyed()) win.contentView.addChildView(peek);
  };

  /** Applies the stored bounds to every view; a view without bounds (not on screen) is hidden. */
  const apply = () => {
    for (const [id, view] of views) {
      const rect = bounds.get(id) ?? null;
      if (rect) view.setBounds(rect);
      view.setVisible(Boolean(rect));
      // A page coming on screen (or resized) gets its color read again.
      if (rect && id !== PEEK_ID && (!shown.has(id) || !colors.has(id))) scheduleColor(id);
      if (rect) shown.add(id);
      else shown.delete(id);
    }
    bringPeekToFront();
  };

  return {
    /**
     * Reconciles native views with the UI's layout.
     * @param {unknown} payload SyncPayload from the renderer (validated here).
     */
    sync(payload) {
      if (!payload || typeof payload !== "object") return;
      const { tabs, raised: wantRaised, peek, activeTabId: active } = /** @type {Partial<SyncPayload>} */ (payload);
      if (!Array.isArray(tabs) || tabs.length > MAX_TABS) return;

      const wanted = new Set();
      for (const tab of tabs) {
        if (!tab || typeof tab.id !== "string" || !ID_PATTERN.test(tab.id) || typeof tab.url !== "string") continue;
        wanted.add(tab.id);
        if (!views.has(tab.id) && !createView(tab.id, tab.url)) continue;
        bounds.set(tab.id, toBounds(tab.bounds));
      }
      if (peek && typeof peek.url === "string") {
        wanted.add(PEEK_ID);
        if (!views.has(PEEK_ID)) createView(PEEK_ID, peek.url);
        bounds.set(PEEK_ID, toBounds(peek.bounds));
      }
      for (const id of [...views.keys()]) if (!wanted.has(id)) destroyView(id);

      // Restack before apply(), which then puts Peek back on top of the UI.
      if (Boolean(wantRaised) !== raised) {
        raised = Boolean(wantRaised);
        hooks.onRaise?.(raised);
      }
      apply();

      const nextActive = typeof active === "string" && views.has(active) ? active : null;
      if (nextActive && nextActive !== activeTabId) hooks.onActivated?.(nextActive, views.get(nextActive).webContents);
      activeTabId = nextActive;
    },

    /**
     * Resolves with a tab's page contents once its view exists (the UI creates tabs asynchronously).
     * @param {string} id Tab id.
     * @param {number} [timeoutMs] Give up after this delay.
     * @returns {Promise<Electron.WebContents | null>} Contents, or null on timeout.
     */
    waitForView(id, timeoutMs = 5000) {
      const existing = views.get(id);
      if (existing) return Promise.resolve(existing.webContents);
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), timeoutMs);
        const list = waiters.get(id) ?? [];
        list.push((contents) => {
          clearTimeout(timer);
          resolve(contents);
        });
        waiters.set(id, list);
      });
    },

    /**
     * Finds the tab id owning a page.
     * @param {Electron.WebContents} contents Page contents.
     * @returns {string | null} Tab id, or null for unknown contents.
     */
    idOf(contents) {
      for (const [id, view] of views) if (view.webContents === contents) return id;
      return null;
    },

    bringPeekToFront,

    /**
     * Runs a navigation command on a tab's page.
     * @param {unknown} id Tab id or PEEK_ID.
     * @param {unknown} command back | forward | reload | load | devtools | state.
     * @param {unknown} arg URL for "load".
     * @returns {unknown} For "state": { url, canGoBack, canGoForward }; otherwise undefined.
     */
    command(id, command, arg) {
      if (typeof id !== "string") return undefined;
      const view = views.get(id);
      if (!view || view.webContents.isDestroyed()) return undefined;
      const contents = view.webContents;
      const history = contents.navigationHistory;
      switch (command) {
        case "back":
          if (history.canGoBack()) history.goBack();
          return undefined;
        case "forward":
          if (history.canGoForward()) history.goForward();
          return undefined;
        case "reload":
          contents.reload();
          return undefined;
        case "load":
          if (typeof arg === "string" && isNavigableUrl(arg)) contents.loadURL(arg).catch(() => {});
          return undefined;
        case "devtools":
          contents.openDevTools({ mode: "detach" });
          return undefined;
        case "focus":
          contents.focus();
          return undefined;
        case "state":
          return { url: contents.getURL(), canGoBack: history.canGoBack(), canGoForward: history.canGoForward() };
        case "print":
          contents.print();
          return undefined;
        case "savePage":
          return savePage(contents, getWindow());
        case "zoom":
          return zoomPage(contents, arg);
        default:
          return undefined;
      }
    },

    /** Closes every page; used when the window goes away. */
    destroyAll() {
      clearInterval(colorRefresh);
      for (const id of [...views.keys()]) destroyView(id);
    },
  };
}

module.exports = { createViewManager, PEEK_ID };
