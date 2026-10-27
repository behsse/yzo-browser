// Installed extensions on disk (userData/Extensions/<id>/<version>/, written by electron-chrome-web-store)
// and which ones the user turned off. Yzo loads them itself instead of letting the library load them
// all, so a turned-off extension never runs.

const { app } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");

const DISABLED_FILE = "extensions-disabled.json";
/** Largest icon read for the extensions page. */
const ICON_MAX_SIZE = 128;
const ID_PATTERN = /^[a-p]{32}$/;

/**
 * Folder holding the Chrome Web Store installs.
 * @returns {string} Absolute path.
 */
function extensionsPath() {
  return path.join(app.getPath("userData"), "Extensions");
}

/**
 * Compares dotted version strings ("1.2.10" > "1.2.9").
 * @param {string} a Version.
 * @param {string} b Version.
 * @returns {number} Negative, zero or positive like a sort comparator.
 */
function compareVersions(a, b) {
  const left = String(a).split(".").map(Number);
  const right = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

/**
 * Finds the newest installed version of each extension.
 * @returns {Promise<Map<string, { path: string, manifest: chrome.runtime.Manifest }>>} By extension id.
 */
async function discoverInstalled() {
  const found = new Map();
  let ids = [];
  try {
    ids = await fs.readdir(extensionsPath(), { withFileTypes: true });
  } catch {
    return found;
  }
  for (const idEntry of ids) {
    if (!idEntry.isDirectory() || !ID_PATTERN.test(idEntry.name)) continue;
    const idDir = path.join(extensionsPath(), idEntry.name);
    const versions = await fs.readdir(idDir, { withFileTypes: true }).catch(() => []);
    for (const versionEntry of versions) {
      if (!versionEntry.isDirectory()) continue;
      const dir = path.join(idDir, versionEntry.name);
      try {
        const manifest = JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8"));
        const current = found.get(idEntry.name);
        if (!current || compareVersions(manifest.version, current.manifest.version) > 0) found.set(idEntry.name, { path: dir, manifest });
      } catch {
        // Not an extension folder (or a broken one): skipped.
      }
    }
  }
  return found;
}

/**
 * Resolves a "__MSG_name__" manifest string from the extension's _locales, in the app language.
 * @param {string} dir Extension folder.
 * @param {chrome.runtime.Manifest} manifest Its manifest.
 * @param {string | undefined} value Raw manifest value.
 * @returns {Promise<string>} Text to show.
 */
async function localize(dir, manifest, value) {
  const match = /^__MSG_(\w+)__$/.exec(value ?? "");
  if (!match) return value ?? "";
  const key = match[1].toLowerCase();
  const locale = app.getLocale().replace("-", "_");
  const candidates = [locale, locale.split("_")[0], manifest.default_locale].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const messages = JSON.parse(await fs.readFile(path.join(dir, "_locales", candidate, "messages.json"), "utf8"));
      const entry = Object.entries(messages).find(([name]) => name.toLowerCase() === key);
      if (entry?.[1]?.message) return entry[1].message;
    } catch {
      // Locale missing: try the next one.
    }
  }
  return "";
}

/**
 * Reads the extension's largest icon (up to 128px) as a data URL.
 * @param {string} dir Extension folder.
 * @param {chrome.runtime.Manifest} manifest Its manifest.
 * @returns {Promise<string | null>} data: URL, or null when it has none.
 */
async function readIcon(dir, manifest) {
  const icons = Object.entries(manifest.icons ?? {})
    .map(([size, file]) => [Number(size), file])
    .filter(([size, file]) => size <= ICON_MAX_SIZE && typeof file === "string")
    .sort((a, b) => b[0] - a[0]);
  if (!icons.length) return null;
  const file = path.resolve(dir, String(icons[0][1]).replace(/^\//, ""));
  if (!file.startsWith(path.resolve(dir))) return null;
  try {
    const type = file.endsWith(".svg") ? "image/svg+xml" : file.endsWith(".jpg") || file.endsWith(".jpeg") ? "image/jpeg" : "image/png";
    return `data:${type};base64,${(await fs.readFile(file)).toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Reads the ids of the extensions the user turned off.
 * @returns {Promise<Set<string>>} Extension ids.
 */
async function readDisabled() {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(app.getPath("userData"), DISABLED_FILE), "utf8"));
    return new Set((Array.isArray(parsed?.disabled) ? parsed.disabled : []).filter((id) => ID_PATTERN.test(id)));
  } catch {
    return new Set();
  }
}

/**
 * Saves the ids of the extensions the user turned off.
 * @param {Set<string>} disabled Extension ids.
 * @returns {Promise<void>}
 */
async function writeDisabled(disabled) {
  await fs.writeFile(path.join(app.getPath("userData"), DISABLED_FILE), JSON.stringify({ disabled: [...disabled] }));
}

/**
 * Loads an installed extension into the session and starts its background worker (Manifest V3).
 * @param {Electron.Session} session Tabs' session.
 * @param {string} dir Extension folder.
 * @returns {Promise<void>}
 */
async function loadInstalled(session, dir) {
  const extension = await session.extensions.loadExtension(dir);
  if (extension.manifest.manifest_version === 3 && extension.manifest.background?.service_worker) {
    await session.serviceWorkers.startWorkerForScope(`chrome-extension://${extension.id}`).catch(() => {});
  }
}

module.exports = { discoverInstalled, localize, readIcon, readDisabled, writeDisabled, loadInstalled, extensionsPath };
