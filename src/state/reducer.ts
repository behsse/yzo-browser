import { isArchivable } from "../lib/autoArchive";
import { t } from "../lib/i18n";
import { DEFAULT_THEME } from "../lib/theme";
import { applyRemote, markPushed, type LocalChanges, type RemoteRecord } from "../sync/records";
import {
  attach,
  collapseSplitIfNeeded,
  contentOrder,
  deleteSubtree,
  detach,
  isContainer,
  isFolder,
  isInToday,
  isSelfOrDescendant,
  isSplit,
  isTab,
  makeItem,
  makeTabData,
  normalizeFactors,
  pushArchive,
  rootContainerOf,
  spaceOf,
  tabsInSubtree,
  topLevelContentOf,
  uid,
} from "./tree";
import type {
  AppState,
  ContainerData,
  ID,
  Settings,
  SidebarMode,
  Space,
  SpaceTheme,
  SplitOrientation,
  SuggestionKind,
} from "./types";
import { HISTORY_LIMIT, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "./types";

export const MAX_SPLIT_PANES = 4;
const COMMAND_MEMORY_LIMIT = 200;

export type TabTarget = "today" | "pinned" | "favorites" | { parentId: ID; index?: number };

export type Action =
  | { type: "hydrate"; state: AppState }
  | {
      type: "createTab";
      url: string;
      target: TabTarget;
      activate: boolean;
      now: number;
      spaceId?: ID;
      title?: string;
      /** Imposed id, for tabs requested by extensions that wait for that exact tab. */
      id?: ID;
      /** Load the page even when the tab is not activated (background tabs opened by extensions). */
      load?: boolean;
    }
  | { type: "updateTab"; id: ID; url?: string; title?: string; favicon?: string | null; now: number }
  | { type: "activate"; id: ID; now: number }
  | { type: "closeItem"; id: ID; now: number }
  | { type: "reopenClosed"; now: number }
  | { type: "restoreArchived"; archiveId: ID; now: number }
  | { type: "deleteArchived"; archiveId: ID }
  | { type: "moveItem"; id: ID; parentId: ID; index?: number }
  | { type: "togglePin"; id: ID }
  | { type: "addToFavorites"; id: ID }
  | { type: "createFolder"; spaceId: ID; title: string; now: number }
  | { type: "renameItem"; id: ID; title: string }
  | { type: "toggleFolder"; id: ID }
  | { type: "deleteFolder"; id: ID; now: number }
  | { type: "createSpace"; name: string; icon: string; theme: SpaceTheme; now: number }
  | { type: "updateSpace"; id: ID; name?: string; icon?: string; theme?: SpaceTheme }
  | { type: "deleteSpace"; id: ID; now: number }
  | { type: "switchSpace"; id: ID }
  | { type: "switchSpaceIndex"; index: number }
  | { type: "addSplit"; tabId: ID; url: string; now: number }
  | { type: "splitWithTab"; tabId: ID; otherTabId: ID; now: number }
  | { type: "setSplitOrientation"; id: ID; orientation: SplitOrientation }
  | { type: "setSplitFactors"; id: ID; factors: number[] }
  | { type: "unsplit"; id: ID }
  | { type: "cycleContent"; delta: 1 | -1; now: number }
  | { type: "runAutoArchive"; now: number }
  | { type: "clearToday"; spaceId: ID; now: number }
  | { type: "setSidebarMode"; mode: SidebarMode }
  | { type: "setSidebarWidth"; width: number }
  | { type: "updateSettings"; settings: Partial<Settings> }
  | { type: "recordVisit"; url: string; title: string; now: number }
  | { type: "rememberChoice"; query: string; kind: SuggestionKind }
  | { type: "applySync"; records: RemoteRecord[]; cursor: number; now: number }
  | { type: "syncPushed"; changes: LocalChanges; accepted: { recordId: string; version: number }[]; cursor: number; now: number }
  | { type: "resetSync"; email: string | null };

/**
 * Fresh sync bookkeeping for an account.
 * @param email Signed-in e-mail, or null.
 * @returns Empty metadata (cursor 0, nothing synced).
 */
export function emptySyncMeta(email: string | null): AppState["sync"] {
  return { cursor: 0, records: {}, email, lastSyncAt: null };
}

/**
 * Builds the first-launch state: one space with the favorites observed as Arc's default sidebar
 * (Google, YouTube, Linear — re/ARC-REVERSE-ENGINEERING.md §6) and an empty today section.
 * @param now Current epoch ms.
 * @returns A complete state.
 */
export function createInitialState(now: number): AppState {
  const state: AppState = {
    version: 1,
    items: {},
    spaceOrder: [],
    spaces: {},
    favoritesId: "",
    window: { focusedSpaceId: "", selection: {}, sidebarMode: "anchored", sidebarWidth: SIDEBAR_DEFAULT_WIDTH },
    archive: [],
    history: [],
    commandMemory: {},
    settings: { autoArchive: "twelveHours", searchEngine: "google" },
    sync: emptySyncMeta(null),
    loadedTabIds: [],
  };
  const favorites = makeItem<ContainerData>({ kind: "container", role: "favorites", spaceId: null }, now);
  state.items[favorites.id] = favorites;
  state.favoritesId = favorites.id;
  addSpace(state, t("default.spaceName"), "🪐", DEFAULT_THEME, now);
  for (const [url, title] of [
    ["https://www.google.com/", "Google"],
    ["https://www.youtube.com/", "YouTube"],
    ["https://linear.app/", "Linear"],
  ]) {
    const tab = makeItem(makeTabData(url, now, title), now);
    state.items[tab.id] = tab;
    attach(state, tab.id, favorites.id);
  }
  return state;
}

/**
 * Creates a space with its pinned and today containers and focuses it.
 * @param draft Mutable state copy.
 * @param name Display name.
 * @param icon Emoji icon.
 * @param theme Sidebar theme.
 * @param now Current epoch ms.
 * @returns The new space id.
 */
function addSpace(draft: AppState, name: string, icon: string, theme: SpaceTheme, now: number): ID {
  const id = uid();
  const pinned = makeItem<ContainerData>({ kind: "container", role: "pinned", spaceId: id }, now);
  const today = makeItem<ContainerData>({ kind: "container", role: "today", spaceId: id }, now);
  draft.items[pinned.id] = pinned;
  draft.items[today.id] = today;
  const space: Space = { id, name: name.trim() || t("default.spaceFallback"), icon: icon || "🪐", theme, pinnedId: pinned.id, todayId: today.id };
  draft.spaces[id] = space;
  draft.spaceOrder.push(id);
  draft.window.selection[id] = { itemId: null, focusedTabId: null };
  draft.window.focusedSpaceId = id;
  return id;
}

/**
 * Resolves where a new tab goes.
 * @param draft Mutable state copy.
 * @param target Requested target.
 * @param spaceId Space for "today"/"pinned" targets.
 * @returns Parent id and index.
 */
function resolveTarget(draft: AppState, target: TabTarget, spaceId: ID): { parentId: ID; index?: number } {
  if (target === "favorites") return { parentId: draft.favoritesId };
  if (target === "pinned") return { parentId: draft.spaces[spaceId].pinnedId };
  // Arc inserts new today tabs at the top of the unpinned section.
  if (target === "today") return { parentId: draft.spaces[spaceId].todayId, index: 0 };
  return target;
}

/**
 * Selects a tab or split, focusing the right space and marking the tabs as loaded and active.
 * @param draft Mutable state copy.
 * @param id Tab or split to show.
 * @param now Current epoch ms.
 */
function activateItem(draft: AppState, id: ID, now: number): void {
  const item = draft.items[id];
  if (!isTab(item) && !isSplit(item)) return;
  const owner = spaceOf(draft, id);
  if (owner) draft.window.focusedSpaceId = owner;
  const spaceId = draft.window.focusedSpaceId;
  const contentId = isTab(item) ? topLevelContentOf(draft, id) : id;
  const content = draft.items[contentId];
  let focusedTabId: ID | null = isTab(item) ? id : null;
  if (isSplit(content)) {
    focusedTabId = focusedTabId ?? content.data.focusedChildId ?? content.childrenIds[0] ?? null;
    content.data.focusedChildId = focusedTabId;
    content.data.lastActiveAt = now;
  }
  draft.window.selection[spaceId] = { itemId: contentId, focusedTabId };
  for (const tabId of tabsInSubtree(draft, contentId)) {
    const tab = draft.items[tabId];
    if (isTab(tab)) tab.data.lastActiveAt = now;
    if (!draft.loadedTabIds.includes(tabId)) draft.loadedTabIds.push(tabId);
  }
}

/**
 * Marks the tabs shown by a space's selection as loaded, so switching to a space (or restarting the
 * app) displays its selected page instead of an empty content area.
 * @param draft Mutable state copy.
 * @param spaceId Space whose selection becomes visible.
 */
function loadSelection(draft: AppState, spaceId: ID): void {
  const itemId = draft.window.selection[spaceId]?.itemId;
  if (!itemId || !draft.items[itemId]) return;
  for (const tabId of tabsInSubtree(draft, itemId)) {
    if (!draft.loadedTabIds.includes(tabId)) draft.loadedTabIds.push(tabId);
  }
}

/**
 * Clears every selection pointing at an item, choosing a neighbour in the same parent when the
 * selection belonged to the focused space so closing a tab lands on the next one like Arc.
 * @param draft Mutable state copy.
 * @param id Item about to disappear or unload.
 * @param now Current epoch ms.
 */
function deselect(draft: AppState, id: ID, now: number): void {
  for (const [spaceId, selection] of Object.entries(draft.window.selection)) {
    if (selection.itemId !== id && selection.focusedTabId !== id) continue;
    const order = contentOrder(draft, spaceId).filter((c) => c !== id && !isSelfOrDescendant(draft, id, c));
    const position = contentOrder(draft, spaceId).indexOf(id);
    const fallback = isInToday(draft, id) ? order[Math.min(Math.max(position, 0), order.length - 1)] : undefined;
    draft.window.selection[spaceId] = { itemId: null, focusedTabId: null };
    if (fallback && spaceId === draft.window.focusedSpaceId) activateItem(draft, fallback, now);
  }
}

/**
 * Closes one tab: unpinned tabs are archived and removed; pinned and favorite tabs are unloaded and
 * reset to their saved URL, as Arc does.
 * @param draft Mutable state copy.
 * @param id Tab id.
 * @param now Current epoch ms.
 */
function closeTab(draft: AppState, id: ID, now: number): void {
  const tab = draft.items[id];
  if (!isTab(tab)) return;
  const parentId = tab.parentId;
  const inSplit = parentId !== null && isSplit(draft.items[parentId]);
  if (isInToday(draft, id) || inSplit) {
    const spaceId = spaceOf(draft, id) ?? draft.window.focusedSpaceId;
    deselect(draft, inSplit ? parentId! : id, now);
    if (isInToday(draft, id)) pushArchive(draft, tab, spaceId, "manual", now);
    if (inSplit && !isInToday(draft, id)) {
      // A pinned split pane is detached back next to its split instead of being destroyed.
      const split = draft.items[parentId!];
      detach(draft, id);
      attach(draft, id, split.parentId!, draft.items[split.parentId!].childrenIds.indexOf(parentId!) + 1);
      draft.loadedTabIds = draft.loadedTabIds.filter((t) => t !== id);
    } else {
      deleteSubtree(draft, id);
    }
    if (inSplit) {
      const remaining = collapseSplitIfNeeded(draft, parentId!);
      if (remaining && spaceId === draft.window.focusedSpaceId) activateItem(draft, remaining, now);
    }
    return;
  }
  deselect(draft, id, now);
  tab.data.url = tab.data.savedUrl;
  draft.loadedTabIds = draft.loadedTabIds.filter((t) => t !== id);
}

/**
 * Restores an archive entry as a new today tab of its space (or the focused one if deleted).
 * @param draft Mutable state copy.
 * @param index Index in the archive list.
 * @param now Current epoch ms.
 */
function restoreArchiveEntry(draft: AppState, index: number, now: number): void {
  const [entry] = draft.archive.splice(index, 1);
  if (!entry) return;
  const spaceId = draft.spaces[entry.spaceId] ? entry.spaceId : draft.window.focusedSpaceId;
  const tab = makeItem(makeTabData(entry.url, now, entry.title), now);
  tab.data.favicon = entry.favicon;
  draft.items[tab.id] = tab;
  attach(draft, tab.id, draft.spaces[spaceId].todayId, 0);
  activateItem(draft, tab.id, now);
}

/**
 * Archives a today item (tab, folder or split) and removes it.
 * @param draft Mutable state copy.
 * @param id Item id.
 * @param spaceId Owning space.
 * @param reason Archive reason.
 * @param now Current epoch ms.
 */
function archiveSubtree(draft: AppState, id: ID, spaceId: ID, reason: "manual" | "auto" | "spaceDeleted", now: number): void {
  for (const tabId of tabsInSubtree(draft, id)) {
    const tab = draft.items[tabId];
    if (isTab(tab)) pushArchive(draft, tab, spaceId, reason, now);
  }
  deleteSubtree(draft, id);
}

/**
 * Tells whether an item may be dropped under a parent.
 * @param state App state.
 * @param id Item being moved.
 * @param parentId Drop target.
 * @returns True when the move keeps the tree valid.
 */
export function canMove(state: AppState, id: ID, parentId: ID): boolean {
  const item = state.items[id];
  const parent = state.items[parentId];
  if (!item || !parent || isContainer(item)) return false;
  if (isSelfOrDescendant(state, id, parentId)) return false;
  if (isTab(parent) || isSplit(parent)) return false;
  if (isContainer(parent) && parent.data.role === "favorites") return isTab(item);
  return true;
}

/**
 * Applies one action to the state. Every branch works on a structured clone, so the previous state
 * is never mutated and React can rely on reference changes.
 * @param state Current state.
 * @param action Action to apply.
 * @returns The next state.
 */
export function reducer(state: AppState, action: Action): AppState {
  if (action.type === "hydrate") {
    const hydrated: AppState = { ...action.state, loadedTabIds: [] };
    loadSelection(hydrated, hydrated.window.focusedSpaceId);
    return hydrated;
  }
  const draft = structuredClone(state);
  const focused = draft.window.focusedSpaceId;

  switch (action.type) {
    case "createTab": {
      const spaceId = action.spaceId && draft.spaces[action.spaceId] ? action.spaceId : focused;
      const { parentId, index } = resolveTarget(draft, action.target, spaceId);
      if (!draft.items[parentId]) return state;
      const tab = makeItem(makeTabData(action.url, action.now, action.title), action.now);
      if (action.id) {
        if (draft.items[action.id]) return state;
        tab.id = action.id;
      }
      draft.items[tab.id] = tab;
      attach(draft, tab.id, parentId, index);
      if (action.activate) activateItem(draft, tab.id, action.now);
      else if (action.load && !draft.loadedTabIds.includes(tab.id)) draft.loadedTabIds.push(tab.id);
      return draft;
    }

    case "updateTab": {
      const tab = draft.items[action.id];
      if (!isTab(tab)) return state;
      if (action.url !== undefined && action.url !== tab.data.url) {
        tab.data.url = action.url;
        tab.data.lastActiveAt = action.now;
        // Unpinned tabs follow the page; pinned tabs keep the URL they were pinned with.
        if (isInToday(draft, action.id)) tab.data.savedUrl = action.url;
      }
      if (action.title !== undefined) tab.data.title = action.title;
      if (action.favicon !== undefined) tab.data.favicon = action.favicon;
      return draft;
    }

    case "activate":
      activateItem(draft, action.id, action.now);
      return draft;

    case "closeItem": {
      const item = draft.items[action.id];
      if (isTab(item)) closeTab(draft, action.id, action.now);
      else if (isSplit(item)) {
        const selection = draft.window.selection[focused];
        closeTab(draft, selection.focusedTabId ?? item.childrenIds[0], action.now);
      }
      return draft;
    }

    case "reopenClosed":
      restoreArchiveEntry(draft, 0, action.now);
      return draft;

    case "restoreArchived": {
      const index = draft.archive.findIndex((e) => e.id === action.archiveId);
      if (index < 0) return state;
      restoreArchiveEntry(draft, index, action.now);
      return draft;
    }

    case "deleteArchived":
      draft.archive = draft.archive.filter((e) => e.id !== action.archiveId);
      return draft;

    case "moveItem": {
      if (!canMove(draft, action.id, action.parentId)) return state;
      const item = draft.items[action.id];
      let index = action.index;
      if (item.parentId === action.parentId && index !== undefined) {
        const current = draft.items[action.parentId].childrenIds.indexOf(action.id);
        if (current < index) index -= 1;
      }
      const oldParent = item.parentId;
      detach(draft, action.id);
      attach(draft, action.id, action.parentId, index);
      if (oldParent && isSplit(draft.items[oldParent])) collapseSplitIfNeeded(draft, oldParent);
      // A tab moved into a pinned container starts a new pinned identity at its current page.
      if (isTab(item) && !isInToday(draft, action.id)) item.data.savedUrl = item.data.url;
      return draft;
    }

    case "togglePin": {
      const contentId = isTab(draft.items[action.id]) ? topLevelContentOf(draft, action.id) : action.id;
      const root = rootContainerOf(draft, contentId);
      if (!root) return state;
      const spaceId = root.data.spaceId ?? focused;
      const space = draft.spaces[spaceId];
      const target = root.data.role === "today" ? space.pinnedId : space.todayId;
      const index = root.data.role === "today" ? undefined : 0;
      detach(draft, contentId);
      attach(draft, contentId, target, index);
      for (const tabId of tabsInSubtree(draft, contentId)) {
        const tab = draft.items[tabId];
        if (isTab(tab)) tab.data.savedUrl = tab.data.url;
      }
      return draft;
    }

    case "addToFavorites": {
      if (!canMove(draft, action.id, draft.favoritesId)) return state;
      const oldParent = draft.items[action.id].parentId;
      detach(draft, action.id);
      attach(draft, action.id, draft.favoritesId);
      if (oldParent && isSplit(draft.items[oldParent])) collapseSplitIfNeeded(draft, oldParent);
      return draft;
    }

    case "createFolder": {
      const space = draft.spaces[action.spaceId];
      if (!space) return state;
      const folder = makeItem({ kind: "folder", title: action.title.trim() || t("default.folderName"), collapsed: false }, action.now);
      draft.items[folder.id] = folder;
      attach(draft, folder.id, space.pinnedId);
      return draft;
    }

    case "renameItem": {
      const item = draft.items[action.id];
      const title = action.title.trim();
      if (isFolder(item) && title) item.data.title = title;
      else if (isTab(item)) item.data.title = title || item.data.title;
      else return state;
      return draft;
    }

    case "toggleFolder": {
      const folder = draft.items[action.id];
      if (!isFolder(folder)) return state;
      folder.data.collapsed = !folder.data.collapsed;
      return draft;
    }

    case "deleteFolder": {
      const folder = draft.items[action.id];
      if (!isFolder(folder)) return state;
      const spaceId = spaceOf(draft, action.id) ?? focused;
      for (const tabId of tabsInSubtree(draft, action.id)) deselect(draft, topLevelContentOf(draft, tabId), action.now);
      archiveSubtree(draft, action.id, spaceId, "manual", action.now);
      return draft;
    }

    case "createSpace":
      addSpace(draft, action.name, action.icon, action.theme, action.now);
      return draft;

    case "updateSpace": {
      const space = draft.spaces[action.id];
      if (!space) return state;
      if (action.name !== undefined && action.name.trim()) space.name = action.name.trim();
      if (action.icon !== undefined && action.icon.trim()) space.icon = action.icon.trim();
      if (action.theme !== undefined) space.theme = action.theme;
      return draft;
    }

    case "deleteSpace": {
      const space = draft.spaces[action.id];
      if (!space || draft.spaceOrder.length <= 1) return state;
      for (const childId of [...draft.items[space.todayId].childrenIds]) {
        archiveSubtree(draft, childId, space.id, "spaceDeleted", action.now);
      }
      deleteSubtree(draft, space.todayId);
      deleteSubtree(draft, space.pinnedId);
      const index = draft.spaceOrder.indexOf(action.id);
      draft.spaceOrder.splice(index, 1);
      delete draft.spaces[action.id];
      delete draft.window.selection[action.id];
      if (focused === action.id) draft.window.focusedSpaceId = draft.spaceOrder[Math.max(0, index - 1)];
      loadSelection(draft, draft.window.focusedSpaceId);
      return draft;
    }

    case "switchSpace":
      if (!draft.spaces[action.id]) return state;
      draft.window.focusedSpaceId = action.id;
      loadSelection(draft, action.id);
      return draft;

    case "switchSpaceIndex": {
      const id = draft.spaceOrder[action.index];
      if (!id) return state;
      draft.window.focusedSpaceId = id;
      loadSelection(draft, id);
      return draft;
    }

    case "addSplit":
    case "splitWithTab": {
      const tab = draft.items[action.tabId];
      if (!isTab(tab) || rootContainerOf(draft, action.tabId)?.data.role === "favorites") return state;
      let otherId: ID;
      if (action.type === "addSplit") {
        const other = makeItem(makeTabData(action.url, action.now), action.now);
        draft.items[other.id] = other;
        otherId = other.id;
      } else {
        const other = draft.items[action.otherTabId];
        if (!isTab(other) || action.otherTabId === action.tabId) return state;
        const oldParent = other.parentId;
        detach(draft, action.otherTabId);
        if (oldParent && isSplit(draft.items[oldParent])) collapseSplitIfNeeded(draft, oldParent);
        otherId = action.otherTabId;
      }
      const contentId = topLevelContentOf(draft, action.tabId);
      let split = draft.items[contentId];
      if (!isSplit(split)) {
        const parentId = tab.parentId!;
        const index = draft.items[parentId].childrenIds.indexOf(action.tabId);
        const created = makeItem(
          { kind: "split", orientation: "horizontal", widthFactors: [], focusedChildId: null, lastActiveAt: action.now },
          action.now,
        );
        draft.items[created.id] = created;
        detach(draft, action.tabId);
        attach(draft, created.id, parentId, index);
        attach(draft, action.tabId, created.id);
        split = created;
      }
      if (!isSplit(split) || split.childrenIds.length >= MAX_SPLIT_PANES) {
        if (action.type === "addSplit") deleteSubtree(draft, otherId);
        return action.type === "addSplit" ? draft : state;
      }
      attach(draft, otherId, split.id);
      split.data.widthFactors = normalizeFactors([], split.childrenIds.length);
      activateItem(draft, otherId, action.now);
      return draft;
    }

    case "setSplitOrientation": {
      const split = draft.items[action.id];
      if (!isSplit(split)) return state;
      split.data.orientation = action.orientation;
      return draft;
    }

    case "setSplitFactors": {
      const split = draft.items[action.id];
      if (!isSplit(split)) return state;
      split.data.widthFactors = normalizeFactors(action.factors, split.childrenIds.length);
      return draft;
    }

    case "unsplit": {
      const split = draft.items[action.id];
      if (!isSplit(split) || !split.parentId) return state;
      const parentId = split.parentId;
      const index = draft.items[parentId].childrenIds.indexOf(action.id);
      const children = [...split.childrenIds];
      const focusedChild = split.data.focusedChildId ?? children[0];
      for (const child of children) detach(draft, child);
      deleteSubtree(draft, action.id);
      children.forEach((child, i) => attach(draft, child, parentId, index + i));
      for (const selection of Object.values(draft.window.selection)) {
        if (selection.itemId === action.id) {
          selection.itemId = focusedChild;
          selection.focusedTabId = focusedChild;
        }
      }
      return draft;
    }

    case "cycleContent": {
      const order = contentOrder(draft, focused);
      if (!order.length) return state;
      const current = order.indexOf(draft.window.selection[focused]?.itemId ?? "");
      const next = order[(current + action.delta + order.length) % order.length];
      activateItem(draft, next, action.now);
      return draft;
    }

    case "runAutoArchive": {
      if (draft.settings.autoArchive === "never") return state;
      const selected = new Set(Object.values(draft.window.selection).map((s) => s.itemId));
      let changed = false;
      for (const space of Object.values(draft.spaces)) {
        for (const childId of [...draft.items[space.todayId].childrenIds]) {
          if (selected.has(childId)) continue;
          const tabs = tabsInSubtree(draft, childId).map((t) => draft.items[t]).filter(isTab);
          const lastActive = Math.max(0, ...tabs.map((t) => t.data.lastActiveAt));
          if (tabs.length && isArchivable(lastActive, draft.settings.autoArchive, action.now)) {
            archiveSubtree(draft, childId, space.id, "auto", action.now);
            changed = true;
          }
        }
      }
      return changed ? draft : state;
    }

    case "clearToday": {
      const space = draft.spaces[action.spaceId];
      if (!space) return state;
      for (const childId of [...draft.items[space.todayId].childrenIds]) {
        const selection = draft.window.selection[space.id];
        if (selection && selection.itemId === childId) draft.window.selection[space.id] = { itemId: null, focusedTabId: null };
        archiveSubtree(draft, childId, space.id, "manual", action.now);
      }
      return draft;
    }

    case "setSidebarMode":
      draft.window.sidebarMode = action.mode;
      return draft;

    case "setSidebarWidth":
      draft.window.sidebarWidth = Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, action.width)));
      return draft;

    case "updateSettings":
      draft.settings = { ...draft.settings, ...action.settings };
      return draft;

    case "recordVisit": {
      if (!/^https?:/i.test(action.url)) return state;
      const existing = draft.history.findIndex((h) => h.url === action.url);
      const entry = existing >= 0 ? draft.history.splice(existing, 1)[0] : { url: action.url, title: "", lastVisitAt: 0, visitCount: 0 };
      entry.title = action.title || entry.title;
      entry.lastVisitAt = action.now;
      // Navigations arrive without a title and count as a visit; later title updates do not.
      entry.visitCount = Math.max(1, entry.visitCount + (action.title ? 0 : 1));
      draft.history.unshift(entry);
      draft.history.length = Math.min(draft.history.length, HISTORY_LIMIT);
      return draft;
    }

    case "applySync": {
      const merged = applyRemote(state, action.records, action.now);
      merged.sync = { ...merged.sync, cursor: Math.max(merged.sync.cursor, action.cursor), lastSyncAt: action.now };
      return merged;
    }

    case "syncPushed": {
      draft.sync = { ...markPushed(draft.sync, action.changes, action.accepted), lastSyncAt: action.now };
      // Our own writes come back on the next pull; skip them only if nothing else happened in between.
      if (action.cursor === draft.sync.cursor + action.accepted.length) draft.sync.cursor = action.cursor;
      return draft;
    }

    case "resetSync":
      draft.sync = emptySyncMeta(action.email);
      return draft;

    case "rememberChoice": {
      const query = action.query.trim().toLowerCase();
      if (!query) return state;
      delete draft.commandMemory[query];
      draft.commandMemory[query] = action.kind;
      const keys = Object.keys(draft.commandMemory);
      for (const key of keys.slice(0, Math.max(0, keys.length - COMMAND_MEMORY_LIMIT))) delete draft.commandMemory[key];
      return draft;
    }
  }
}
