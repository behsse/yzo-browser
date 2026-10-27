// Downloads of the tabs' session: where they are saved (a chosen folder, or asked each time), their
// progress sent to the UI, actions on them (open, show in folder, pause, cancel, move to the Recycle
// Bin) and a history kept in userData/downloads.json. A private window keeps its downloads in memory
// and only reads the download settings.

const { app, clipboard, dialog, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");

const HISTORY_FILE = "downloads.json";
const SETTINGS_FILE = "download-settings.json";
/** Oldest entries are dropped past this many. */
const HISTORY_LIMIT = 500;
/** Progress updates sent to the UI at most this often per download. */
const PROGRESS_INTERVAL_MS = 250;
const SAVE_DELAY_MS = 1000;
const ACTIONS = new Set(["open", "show", "pause", "resume", "cancel", "remove", "trash", "copyLink"]);

/**
 * @typedef {{
 *   id: string, url: string, filename: string, path: string, mime: string,
 *   totalBytes: number, receivedBytes: number,
 *   state: "progressing" | "completed" | "cancelled" | "interrupted", paused: boolean,
 *   startTime: number, endTime: number | null, icon: string | null,
 * }} DownloadRecord
 */

/**
 * Reads a JSON file, or null when it is missing or broken.
 * @param {string} file Path.
 * @returns {any} Parsed value.
 */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Picks a free path in a folder for a file name: "name.ext", then "name (1).ext", "name (2).ext"…
 * @param {string} dir Folder.
 * @param {string} filename Suggested name.
 * @param {Set<string>} taken Paths already used by downloads in progress.
 * @returns {string} Free path.
 */
function uniquePath(dir, filename, taken) {
  const safe = path.basename(filename).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_") || "download";
  const ext = path.extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  for (let n = 0; ; n++) {
    const candidate = path.join(dir, n ? `${stem} (${n})${ext}` : safe);
    if (!taken.has(candidate) && !fs.existsSync(candidate)) return candidate;
  }
}

/**
 * Handles the downloads of a session.
 * @param {object} options
 * @param {Electron.Session} options.session Tabs' session.
 * @param {string} options.profile Normal profile folder (history and settings live there).
 * @param {boolean} options.privateMode Private instance: history in memory, settings read-only.
 * @param {() => Electron.WebContents | null} options.getUi UI renderer, told about every change.
 * @param {() => Electron.BaseWindow | null} options.getWindow Parent of the folder picker.
 */
function setupDownloads({ session, profile, privateMode, getUi, getWindow }) {
  const historyPath = path.join(profile, HISTORY_FILE);
  const settingsPath = path.join(profile, SETTINGS_FILE);
  const stored = readJson(settingsPath);
  const settings = {
    directory: typeof stored?.directory === "string" && stored.directory ? stored.directory : app.getPath("downloads"),
    ask: stored?.ask === true,
  };

  /** @type {DownloadRecord[]} Newest first. */
  let records = [];
  if (!privateMode) {
    const saved = readJson(historyPath);
    records = (Array.isArray(saved) ? saved : [])
      .filter((r) => r && typeof r.id === "string" && typeof r.path === "string")
      // Downloads cut short by the app closing cannot be resumed.
      .map((r) => (r.state === "progressing" ? { ...r, state: "interrupted", paused: false } : r));
  }
  /** Ids of the downloads started since the app opened (the panel's list). */
  const sessionIds = new Set();
  /** @type {Map<string, Electron.DownloadItem>} */
  const items = new Map();
  const lastSent = new Map();
  let saveTimer = null;

  const save = () => {
    if (privateMode) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      fs.promises.writeFile(historyPath, JSON.stringify(records.slice(0, HISTORY_LIMIT))).catch((error) => console.error("Downloads not saved:", error));
    }, SAVE_DELAY_MS);
  };

  /**
   * What the UI shows for a record.
   * @param {DownloadRecord} record Download.
   * @returns {object} DownloadEntry (src/env.d.ts).
   */
  const toEntry = (record) => ({
    ...record,
    thisSession: sessionIds.has(record.id),
    exists: record.state !== "completed" || fs.existsSync(record.path),
  });

  const send = (record) => getUi()?.send("downloads:changed", toEntry(record));

  /**
   * Fills in a finished download's file icon (shown in the panel and the downloads page).
   * @param {DownloadRecord} record Download.
   */
  const loadIcon = async (record) => {
    try {
      record.icon = (await app.getFileIcon(record.path, { size: "normal" })).toDataURL();
      send(record);
      save();
    } catch {
      // No icon: the UI draws a generic one.
    }
  };

  session.on("will-download", (_event, item) => {
    const record = {
      id: randomUUID(),
      url: item.getURL(),
      filename: item.getFilename(),
      path: "",
      mime: item.getMimeType(),
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      state: /** @type {const} */ ("progressing"),
      paused: false,
      startTime: Date.now(),
      endTime: null,
      icon: null,
    };
    const taken = new Set(records.filter((r) => r.state === "progressing").map((r) => r.path));
    fs.mkdirSync(settings.directory, { recursive: true });
    const target = uniquePath(settings.directory, record.filename, taken);
    // Asked: Electron shows the save dialog, starting in the chosen folder.
    if (settings.ask) item.setSaveDialogOptions({ defaultPath: target });
    else item.setSavePath(target);
    record.path = settings.ask ? "" : target;
    records.unshift(record);
    sessionIds.add(record.id);
    items.set(record.id, item);
    getUi()?.send("downloads:started", record.id);
    send(record);

    item.on("updated", (_e, state) => {
      record.path = item.getSavePath() || record.path;
      record.filename = record.path ? path.basename(record.path) : record.filename;
      record.receivedBytes = item.getReceivedBytes();
      record.totalBytes = item.getTotalBytes();
      record.paused = item.isPaused();
      record.state = state === "interrupted" ? "interrupted" : "progressing";
      const now = Date.now();
      if (now - (lastSent.get(record.id) ?? 0) < PROGRESS_INTERVAL_MS) return;
      lastSent.set(record.id, now);
      send(record);
    });
    item.once("done", (_e, state) => {
      record.path = item.getSavePath() || record.path;
      record.filename = record.path ? path.basename(record.path) : record.filename;
      record.receivedBytes = item.getReceivedBytes();
      record.state = state === "completed" ? "completed" : state === "cancelled" ? "cancelled" : "interrupted";
      record.paused = false;
      record.endTime = Date.now();
      items.delete(record.id);
      lastSent.delete(record.id);
      send(record);
      save();
      if (record.state === "completed") void loadIcon(record);
    });
    save();
  });

  return {
    /**
     * Every download, newest first.
     * @returns {object[]} DownloadEntry list.
     */
    list() {
      return records.map(toEntry);
    },

    /**
     * Runs an action on a download.
     * @param {string} id Download id.
     * @param {string} action open | show | pause | resume | cancel | remove | trash | copyLink.
     * @returns {Promise<boolean>} False when the download or its file is gone.
     */
    async act(id, action) {
      const record = records.find((r) => r.id === id);
      if (!record || !ACTIONS.has(action)) return false;
      const item = items.get(id);
      switch (action) {
        case "open":
          return record.state === "completed" && fs.existsSync(record.path) && (await shell.openPath(record.path)) === "";
        case "show":
          if (!record.path || !fs.existsSync(record.path)) return false;
          shell.showItemInFolder(record.path);
          return true;
        case "copyLink":
          clipboard.writeText(record.url);
          return true;
        case "pause":
          item?.pause();
          break;
        case "resume":
          if (item?.canResume()) item.resume();
          break;
        case "cancel":
          item?.cancel();
          break;
        case "trash":
          if (record.state !== "completed" || !fs.existsSync(record.path)) return false;
          await shell.trashItem(record.path);
          send(record);
          return true;
        case "remove":
          if (item) return false;
          records = records.filter((r) => r.id !== id);
          sessionIds.delete(id);
          getUi()?.send("downloads:removed", id);
          save();
          return true;
      }
      if (item) {
        record.paused = item.isPaused();
        send(record);
      }
      return true;
    },

    /**
     * Forgets every finished download (files stay where they are).
     */
    clear() {
      records = records.filter((r) => items.has(r.id));
      for (const id of [...sessionIds]) if (!items.has(id)) sessionIds.delete(id);
      getUi()?.send("downloads:cleared");
      save();
    },

    /**
     * Download settings.
     * @returns {{ directory: string, ask: boolean, readOnly: boolean }} Folder, whether to ask each time.
     */
    getSettings() {
      return { ...settings, readOnly: privateMode };
    },

    /**
     * Changes the download settings (not from a private window). With `chooseDirectory`, asks for the
     * folder first.
     * @param {{ ask?: boolean, chooseDirectory?: boolean }} change What to change.
     * @returns {Promise<{ directory: string, ask: boolean, readOnly: boolean }>} New settings.
     */
    async updateSettings(change) {
      if (privateMode) return this.getSettings();
      if (typeof change?.ask === "boolean") settings.ask = change.ask;
      if (change?.chooseDirectory) {
        const win = getWindow();
        const options = { defaultPath: settings.directory, properties: /** @type {const} */ (["openDirectory", "createDirectory"]) };
        const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
        if (!result.canceled && result.filePaths[0]) settings.directory = result.filePaths[0];
      }
      await fs.promises.writeFile(settingsPath, JSON.stringify(settings)).catch((error) => console.error("Download settings not saved:", error));
      return this.getSettings();
    },
  };
}

module.exports = { setupDownloads, uniquePath };
