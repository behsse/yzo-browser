// Tab views: one WebContentsView per loaded tab (plus one for Peek), driven by the UI renderer.
// Every window has its own manager. The windows share the sidebar, but a tab's page lives in one
// window at a time: it moves to the window that wants it on screen, and a window that shows a tab
// whose page another window has on screen gets a placeholder (views:elsewhere) instead.
//
// The renderer owns layout. It sends the list of loaded tabs with the on-screen rectangle of each
// visible one (views:sync); this module creates, positions, shows and destroys native views to
// match. The tab views normally sit above the UI view; while an overlay is open (command bar, floating
// sidebar, panels, divider drag) the UI asks to be "raised" above them and draws over the live pages
// through its transparent slots (see stackUi in main.cjs).
const { View, WebContentsView, app, dialog } = require("electron");
const path = require("node:path");
const { dominantColor } = require("./page-color.cjs");

const PEEK_ID = "__peek__";
const ID_PATTERN = /^[\w-]{1,64}$/;
const MAX_TABS = 500;
const VIEW_RADIUS = 10;
/** Input events by which the user picks a page (see the "input-event" listener in createView). */
const POINTER_DOWN_EVENTS = new Set(["mouseDown", "touchStart", "gestureTapDown"]);

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Bounds
 * @typedef {{ id: string, url: string, bounds: Bounds | null, squareTop?: boolean }} TabEntry
 * @typedef {{ tabs: TabEntry[], raised: boolean, peek: { url: string, bounds: Bounds | null } | null, activeTabId: string | null }} SyncPayload
 * @typedef {{
 *   onCreated?(id: string, contents: Electron.WebContents): void,
 *   onDestroyed?(id: string, contents: Electron.WebContents): void,
 *   onMoved?(id: string, contents: Electron.WebContents): void,
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
 * Windows share the sidebar, so the same tab can be wanted by several of them; its page lives in one
 * window at a time. These registries span every window's manager: who owns each tab's page, which tab a
 * page belongs to, and who waits for a page to exist.
 * @type {Map<string, ManagerInternals>}
 */
const owners = new Map();
/** @type {Map<number, string>} webContents id → tab id. */
const tabIdByContents = new Map();
/** @type {Map<string, ((contents: Electron.WebContents) => void)[]>} */
const tabWaiters = new Map();
/**
 * Where each page sends its events: the manager that owns it now (it changes when a page moves to
 * another window).
 * @type {WeakMap<Electron.WebContents, { owner: ManagerInternals }>}
 */
const routes = new WeakMap();
/** @type {Set<ManagerInternals>} */
const managers = new Set();
/** Set while managers re-run their layout after another window changed what it shows. */
let resyncing = false;

/**
 * @typedef {{
 *   toUi(channel: string, payload: unknown): void,
 *   scheduleColor(id: string): void,
 *   enterFullScreen(id: string): void,
 *   leaveFullScreenOf(id: string): void,
 *   isShown(id: string): boolean,
 *   release(id: string): { view: WebContentsView, color: string | undefined } | null,
 *   viewOf(id: string): WebContentsView | undefined,
 *   resync(): void,
 *   shownKey(): string,
 *   window(): Electron.BaseWindow | null,
 * }} ManagerInternals
 */

/**
 * Window a page (tab or Peek) is in now.
 * @param {Electron.WebContents} contents Page contents.
 * @returns {Electron.BaseWindow | null} Window, or null for unknown contents.
 */
function windowOf(contents) {
  return routes.get(contents)?.owner.window() ?? null;
}

/**
 * Window that has a tab's page.
 * @param {string} id Tab id.
 * @returns {Electron.BaseWindow | null} Window, or null when the tab has no page.
 */
function windowOfTab(id) {
  return owners.get(id)?.window() ?? null;
}

/**
 * Finds the tab a page belongs to, in any window.
 * @param {Electron.WebContents} contents Page contents.
 * @returns {string | null} Tab id, or null for unknown contents (Peek, popups).
 */
function tabIdOf(contents) {
  return tabIdByContents.get(contents.id) ?? null;
}

/**
 * Resolves with a tab's page once it exists in any window (the UI creates tabs asynchronously).
 * @param {string} id Tab id.
 * @param {number} [timeoutMs] Give up after this delay.
 * @returns {Promise<Electron.WebContents | null>} Contents, or null on timeout.
 */
function waitForTab(id, timeoutMs = 5000) {
  const existing = owners.get(id)?.viewOf(id);
  if (existing) return Promise.resolve(existing.webContents);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const list = tabWaiters.get(id) ?? [];
    list.push((contents) => {
      clearTimeout(timer);
      resolve(contents);
    });
    tabWaiters.set(id, list);
  });
}

/**
 * Lets the other windows lay out again after one changed which pages it owns or shows: a page one
 * window let go of can now come to another that wants it on screen.
 * @param {ManagerInternals} changed Manager whose pages changed.
 */
function resyncOthers(changed) {
  if (resyncing) return;
  resyncing = true;
  try {
    for (const manager of managers) if (manager !== changed) manager.resync();
  } finally {
    resyncing = false;
  }
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
 *   claim(id: unknown): void,
 *   bringPeekToFront(): void,
 *   command(id: unknown, command: unknown, arg: unknown): unknown,
 *   relayout(): void,
 *   exitFullScreen(): void,
 *   resendColors(): void,
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
  /** Last layout sent by this window's UI, replayed when another window frees a page it wants. */
  let lastPayload = null;
  /** Tabs this window shows in a pane while another window has their page (sent to the UI). */
  let elsewhereKey = "";
  /** Last color sent per tab, and the tabs shown on screen. */
  const colors = new Map();
  /**
   * Split panes: their page's top corners are square under the pane bar. A page view can only have
   * one radius for its four corners, so two corner-sized native views in the bar's color sit right
   * under the page's top corners and fill what the rounding cuts away. Being under the page, they
   * never cover it, whether the UI is below or above the pages.
   * @type {Map<string, View[]>}
   */
  const corners = new Map();
  /** @type {Set<string>} */
  const squareTop = new Set();
  const shown = new Set();
  const colorTimers = new Map();
  /**
   * Page in HTML full screen (a video's full-screen button): it covers the whole window, above the
   * UI, with square corners, and the window goes full screen like in other browsers.
   * @type {string | null}
   */
  let fullScreenId = null;
  /** Whether the window was already full screen before the page asked for it (then it stays so). */
  let windowWasFullScreen = false;

  /**
   * Sends a message to the UI renderer if the window is alive.
   * @param {string} channel IPC channel.
   * @param {unknown} payload Message payload.
   */
  const toUi = (channel, payload) => getUi()?.send(channel, payload);

  /**
   * Reads the color at the top of a shown page, once it has loaded, for its split pane bar. The bar
   * keeps that color: what the page shows later (bars appearing on scroll, overlays) does not change
   * it. Only a page scrolled to the top is read.
   * @param {string} id Tab id.
   */
  const sampleColor = async (id) => {
    const view = views.get(id);
    if (!view || view.webContents.isDestroyed() || !shown.has(id)) return;
    const { width } = view.getBounds();
    if (width < 8) return;
    try {
      const atTop = await view.webContents.executeJavaScript("window.scrollY === 0", true).catch(() => true);
      if (!atTop) return;
      const image = await view.webContents.capturePage({ x: 0, y: 0, width: Math.min(width, 800), height: COLOR_STRIP_HEIGHT });
      const color = image.isEmpty() ? null : dominantColor(image.toBitmap());
      if (!color) return;
      colors.set(id, color);
      toUi("tab:event", { tabId: id, type: "color", color });
      placeCorners(id, bounds.get(id) ?? null);
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
    // Events go to the window that owns the page now (see adopt).
    const route = { owner: internals };
    routes.set(contents, route);
    const send = (payload) => route.owner.toUi("tab:event", { tabId: id, ...payload });
    contents.on("did-navigate", (_e, navigatedUrl) => send({ type: "navigate", url: navigatedUrl }));
    contents.on("did-navigate-in-page", (_e, navigatedUrl, isMainFrame) => {
      if (isMainFrame) send({ type: "navigate-in-page", url: navigatedUrl });
    });
    contents.on("page-title-updated", (_e, title) => send({ type: "title", title, url: contents.getURL() }));
    contents.on("page-favicon-updated", (_e, favicons) => send({ type: "favicon", favicon: favicons[0] ?? null }));
    // A pane becomes the selected one when the user clicks or taps it, not when it takes focus: pages
    // loading side by side grab focus in turn, which made the selection jump between them.
    contents.on("input-event", (_e, input) => {
      if (POINTER_DOWN_EVENTS.has(input.type)) send({ type: "focus" });
    });
    if (id !== PEEK_ID) {
      contents.on("did-stop-loading", () => route.owner.scheduleColor(id));
      contents.on("did-navigate-in-page", () => route.owner.scheduleColor(id));
    }
    contents.on("enter-html-full-screen", () => route.owner.enterFullScreen(id));
    contents.on("leave-html-full-screen", () => route.owner.leaveFullScreenOf(id));
    win.contentView.addChildView(view);
    views.set(id, view);
    if (id !== PEEK_ID) {
      owners.set(id, internals);
      tabIdByContents.set(contents.id, id);
      contents.once("destroyed", () => tabIdByContents.delete(contents.id));
      toUi("tab:event", { tabId: id, type: "attached", webContentsId: contents.id });
      hooks.onCreated?.(id, contents);
      for (const resolve of tabWaiters.get(id) ?? []) resolve(contents);
      tabWaiters.delete(id);
    }
    contents.loadURL(isNavigableUrl(url) ? url : "about:blank").catch(() => {});
    return view;
  };

  /**
   * Removes a view from the window and closes its page.
   * @param {string} id Tab id or PEEK_ID.
   */
  const destroyView = (id) => {
    const view = detachView(id);
    if (!view) return;
    if (!view.webContents.isDestroyed()) {
      if (id !== PEEK_ID) hooks.onDestroyed?.(id, view.webContents);
      view.webContents.close();
    }
  };

  /**
   * Takes a view out of this window and forgets it here, without closing its page.
   * @param {string} id Tab id or PEEK_ID.
   * @returns {WebContentsView | null} The view, or null when this window does not have it.
   */
  const detachView = (id) => {
    const view = views.get(id);
    if (!view) return null;
    views.delete(id);
    bounds.delete(id);
    shown.delete(id);
    colors.delete(id);
    squareTop.delete(id);
    removeCorners(id);
    clearTimeout(colorTimers.get(id));
    colorTimers.delete(id);
    if (activeTabId === id) activeTabId = null;
    if (fullScreenId === id) leaveFullScreen();
    if (owners.get(id) === internals) owners.delete(id);
    const win = getWindow();
    if (win && !win.isDestroyed()) win.contentView.removeChildView(view);
    return view;
  };

  /**
   * Takes over a page released by another window: the live page moves here as is (no reload).
   * @param {string} id Tab id.
   * @param {{ view: WebContentsView, color: string | undefined }} moved What the other window released.
   */
  const adopt = (id, { view, color }) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    view.setVisible(false);
    win.contentView.addChildView(view);
    views.set(id, view);
    owners.set(id, internals);
    const contents = view.webContents;
    const route = routes.get(contents);
    if (route) route.owner = internals;
    view.setBorderRadius(VIEW_RADIUS);
    toUi("tab:event", { tabId: id, type: "attached", webContentsId: contents.id });
    if (color) {
      colors.set(id, color);
      toUi("tab:event", { tabId: id, type: "color", color });
    }
    hooks.onMoved?.(id, contents);
  };

  /**
   * Removes a page's corner views.
   * @param {string} id Tab id.
   */
  const removeCorners = (id) => {
    const win = getWindow();
    for (const corner of corners.get(id) ?? []) if (win && !win.isDestroyed()) win.contentView.removeChildView(corner);
    corners.delete(id);
  };

  /**
   * Places a split page's corner views under its top corners (created on first use), in the bar's
   * color; hides them for pages that are not in a split or not on screen.
   * @param {string} id Tab id.
   * @param {Bounds | null} rect Page bounds.
   */
  const placeCorners = (id, rect) => {
    const win = getWindow();
    const view = views.get(id);
    if (!win || win.isDestroyed() || !view) return;
    if (!rect || !squareTop.has(id)) {
      for (const corner of corners.get(id) ?? []) corner.setVisible(false);
      return;
    }
    let pair = corners.get(id);
    if (!pair) {
      pair = [new View(), new View()];
      corners.set(id, pair);
      // Right under the page in the stacking order.
      for (const corner of pair) win.contentView.addChildView(corner, win.contentView.children.indexOf(view));
    }
    const color = colors.get(id) ?? "#00000000";
    pair[0].setBounds({ x: rect.x, y: rect.y, width: VIEW_RADIUS, height: VIEW_RADIUS });
    pair[1].setBounds({ x: rect.x + rect.width - VIEW_RADIUS, y: rect.y, width: VIEW_RADIUS, height: VIEW_RADIUS });
    for (const corner of pair) {
      corner.setBackgroundColor(color);
      corner.setVisible(true);
    }
  };

  /** Keeps Peek above the tabs and the UI (Peek is shown inside an overlay of the UI). */
  const bringPeekToFront = () => {
    const peek = views.get(PEEK_ID);
    const win = getWindow();
    if (peek && win && !win.isDestroyed()) win.contentView.addChildView(peek);
  };

  /**
   * Puts a page in full screen: the window goes full screen and the page covers all of it.
   * @param {string} id Tab id or PEEK_ID.
   */
  const enterFullScreen = (id) => {
    const win = getWindow();
    const view = views.get(id);
    if (!win || win.isDestroyed() || !view) return;
    if (fullScreenId === null) windowWasFullScreen = win.isFullScreen();
    fullScreenId = id;
    view.setBorderRadius(0);
    if (!win.isFullScreen()) win.setFullScreen(true);
    apply();
  };

  /** Gives the full-screen page back its slot and the window its previous state. */
  const leaveFullScreen = () => {
    const id = fullScreenId;
    if (id === null) return;
    fullScreenId = null;
    const view = views.get(id);
    if (view) view.setBorderRadius(VIEW_RADIUS);
    const win = getWindow();
    if (win && !win.isDestroyed() && !windowWasFullScreen && win.isFullScreen()) win.setFullScreen(false);
    // Asks the page to leave too when the exit did not come from it (tab switched, window left full screen).
    const contents = view?.webContents;
    if (contents && !contents.isDestroyed()) {
      contents.executeJavaScript("document.fullscreenElement && document.exitFullscreen()", true).catch(() => {});
    }
    // The page was moved above everything: put the UI back where the layout wants it.
    hooks.onRaise?.(raised);
    apply();
  };

  /**
   * Bounds of the full-screen page: the whole window content.
   * @returns {Bounds | null} Bounds, or null when the window is gone.
   */
  const fullScreenBounds = () => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return null;
    const { width, height } = win.getContentBounds();
    return { x: 0, y: 0, width, height };
  };

  /** Applies the stored bounds to every view; a view without bounds (not on screen) is hidden. */
  const apply = () => {
    const win = getWindow();
    const fullScreenView = fullScreenId === null ? null : views.get(fullScreenId);
    if (fullScreenView && win && !win.isDestroyed()) {
      const rect = fullScreenBounds();
      if (rect) fullScreenView.setBounds(rect);
      fullScreenView.setVisible(true);
      // Above every other view (other pages, the UI, Peek, menus) while it lasts.
      win.contentView.addChildView(fullScreenView);
      return;
    }
    for (const [id, view] of views) {
      const rect = bounds.get(id) ?? null;
      if (rect) view.setBounds(rect);
      view.setVisible(Boolean(rect));
      // A page coming on screen (or resized) gets its color read again.
      if (rect && id !== PEEK_ID && !colors.has(id)) scheduleColor(id);
      if (rect) shown.add(id);
      else shown.delete(id);
      if (id !== PEEK_ID) placeCorners(id, rect);
    }
    bringPeekToFront();
  };

  /** @type {ManagerInternals} */
  const internals = {
    toUi,
    scheduleColor,
    enterFullScreen,
    leaveFullScreenOf: (id) => {
      if (fullScreenId === id) leaveFullScreen();
    },
    isShown: (id) => views.has(id) && Boolean(bounds.get(id)),
    release: (id) => {
      if (id === PEEK_ID) return null;
      const color = colors.get(id);
      const view = detachView(id);
      return view ? { view, color } : null;
    },
    viewOf: (id) => views.get(id),
    window: () => {
      const win = getWindow();
      return win && !win.isDestroyed() ? win : null;
    },
    resync: () => {
      if (lastPayload) api.sync(lastPayload);
    },
    shownKey: () =>
      [...views.keys()]
        .filter((id) => id !== PEEK_ID)
        .map((id) => (bounds.get(id) ? `${id}+` : id))
        .join(","),
  };
  managers.add(internals);

  const api = {
    /**
     * Reconciles native views with the UI's layout.
     * @param {unknown} payload SyncPayload from the renderer (validated here).
     */
    sync(payload) {
      if (!payload || typeof payload !== "object") return;
      const { tabs, raised: wantRaised, peek, activeTabId: active } = /** @type {Partial<SyncPayload>} */ (payload);
      if (!Array.isArray(tabs) || tabs.length > MAX_TABS) return;
      lastPayload = payload;
      const before = internals.shownKey();

      const wanted = new Set();
      /** @type {string[]} */
      const elsewhere = [];
      let created = false;
      for (const tab of tabs) {
        if (!tab || typeof tab.id !== "string" || !ID_PATTERN.test(tab.id) || typeof tab.url !== "string") continue;
        wanted.add(tab.id);
        const rect = toBounds(tab.bounds);
        if (!views.has(tab.id)) {
          const owner = owners.get(tab.id);
          if (owner && owner !== internals) {
            // Another window has this page. It comes here only when wanted on screen and not shown
            // there; otherwise this window shows a placeholder (it can claim the page).
            if (!rect || owner.isShown(tab.id)) {
              if (rect) elsewhere.push(tab.id);
              continue;
            }
            const moved = owner.release(tab.id);
            if (!moved) continue;
            adopt(tab.id, moved);
          } else {
            if (!createView(tab.id, tab.url)) continue;
            created = true;
          }
        }
        bounds.set(tab.id, rect);
        if (tab.squareTop === true) squareTop.add(tab.id);
        else squareTop.delete(tab.id);
      }
      if (peek && typeof peek.url === "string") {
        wanted.add(PEEK_ID);
        if (!views.has(PEEK_ID)) createView(PEEK_ID, peek.url);
        bounds.set(PEEK_ID, toBounds(peek.bounds));
      }
      for (const id of [...views.keys()]) if (!wanted.has(id)) destroyView(id);
      // A full-screen page taken off screen (tab switched) leaves full screen, like in Chrome.
      if (fullScreenId !== null && !bounds.get(fullScreenId)) leaveFullScreen();

      // Restack before apply(), which then puts Peek back on top of the UI.
      if (Boolean(wantRaised) !== raised) {
        raised = Boolean(wantRaised);
        hooks.onRaise?.(raised);
      }
      apply();

      const nextActive = typeof active === "string" && views.has(active) ? active : null;
      // Extensions make every new tab the active one (electron-chrome-extensions): after a background
      // tab or a split pane loads, the selected tab is told again, or extension popups read the wrong
      // tab ("No website" in uBlock Origin Lite).
      if (nextActive && (nextActive !== activeTabId || created)) hooks.onActivated?.(nextActive, views.get(nextActive).webContents);
      activeTabId = nextActive;

      const key = elsewhere.join(",");
      if (key !== elsewhereKey) {
        elsewhereKey = key;
        toUi("views:elsewhere", elsewhere);
      }
      if (internals.shownKey() !== before) resyncOthers(internals);
    },

    /**
     * Brings a tab's page to this window from the window that has it ("Show here" on the placeholder).
     * @param {unknown} id Tab id.
     */
    claim(id) {
      if (typeof id !== "string" || views.has(id)) return;
      const owner = owners.get(id);
      const moved = owner && owner !== internals ? owner.release(id) : null;
      if (!moved) return;
      adopt(id, moved);
      if (lastPayload) this.sync(lastPayload);
      resyncOthers(internals);
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
      // The page may be in another window (this one shows a placeholder for it).
      const view = views.get(id) ?? owners.get(id)?.viewOf(id);
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
          // Never into another window's page: that would bring that window forward.
          if (views.get(id) === view) contents.focus();
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

    /** Fits the full-screen page to the window again (after a resize). */
    relayout() {
      if (fullScreenId !== null) apply();
    },

    /** Takes the page out of full screen when the window leaves it (F11, Escape handled by Windows). */
    exitFullScreen() {
      leaveFullScreen();
    },

    /** Sends the colors already read to the UI again (after it reloaded and lost them). */
    resendColors() {
      for (const [tabId, color] of colors) toUi("tab:event", { tabId, type: "color", color });
    },

    /**
     * Closes every page; used when the window goes away. The other windows then load the tabs they
     * show again.
     */
    destroyAll() {
      managers.delete(internals);
      for (const id of [...views.keys()]) destroyView(id);
      resyncOthers(internals);
    },
  };
  return api;
}

module.exports = { createViewManager, tabIdOf, waitForTab, windowOf, windowOfTab, PEEK_ID };
