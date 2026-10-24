// Tab views: one WebContentsView per loaded tab (plus one for Peek), driven by the UI renderer.
//
// The renderer owns layout. It sends the list of loaded tabs with the on-screen rectangle of each
// visible one (views:sync); this module creates, positions, shows and destroys native views to
// match. Native views are drawn above all of the UI's HTML, so while an overlay is open (command bar,
// menus, floating sidebar, panels) the UI asks for the views to be "frozen": each visible page is
// captured, the UI shows the screenshot in its place, and only then are the views hidden.
const { WebContentsView } = require("electron");

const PEEK_ID = "__peek__";
const ID_PATTERN = /^[\w-]{1,64}$/;
const MAX_TABS = 500;
const VIEW_RADIUS = 10;
const SNAPSHOT_ACK_TIMEOUT_MS = 250;
const SNAPSHOT_JPEG_QUALITY = 85;

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Bounds
 * @typedef {{ id: string, url: string, bounds: Bounds | null }} TabEntry
 * @typedef {{ tabs: TabEntry[], frozen: boolean, peek: { url: string, bounds: Bounds | null } | null, activeTabId: string | null }} SyncPayload
 * @typedef {{
 *   onCreated?(id: string, contents: Electron.WebContents): void,
 *   onDestroyed?(id: string, contents: Electron.WebContents): void,
 *   onActivated?(id: string, contents: Electron.WebContents): void,
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

/**
 * Creates the view manager for one browser window.
 * @param {object} options Wiring provided by the main process.
 * @param {() => Electron.BrowserWindow | null} options.getWindow Returns the owning window.
 * @param {string} options.partition Session partition shared by all tabs.
 * @param {(url: string) => boolean} options.isNavigableUrl URL allow-list check.
 * @param {(contents: Electron.WebContents) => void} options.setupContents Applies page-level policy
 *   (shortcuts, popups, scheme filter, context menu) to a new view's contents.
 * @param {ViewHooks} [options.hooks] Lifecycle callbacks (used to expose tabs to extensions).
 * @returns {{
 *   sync(payload: unknown): void,
 *   ackSnapshots(token: unknown): void,
 *   command(id: unknown, command: unknown, arg: unknown): unknown,
 *   waitForView(id: string, timeoutMs?: number): Promise<Electron.WebContents | null>,
 *   idOf(contents: Electron.WebContents): string | null,
 *   destroyAll(): void,
 * }}
 */
function createViewManager({ getWindow, partition, isNavigableUrl, setupContents, hooks = {} }) {
  /** @type {Map<string, WebContentsView>} */
  const views = new Map();
  /** @type {Map<string, Bounds | null>} */
  const bounds = new Map();
  /** Freeze requested by the UI. */
  let frozen = false;
  /** Tab views actually hidden: only after the UI has painted the screenshots. */
  let concealed = false;
  let freezeToken = 0;
  /** @type {((token: number) => void) | null} */
  let resolveAck = null;
  /** @type {string | null} */
  let activeTabId = null;
  /** @type {Map<string, ((contents: Electron.WebContents) => void)[]>} */
  const waiters = new Map();

  /**
   * Sends a message to the UI renderer if the window is alive.
   * @param {string} channel IPC channel.
   * @param {unknown} payload Message payload.
   */
  const toUi = (channel, payload) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

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
    if (activeTabId === id) activeTabId = null;
    const win = getWindow();
    if (win && !win.isDestroyed()) win.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) {
      if (id !== PEEK_ID) hooks.onDestroyed?.(id, view.webContents);
      view.webContents.close();
    }
  };

  /**
   * Applies the stored bounds and the frozen state to every view. Peek stays visible while frozen
   * because it is itself shown inside an overlay.
   */
  const apply = () => {
    for (const [id, view] of views) {
      const rect = bounds.get(id) ?? null;
      if (rect) view.setBounds(rect);
      view.setVisible(Boolean(rect) && (id === PEEK_ID || !concealed));
    }
    // Keep Peek above the tabs.
    const peek = views.get(PEEK_ID);
    const win = getWindow();
    if (peek && win && !win.isDestroyed()) win.contentView.addChildView(peek);
  };

  /**
   * Freezes or unfreezes the tab views. Freezing captures every visible page first and waits until
   * the UI has drawn the screenshots, so the swap is invisible.
   * @param {boolean} wanted Target state.
   */
  const setFrozen = async (wanted) => {
    if (wanted === frozen) return;
    frozen = wanted;
    const token = ++freezeToken;
    if (!wanted) {
      concealed = false;
      apply();
      return;
    }
    /** @type {Record<string, string>} */
    const shots = {};
    for (const [id, view] of views) {
      if (id === PEEK_ID || !view.getVisible()) continue;
      try {
        const image = await view.webContents.capturePage();
        shots[id] = "data:image/jpeg;base64," + image.toJPEG(SNAPSHOT_JPEG_QUALITY).toString("base64");
      } catch {
        // A page that cannot be captured is simply hidden without a placeholder.
      }
    }
    if (token !== freezeToken) return;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, SNAPSHOT_ACK_TIMEOUT_MS);
      resolveAck = (acked) => {
        if (acked !== token) return;
        clearTimeout(timer);
        resolve(undefined);
      };
      toUi("views:snapshots", { token, shots });
    });
    resolveAck = null;
    if (token === freezeToken && frozen) {
      concealed = true;
      apply();
    }
  };

  return {
    /**
     * Reconciles native views with the UI's layout.
     * @param {unknown} payload SyncPayload from the renderer (validated here).
     */
    sync(payload) {
      if (!payload || typeof payload !== "object") return;
      const { tabs, frozen: wantFrozen, peek, activeTabId: active } = /** @type {Partial<SyncPayload>} */ (payload);
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

      apply();
      void setFrozen(Boolean(wantFrozen));

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

    /**
     * Called by the UI once it has painted the screenshots of a freeze.
     * @param {unknown} token Freeze token received with the snapshots.
     */
    ackSnapshots(token) {
      if (typeof token === "number" && resolveAck) resolveAck(token);
    },

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
        default:
          return undefined;
      }
    },

    /** Closes every page; used when the window goes away. */
    destroyAll() {
      for (const id of [...views.keys()]) destroyView(id);
    },
  };
}

module.exports = { createViewManager, PEEK_ID };
