// Reads Arc's local data (spaces, their tabs, favorites, installed extensions) for "Import from Arc".
//
// Arc keeps its sidebar in StorableSidebar.json (format notes: re/ARC-REVERSE-ENGINEERING.md §3.1,
// local only). Everything is a node of one flat item table linked by parentID / childrenIds; Swift
// ordered dictionaries are flat [key, value, key, value…] arrays. This module only reads: Arc's
// files are never modified.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_DEPTH = 8;
const MAX_NODES = 5000;
const MAX_TEXT = 500;
const EXTENSION_ID = /^[a-p]{32}$/;
/** Arc's built-in space icons (SF Symbol names) that have an obvious emoji. */
const ICON_EMOJI = { planet: "🪐", star: "⭐", heart: "❤️", bolt: "⚡", flame: "🔥", leaf: "🍃", moon: "🌙", sun: "☀️", book: "📖", briefcase: "💼", house: "🏠", gamecontroller: "🎮" };

/**
 * @typedef {{ kind: "tab", url: string, title: string }} ArcTab
 * @typedef {{ kind: "folder", title: string, children: ArcNode[] }} ArcFolder
 * @typedef {{ kind: "split", orientation: "horizontal" | "vertical", factors: number[], children: ArcTab[] }} ArcSplit
 * @typedef {ArcTab | ArcFolder | ArcSplit} ArcNode
 * @typedef {{ name: string | null, icon: string | null, pinned: ArcNode[], today: ArcNode[] }} ArcSpace
 * @typedef {{ spaces: ArcSpace[], favorites: ArcTab[] }} ArcSidebar
 */

/**
 * Finds Arc's data folder on this computer.
 * @returns {string | null} Folder holding StorableSidebar.json, or null when Arc is not installed.
 */
function findArcDataDir() {
  const candidates = [];
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const packages = path.join(process.env.LOCALAPPDATA, "Packages");
    try {
      for (const name of fs.readdirSync(packages)) {
        if (name.startsWith("TheBrowserCompany.Arc_")) candidates.push(path.join(packages, name, "LocalCache", "Local", "Arc"));
      }
    } catch {
      // No Packages folder: not a packaged Arc install.
    }
  }
  if (process.platform === "darwin") candidates.push(path.join(os.homedir(), "Library", "Application Support", "Arc"));
  return candidates.find((dir) => fs.existsSync(path.join(dir, "StorableSidebar.json"))) ?? null;
}

/**
 * Turns a Swift ordered dictionary ([key, value, key, value…]) into a Map.
 * @param {unknown} list Flat array.
 * @returns {Map<string, any>} Entries with string keys and object values.
 */
function pairs(list) {
  const map = new Map();
  if (!Array.isArray(list)) return map;
  for (let i = 0; i + 1 < list.length; i += 2) {
    if (typeof list[i] === "string" && list[i + 1] && typeof list[i + 1] === "object") map.set(list[i], list[i + 1]);
  }
  return map;
}

/**
 * Trims a text value from Arc's file.
 * @param {unknown} value Candidate text.
 * @returns {string} Text, or "" when absent.
 */
function text(value) {
  return typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : "";
}

/**
 * Picks an emoji for an Arc space icon: the emoji itself when the user chose one, a matching emoji
 * for Arc's built-in symbols, otherwise null (Yzo then uses its default).
 * @param {unknown} customInfo Space customInfo.
 * @returns {string | null} Emoji.
 */
function spaceIcon(customInfo) {
  const iconType = customInfo && typeof customInfo === "object" ? /** @type {any} */ (customInfo).iconType : null;
  if (!iconType || typeof iconType !== "object") return null;
  for (const value of Object.values(iconType)) {
    if (typeof value !== "string" || !value) continue;
    if (/\p{Extended_Pictographic}/u.test(value)) return [...value].slice(0, 4).join("");
    if (ICON_EMOJI[value]) return ICON_EMOJI[value];
  }
  return null;
}

/**
 * Converts Arc's sidebar file into spaces, tabs, folders and split views. Only http(s) tabs are kept.
 * @param {any} json Parsed StorableSidebar.json.
 * @returns {ArcSidebar} Importable sidebar.
 */
function parseArcSidebar(json) {
  const container = (json?.sidebar?.containers ?? []).find((c) => c && Array.isArray(c.spaces) && Array.isArray(c.items));
  if (!container) return { spaces: [], favorites: [] };
  const items = pairs(container.items);
  let budget = MAX_NODES;

  /**
   * Converts one item and its children.
   * @param {string} id Item id.
   * @param {number} depth Nesting depth.
   * @returns {ArcNode | null} Node, or null when skipped.
   */
  const convert = (id, depth) => {
    const item = items.get(id);
    if (!item || depth > MAX_DEPTH || budget-- <= 0) return null;
    const data = item.data ?? {};
    const children = () => (Array.isArray(item.childrenIds) ? item.childrenIds : []).map((child) => convert(child, depth + 1)).filter(Boolean);
    if (data.tab) {
      const url = text(data.tab.savedURL);
      if (!/^https?:\/\//i.test(url)) return null;
      return { kind: "tab", url, title: text(item.title) || text(data.tab.savedTitle) };
    }
    if (data.list) return { kind: "folder", title: text(item.title), children: children() };
    if (data.splitView) {
      const tabs = children().filter((node) => node.kind === "tab");
      const factors = Array.isArray(data.splitView.itemWidthFactors) ? data.splitView.itemWidthFactors.filter((n) => typeof n === "number" && n > 0) : [];
      return { kind: "split", orientation: data.splitView.layoutOrientation === "vertical" ? "vertical" : "horizontal", factors, children: tabs };
    }
    return null;
  };
  const childrenOf = (containerId) =>
    (items.get(containerId)?.childrenIds ?? []).map((/** @type {string} */ id) => convert(id, 1)).filter(Boolean);

  const spaces = [];
  for (const space of pairs(container.spaces).values()) {
    // newContainerIDs: [{pinned: {}}, pinnedId, {unpinned: {…}}, unpinnedId]
    const ids = Array.isArray(space.newContainerIDs) ? space.newContainerIDs : [];
    let pinnedId = null;
    let todayId = null;
    for (let i = 0; i + 1 < ids.length; i += 2) {
      if (ids[i]?.pinned) pinnedId = ids[i + 1];
      else if (ids[i]?.unpinned) todayId = ids[i + 1];
    }
    spaces.push({
      name: text(space.title) || null,
      icon: spaceIcon(space.customInfo),
      pinned: pinnedId ? childrenOf(pinnedId) : [],
      today: todayId ? childrenOf(todayId) : [],
    });
  }

  const favorites = [];
  const topApps = Array.isArray(container.topAppsContainerIDs) ? container.topAppsContainerIDs.filter((id) => typeof id === "string") : [];
  for (const id of topApps) for (const node of childrenOf(id)) if (node.kind === "tab") favorites.push(node);
  return { spaces, favorites };
}

/**
 * Lists the Chrome Web Store extensions installed in Arc's default profile.
 * @param {string} dataDir Arc data folder.
 * @returns {string[]} Extension ids.
 */
function listArcExtensions(dataDir) {
  try {
    return fs.readdirSync(path.join(dataDir, "User Data", "Default", "Extensions")).filter((name) => EXTENSION_ID.test(name));
  } catch {
    return [];
  }
}

/**
 * Reads everything "Import from Arc" brings over.
 * @returns {(ArcSidebar & { extensions: string[] }) | null} Data, or null when Arc's data is missing or unreadable.
 */
function readArc() {
  const dir = findArcDataDir();
  if (!dir) return null;
  try {
    const file = path.join(dir, "StorableSidebar.json");
    if (fs.statSync(file).size > MAX_FILE_BYTES) return null;
    return { ...parseArcSidebar(JSON.parse(fs.readFileSync(file, "utf8"))), extensions: listArcExtensions(dir) };
  } catch {
    return null;
  }
}

/**
 * Counts the tabs of an imported sidebar (folders and splits included).
 * @param {ArcNode[]} nodes Nodes.
 * @returns {number} Tab count.
 */
function countTabs(nodes) {
  return nodes.reduce((sum, node) => sum + (node.kind === "tab" ? 1 : countTabs(node.children)), 0);
}

module.exports = { readArc, parseArcSidebar, countTabs, EXTENSION_ID };
