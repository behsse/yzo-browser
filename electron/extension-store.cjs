// Installed extensions on disk (userData/Extensions/<id>/<version>/, written by electron-chrome-web-store)
// and the user's choices for them (turned off, allowed in private windows). Yzo loads them itself
// instead of letting the library load them all, so a turned-off extension never runs. Every function
// takes the normal profile's folder: private instances read the same installs.

const { app } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { readFileSync } = require("node:fs");

const SETTINGS_FILE = "extension-settings.json";
/** Largest icon read for the extensions page. */
const ICON_MAX_SIZE = 128;
const ID_PATTERN = /^[a-p]{32}$/;

/**
 * Folder holding the Chrome Web Store installs.
 * @param {string} profile Normal profile folder.
 * @returns {string} Absolute path.
 */
function extensionsPath(profile) {
  return path.join(profile, "Extensions");
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
 * @param {string} profile Normal profile folder.
 * @returns {Promise<Map<string, { path: string, manifest: chrome.runtime.Manifest }>>} By extension id.
 */
async function discoverInstalled(profile) {
  const found = new Map();
  let ids = [];
  try {
    ids = await fs.readdir(extensionsPath(profile), { withFileTypes: true });
  } catch {
    return found;
  }
  for (const idEntry of ids) {
    if (!idEntry.isDirectory() || !ID_PATTERN.test(idEntry.name)) continue;
    const idDir = path.join(extensionsPath(profile), idEntry.name);
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
 * Total size of an extension's files on disk.
 * @param {string} dir Extension folder.
 * @returns {Promise<number>} Bytes.
 */
async function folderSize(dir) {
  let total = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await folderSize(full);
    else if (entry.isFile()) total += (await fs.stat(full).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

/**
 * Reads the user's choices for the installed extensions.
 * @param {string} profile Normal profile folder.
 * @returns {Promise<{ disabled: Set<string>, privateAllowed: Set<string> }>} Extension ids turned off,
 *   and allowed in private windows.
 */
async function readSettings(profile) {
  let parsed = null;
  try {
    parsed = JSON.parse(await fs.readFile(path.join(profile, SETTINGS_FILE), "utf8"));
  } catch {
    // No choices yet.
  }
  const ids = (value) => new Set((Array.isArray(value) ? value : []).filter((id) => ID_PATTERN.test(id)));
  return { disabled: ids(parsed?.disabled), privateAllowed: ids(parsed?.privateAllowed) };
}

/**
 * Whether any turned-on extension is allowed in private windows. Read at startup, before the tabs'
 * session is chosen.
 * @param {string} profile Normal profile folder.
 * @returns {boolean} True when a private window will run extensions.
 */
function hasPrivateExtensions(profile) {
  try {
    const parsed = JSON.parse(readFileSync(path.join(profile, SETTINGS_FILE), "utf8"));
    const disabled = new Set(Array.isArray(parsed?.disabled) ? parsed.disabled : []);
    return (Array.isArray(parsed?.privateAllowed) ? parsed.privateAllowed : []).some((id) => ID_PATTERN.test(id) && !disabled.has(id));
  } catch {
    return false;
  }
}

/**
 * Saves the user's choices for the installed extensions.
 * @param {string} profile Normal profile folder.
 * @param {{ disabled: Set<string>, privateAllowed: Set<string> }} settings Choices.
 * @returns {Promise<void>}
 */
async function writeSettings(profile, settings) {
  const json = JSON.stringify({ disabled: [...settings.disabled], privateAllowed: [...settings.privateAllowed] });
  await fs.writeFile(path.join(profile, SETTINGS_FILE), json);
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

module.exports = { discoverInstalled, localize, readIcon, folderSize, readSettings, writeSettings, hasPrivateExtensions, loadInstalled };
