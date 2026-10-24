import type {
  AppState,
  ArchiveReason,
  ContainerData,
  FolderData,
  ID,
  ItemData,
  SidebarItem,
  SplitData,
  TabData,
} from "./types";
import { ARCHIVE_LIMIT } from "./types";

/**
 * Pure helpers over the flat sidebar item table. Functions taking a state named `draft` mutate it;
 * the reducer always hands them a fresh copy, so no caller ever sees a mutated state.
 */

/**
 * Generates a random item identifier.
 * @returns RFC 4122 v4 UUID string.
 */
export function uid(): ID {
  return crypto.randomUUID();
}

/**
 * Narrows an item to a tab.
 * @param item Sidebar item or undefined.
 * @returns True for tab items.
 */
export function isTab(item: SidebarItem | undefined): item is SidebarItem<TabData> {
  return item?.data.kind === "tab";
}

/**
 * Narrows an item to a folder.
 * @param item Sidebar item or undefined.
 * @returns True for folder items.
 */
export function isFolder(item: SidebarItem | undefined): item is SidebarItem<FolderData> {
  return item?.data.kind === "folder";
}

/**
 * Narrows an item to a split view.
 * @param item Sidebar item or undefined.
 * @returns True for split items.
 */
export function isSplit(item: SidebarItem | undefined): item is SidebarItem<SplitData> {
  return item?.data.kind === "split";
}

/**
 * Narrows an item to a container (pinned, today or favorites root).
 * @param item Sidebar item or undefined.
 * @returns True for container items.
 */
export function isContainer(item: SidebarItem | undefined): item is SidebarItem<ContainerData> {
  return item?.data.kind === "container";
}

/**
 * Creates an item record without attaching it to a parent.
 * @param data Item payload.
 * @param now Creation time in epoch ms.
 * @returns The new item.
 */
export function makeItem<D extends ItemData>(data: D, now: number): SidebarItem<D> {
  return { id: uid(), parentId: null, childrenIds: [], createdAt: now, data };
}

/**
 * Builds a tab payload for a URL.
 * @param url Page URL.
 * @param now Creation time in epoch ms.
 * @param title Optional initial title.
 * @returns Tab payload.
 */
export function makeTabData(url: string, now: number, title = ""): TabData {
  return { kind: "tab", url, title, favicon: null, savedUrl: url, lastActiveAt: now };
}

/**
 * Finds the root container holding an item by walking up its parents.
 * @param state App state.
 * @param id Item to locate.
 * @returns The container item, or null for detached items.
 */
export function rootContainerOf(state: AppState, id: ID): SidebarItem<ContainerData> | null {
  let current = state.items[id];
  const seen = new Set<ID>();
  while (current && !isContainer(current)) {
    if (seen.has(current.id) || current.parentId === null) return null;
    seen.add(current.id);
    current = state.items[current.parentId];
  }
  return isContainer(current) ? current : null;
}

/**
 * Tells whether an item sits in a space's "today" (unpinned) section.
 * @param state App state.
 * @param id Item to test.
 * @returns True for unpinned items.
 */
export function isInToday(state: AppState, id: ID): boolean {
  return rootContainerOf(state, id)?.data.role === "today";
}

/**
 * Returns the space owning an item; favorites belong to no space.
 * @param state App state.
 * @param id Item to locate.
 * @returns Space id, or null for favorites and detached items.
 */
export function spaceOf(state: AppState, id: ID): ID | null {
  return rootContainerOf(state, id)?.data.spaceId ?? null;
}

/**
 * Tells whether `id` is `ancestorId` or one of its descendants.
 * @param state App state.
 * @param ancestorId Candidate ancestor.
 * @param id Item to test.
 * @returns True when moving `ancestorId` under `id` would create a cycle.
 */
export function isSelfOrDescendant(state: AppState, ancestorId: ID, id: ID): boolean {
  let current: SidebarItem | undefined = state.items[id];
  while (current) {
    if (current.id === ancestorId) return true;
    current = current.parentId ? state.items[current.parentId] : undefined;
  }
  return false;
}

/**
 * Lists every tab in an item's subtree, the item included when it is a tab.
 * @param state App state.
 * @param id Subtree root.
 * @returns Tab ids in display order.
 */
export function tabsInSubtree(state: AppState, id: ID): ID[] {
  const item = state.items[id];
  if (!item) return [];
  if (isTab(item)) return [id];
  return item.childrenIds.flatMap((child) => tabsInSubtree(state, child));
}

/**
 * Returns what the content area shows for a tab: its split view when it belongs to one.
 * @param state App state.
 * @param tabId Tab id.
 * @returns The split id or the tab id itself.
 */
export function topLevelContentOf(state: AppState, tabId: ID): ID {
  const parent = state.items[tabId]?.parentId;
  return parent && isSplit(state.items[parent]) ? parent : tabId;
}

/**
 * Removes an item from its parent's child list, leaving the item record in place.
 * @param draft Mutable state copy.
 * @param id Item to detach.
 */
export function detach(draft: AppState, id: ID): void {
  const item = draft.items[id];
  if (!item?.parentId) return;
  const parent = draft.items[item.parentId];
  if (parent) {
    const index = parent.childrenIds.indexOf(id);
    parent.childrenIds.splice(index, 1);
    if (isSplit(parent) && index >= 0) parent.data.widthFactors.splice(index, 1);
  }
  item.parentId = null;
}

/**
 * Inserts an item under a parent at an index (appends when the index is out of range).
 * @param draft Mutable state copy.
 * @param id Item to attach; must be detached.
 * @param parentId New parent.
 * @param index Position among the parent's children.
 */
export function attach(draft: AppState, id: ID, parentId: ID, index?: number): void {
  const parent = draft.items[parentId];
  const item = draft.items[id];
  if (!parent || !item) return;
  const at = index === undefined || index < 0 || index > parent.childrenIds.length ? parent.childrenIds.length : index;
  parent.childrenIds.splice(at, 0, id);
  item.parentId = parentId;
}

/**
 * Deletes an item and its whole subtree, and forgets their live tab pages.
 * @param draft Mutable state copy.
 * @param id Subtree root.
 */
export function deleteSubtree(draft: AppState, id: ID): void {
  const item = draft.items[id];
  if (!item) return;
  detach(draft, id);
  const stack = [id];
  while (stack.length) {
    const current = draft.items[stack.pop()!];
    if (!current) continue;
    stack.push(...current.childrenIds);
    delete draft.items[current.id];
    draft.loadedTabIds = draft.loadedTabIds.filter((t) => t !== current.id);
  }
}

/**
 * Records a tab in the archive, newest first, capped at ARCHIVE_LIMIT entries.
 * @param draft Mutable state copy.
 * @param tab Tab being archived.
 * @param spaceId Space it came from.
 * @param reason Why it was archived.
 * @param now Archive time in epoch ms.
 */
export function pushArchive(
  draft: AppState,
  tab: SidebarItem<TabData>,
  spaceId: ID,
  reason: ArchiveReason,
  now: number,
): void {
  if (tab.data.url === "about:blank") return;
  draft.archive.unshift({
    id: uid(),
    title: tab.data.title || tab.data.url,
    url: tab.data.url,
    favicon: tab.data.favicon,
    spaceId,
    reason,
    archivedAt: now,
  });
  draft.archive.length = Math.min(draft.archive.length, ARCHIVE_LIMIT);
}

/**
 * Replaces a split that has fewer than two panes by its remaining child (or nothing).
 * @param draft Mutable state copy.
 * @param splitId Split to normalize.
 * @returns The id now standing where the split was, or null when the split was removed.
 */
export function collapseSplitIfNeeded(draft: AppState, splitId: ID): ID | null {
  const split = draft.items[splitId];
  if (!isSplit(split)) return splitId;
  if (split.childrenIds.length >= 2) {
    split.data.widthFactors = normalizeFactors(split.data.widthFactors, split.childrenIds.length);
    if (split.data.focusedChildId && !split.childrenIds.includes(split.data.focusedChildId)) {
      split.data.focusedChildId = split.childrenIds[0];
    }
    return splitId;
  }
  const parentId = split.parentId;
  const index = parentId ? draft.items[parentId].childrenIds.indexOf(splitId) : -1;
  const remaining = split.childrenIds[0] ?? null;
  if (remaining) detach(draft, remaining);
  deleteSubtree(draft, splitId);
  if (remaining && parentId) attach(draft, remaining, parentId, index);
  for (const selection of Object.values(draft.window.selection)) {
    if (selection.itemId === splitId) {
      selection.itemId = remaining;
      selection.focusedTabId = remaining;
    }
  }
  return remaining;
}

/**
 * Lists the top-level contents (tabs and splits) of a space in sidebar order: favorites, pinned
 * section (folder contents included), then today. Used to cycle with Ctrl+Tab.
 * @param state App state.
 * @param spaceId Space to list.
 * @returns Content ids in order.
 */
export function contentOrder(state: AppState, spaceId: ID): ID[] {
  const space = state.spaces[spaceId];
  if (!space) return [];
  const walk = (id: ID): ID[] => {
    const item = state.items[id];
    if (!item) return [];
    if (isTab(item) || isSplit(item)) return [id];
    return item.childrenIds.flatMap(walk);
  };
  return [state.favoritesId, space.pinnedId, space.todayId].flatMap(walk);
}

/**
 * Normalizes pane sizes so they are positive and sum to 1.
 * @param factors Raw factors.
 * @param count Expected number of panes.
 * @returns Normalized factors; equal shares when the input is unusable.
 */
export function normalizeFactors(factors: number[], count: number): number[] {
  const valid = factors.length === count && factors.every((f) => Number.isFinite(f) && f > 0);
  if (!valid) return Array.from({ length: count }, () => 1 / count);
  const total = factors.reduce((a, b) => a + b, 0);
  return factors.map((f) => f / total);
}
