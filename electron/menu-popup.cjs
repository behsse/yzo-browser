// Popup menus drawn in their own transparent WebContentsView, stacked above the tab views.
//
// HTML menus in the UI renderer sit below the native tab views, so the UI used to freeze the pages
// (screenshot + hide) while a menu was open, which stopped videos. This layer shows the menu over the
// live pages instead: the UI sends the entries as data, this module positions a small view at the
// anchor, and the picked entry index comes back to the UI, which runs the action.
const path = require("node:path");
const { ipcMain, WebContentsView } = require("electron");

/** Room left around the card for its shadow; matches the .menu offset in menu.css. */
const MENU_MARGIN = 12;
/** Layout room given to the page before it reports its real size. */
const MEASURE_SIZE = { width: 420, height: 900 };
const MAX_ENTRIES = 64;
const MAX_TEXT = 200;
const ICON_PATH_PATTERN = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]{1,600}$/;

/**
 * @typedef {{ separator: true } | { label: string, icon?: string, hint?: string, danger?: boolean, disabled?: boolean, index: number }} MenuItem
 */

/**
 * Validates the menu entries sent by the UI renderer.
 * @param {unknown} entries Candidate entries.
 * @returns {MenuItem[] | null} Clean entries, or null when invalid.
 */
function sanitizeEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_ENTRIES) return null;
  const clean = [];
  for (const [index, entry] of entries.entries()) {
    if (entry === "separator") {
      clean.push({ separator: true });
      continue;
    }
    if (!entry || typeof entry !== "object" || typeof entry.label !== "string") return null;
    clean.push({
      index,
      label: entry.label.slice(0, MAX_TEXT),
      icon: typeof entry.icon === "string" && ICON_PATH_PATTERN.test(entry.icon) ? entry.icon : undefined,
      hint: typeof entry.hint === "string" ? entry.hint.slice(0, 40) : undefined,
      danger: entry.danger === true,
      disabled: entry.disabled === true,
    });
  }
  return clean;
}

/**
 * Creates the popup menu layer of a window.
 * @param {object} options Wiring provided by the main process.
 * @param {() => Electron.BaseWindow | null} options.getWindow Returns the owning window.
 * @param {() => Electron.WebContents | null} options.getUi Returns the UI renderer's contents.
 * @returns {{ show(entries: unknown, x: unknown, y: unknown): Promise<number | null>, close(): void, bringToFront(): void }}
 */
function createMenuPopup({ getWindow, getUi }) {
  /** @type {WebContentsView | null} */
  let view = null;
  /** @type {Promise<void> | null} */
  let ready = null;
  let token = 0;
  /** @type {{ token: number, x: number, y: number, resolve: (index: number | null) => void } | null} */
  let pending = null;

  /**
   * Creates the layer view on first use.
   * @param {Electron.BrowserWindow} win Owning window.
   * @returns {Promise<void>} Resolves once menu.html is loaded.
   */
  const ensureView = (win) => {
    if (view && !view.webContents.isDestroyed()) return ready ?? Promise.resolve();
    view = new WebContentsView({
      webPreferences: { preload: path.join(__dirname, "menu-preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    view.setBackgroundColor("#00000000");
    view.setVisible(false);
    const contents = view.webContents;
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    // Clicking anywhere else (page, UI, another app) moves focus away: the menu closes.
    contents.on("blur", () => finish(token, null, false));
    win.contentView.addChildView(view);
    ready = contents.loadFile(path.join(__dirname, "menu.html")).catch(() => {});
    return ready;
  };

  /**
   * Hides the menu and settles the pending request.
   * @param {number} forToken Request the event belongs to.
   * @param {number | null} index Picked entry, or null when dismissed.
   * @param {boolean} refocus Gives the keyboard back to the UI (pick or Escape, not outside click).
   */
  const finish = (forToken, index, refocus) => {
    if (!pending || pending.token !== forToken) return;
    const { resolve } = pending;
    pending = null;
    view?.setVisible(false);
    if (refocus) getUi()?.focus();
    resolve(index);
  };

  /** @param {Electron.IpcMainEvent} event */
  const fromMenu = (event) => Boolean(view) && event.sender === view?.webContents;

  ipcMain.on("menu:resize", (event, forToken, width, height) => {
    if (!fromMenu(event) || !pending || pending.token !== forToken || !view) return;
    const win = getWindow();
    if (!win || win.isDestroyed() || ![width, height].every((n) => Number.isFinite(n) && n > 0)) return finish(forToken, null, false);
    const content = win.getContentBounds();
    const outerWidth = Math.ceil(width) + 2 * MENU_MARGIN;
    const outerHeight = Math.ceil(height) + 2 * MENU_MARGIN;
    // Keep the card inside the window, like the HTML menu did.
    const x = Math.max(-MENU_MARGIN, Math.min(pending.x - MENU_MARGIN, content.width - outerWidth + MENU_MARGIN - 8));
    const y = Math.max(-MENU_MARGIN, Math.min(pending.y - MENU_MARGIN, content.height - outerHeight + MENU_MARGIN - 8));
    view.setBounds({ x: Math.round(x), y: Math.round(y), width: outerWidth, height: outerHeight });
    win.contentView.addChildView(view); // re-adding moves the layer above views created since
    view.setVisible(true);
    view.webContents.focus();
  });
  ipcMain.on("menu:select", (event, forToken, index) => {
    if (fromMenu(event) && Number.isInteger(index)) finish(forToken, index, true);
  });
  ipcMain.on("menu:close", (event, forToken) => {
    if (fromMenu(event)) finish(forToken, null, true);
  });

  return {
    async show(entries, x, y) {
      const win = getWindow();
      const items = sanitizeEntries(entries);
      if (!win || win.isDestroyed() || !items || !Number.isFinite(x) || !Number.isFinite(y)) return null;
      if (pending) finish(pending.token, null, false);
      await ensureView(win);
      if (!view) return null;
      token += 1;
      const request = token;
      const result = new Promise((resolve) => {
        pending = { token: request, x: Number(x), y: Number(y), resolve };
      });
      view.setBounds({ x: 0, y: 0, ...MEASURE_SIZE });
      view.webContents.send("menu:show", { token: request, entries: items });
      return result;
    },
    close() {
      if (pending) finish(pending.token, null, false);
    },
    /** Keeps an open menu above views restacked after it was shown (e.g. the UI being raised). */
    bringToFront() {
      const win = getWindow();
      if (pending && view && win && !win.isDestroyed()) win.contentView.addChildView(view);
    },
  };
}

module.exports = { createMenuPopup, sanitizeEntries };
