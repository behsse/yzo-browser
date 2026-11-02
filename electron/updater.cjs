// Updates of installed builds (electron-updater, GitHub Releases): checks at startup and every few
// hours, and reports each step to the UI (indicator next to the Yzo logo, settings). With automatic
// updates on (the default), a new version downloads by itself; off, the UI shows that one is available
// and the user starts the download. A downloaded update installs on restart from the UI, or on quit.
const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

/** Time between two automatic checks. */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const SETTINGS_FILE = "update-settings.json";

/**
 * @typedef {{
 *   status: "dev" | "idle" | "checking" | "upToDate" | "available" | "downloading" | "ready" | "error",
 *   version: string,
 *   percent: number,
 *   autoDownload: boolean,
 * }} UpdateState
 */

/**
 * Reads whether updates download by themselves (on unless the user turned it off).
 * @param {string} file Settings file.
 * @returns {boolean} The choice.
 */
function readAutoDownload(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")).autoDownload !== false;
  } catch {
    return true;
  }
}

/**
 * Creates the updater.
 * @param {object} options Wiring provided by the main process.
 * @param {(state: UpdateState) => void} options.onChange Tells every window's UI about a new state.
 * @param {string} options.profile Profile folder holding the choice of automatic updates.
 * @param {boolean} [options.readOnly] Private instance: the choice is shown but not saved.
 * @returns {{
 *   state(): UpdateState,
 *   start(): void,
 *   check(): Promise<UpdateState>,
 *   download(): Promise<UpdateState>,
 *   install(): boolean,
 *   setAutoDownload(enabled: boolean): UpdateState,
 * }}
 */
function createUpdater({ onChange, profile, readOnly = false }) {
  const settingsFile = path.join(profile, SETTINGS_FILE);
  /** @type {UpdateState} */
  let state = { status: app.isPackaged ? "idle" : "dev", version: app.getVersion(), percent: 0, autoDownload: readAutoDownload(settingsFile) };
  /** @type {import("electron-updater").AppUpdater | null} */
  let updater = null;

  /**
   * Moves to a new state and tells the UI.
   * @param {Partial<UpdateState>} change Fields that change.
   */
  const set = (change) => {
    state = { ...state, ...change };
    onChange(state);
  };

  /** Whether a found update is on its way or waiting: checks then leave it alone. */
  const pending = () => state.status === "available" || state.status === "downloading" || state.status === "ready";

  /**
   * Loads electron-updater on first use (installed builds only) and follows its events.
   * @returns {import("electron-updater").AppUpdater | null} Updater, or null in development.
   */
  const load = () => {
    if (!app.isPackaged) return null;
    if (updater) return updater;
    updater = require("electron-updater").autoUpdater;
    updater.autoDownload = state.autoDownload;
    updater.autoInstallOnAppQuit = true;
    updater.on("checking-for-update", () => {
      if (!pending()) set({ status: "checking" });
    });
    updater.on("update-not-available", () => set({ status: "upToDate", version: app.getVersion(), percent: 0 }));
    updater.on("update-available", (info) => set({ status: state.autoDownload ? "downloading" : "available", version: info.version, percent: 0 }));
    updater.on("download-progress", (progress) => {
      // Many events per second: the UI only needs whole percents.
      const percent = Math.floor(progress.percent);
      if (percent !== state.percent || state.status !== "downloading") set({ status: "downloading", percent });
    });
    updater.on("update-downloaded", (info) => set({ status: "ready", version: info.version, percent: 100 }));
    updater.on("error", (error) => {
      console.error("Update failed:", error?.message ?? error);
      // A failed later check does not hide an update that is ready to install.
      if (state.status !== "ready") set({ status: "error", percent: 0 });
    });
    return updater;
  };

  /**
   * Looks for an update (a found one downloads by itself when automatic updates are on). Does nothing
   * while one is available, on its way or ready.
   * @returns {Promise<UpdateState>} State once the check is done.
   */
  const check = async () => {
    const current = load();
    if (!current || pending()) return state;
    try {
      await current.checkForUpdates();
    } catch {
      // Reported by the "error" event.
    }
    return state;
  };

  return {
    state: () => state,
    start() {
      if (!app.isPackaged) return;
      void check();
      setInterval(() => void check(), CHECK_INTERVAL_MS).unref();
    },
    check,
    /**
     * Downloads an available update (automatic updates off).
     * @returns {Promise<UpdateState>} State once the download started or failed.
     */
    async download() {
      if (!updater || state.status !== "available") return state;
      set({ status: "downloading", percent: 0 });
      updater.downloadUpdate().catch(() => {
        // Reported by the "error" event.
      });
      return state;
    },
    /**
     * Quits and installs the downloaded update, then restarts Yzo.
     * @returns {boolean} False when no update is ready.
     */
    install() {
      if (state.status !== "ready" || !updater) return false;
      // Let the IPC reply go out before the app quits.
      setImmediate(() => updater?.quitAndInstall(false, true));
      return true;
    },
    /**
     * Turns automatic updates on or off (kept across restarts). Turning them on downloads an update
     * already found.
     * @param {boolean} enabled New choice.
     * @returns {UpdateState} New state.
     */
    setAutoDownload(enabled) {
      if (!readOnly) {
        try {
          fs.writeFileSync(settingsFile, JSON.stringify({ autoDownload: enabled }));
        } catch (error) {
          console.error("Update choice not saved:", error);
        }
      }
      if (updater) updater.autoDownload = enabled;
      set({ autoDownload: enabled });
      if (enabled && state.status === "available") void this.download();
      return state;
    },
  };
}

module.exports = { createUpdater };
