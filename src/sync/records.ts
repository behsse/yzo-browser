import type { PushRecord } from "../env";
import { t } from "../lib/i18n";
import { DEFAULT_THEME } from "../lib/theme";
import { attach, collapseSplitIfNeeded, detach, isContainer, isSplit, isTab, makeItem, uid } from "../state/tree";
import type { AppState, ContainerData, ID, ItemData, SidebarItem, Space, SpaceTheme, SyncMeta } from "../state/types";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "../state/types";

/**
 * Projection of the app state into sync records, change detection and merge of remote records
 * (docs/sync.md §4–5). Everything here is pure: the network and the crypto live elsewhere.
 *
 * Synced: spaces, their pinned section (tabs, folders, splits), favorites, space order, settings.
 * Not synced: "today" tabs, open-page state (current URL of loaded tabs, focus, last activity).
 */

/** Stand-in for the favorites container, whose local id differs on every device. */
export const FAVORITES_PARENT = "$favorites";
const DEFAULT_FAVORITE_URLS = new Set(["https://www.google.com/", "https://www.youtube.com/", "https://linear.app/"]);

/**
 * JSON with object keys sorted, so equal content always gives the same string (and hash).
 * @param value Any JSON-compatible value.
 * @returns Canonical JSON.
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + stableStringify(v)).join(",") + "}";
  }
  return JSON.stringify(value);
}

/**
 * Fast 64-bit FNV-1a hash used for change detection only (not security).
 * @param text Input.
 * @returns 16 hex characters.
 */
export function hashString(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/**
 * Synced part of an item's payload: volatile, per-device fields are left out.
 * @param data Local item data.
 * @returns Synced data.
 */
function syncedData(data: ItemData): Record<string, unknown> {
  switch (data.kind) {
    case "tab":
      return { kind: "tab", savedUrl: data.savedUrl, title: data.title, favicon: data.favicon };
    case "folder":
      return { kind: "folder", title: data.title, collapsed: data.collapsed };
    case "split":
      return { kind: "split", orientation: data.orientation, widthFactors: data.widthFactors };
    case "container":
      return { kind: "container", role: data.role, spaceId: data.spaceId };
  }
}

/**
 * Projects the synced part of the state into records (id → canonical JSON content).
 * @param state App state.
 * @returns Record contents by record id.
 */
export function projectRecords(state: AppState): Map<string, string> {
  const records = new Map<string, string>();
  const put = (id: string, content: unknown) => records.set(id, stableStringify(content));

  put("settings", { settings: state.settings, sidebarMode: state.window.sidebarMode, sidebarWidth: state.window.sidebarWidth });
  put("spaceOrder", { order: state.spaceOrder });
  put("favorites", { children: state.items[state.favoritesId]?.childrenIds ?? [] });

  const addItem = (id: ID) => {
    const item = state.items[id];
    if (!item) return;
    const parentId = item.parentId === state.favoritesId ? FAVORITES_PARENT : item.parentId;
    put("item:" + id, { parentId, childrenIds: item.childrenIds, createdAt: item.createdAt, data: syncedData(item.data) });
    item.childrenIds.forEach(addItem);
  };
  for (const spaceId of state.spaceOrder) {
    const space = state.spaces[spaceId];
    if (!space) continue;
    put("space:" + spaceId, { name: space.name, icon: space.icon, theme: space.theme, pinnedId: space.pinnedId });
    addItem(space.pinnedId);
  }
  state.items[state.favoritesId]?.childrenIds.forEach(addItem);
  return records;
}

export interface LocalChanges {
  records: PushRecord[];
  /** Content hash of each pushed record, to store once the server accepts it. */
  hashes: Record<string, string>;
}

/**
 * Lists records that differ from what was last synced: changed or new ones, and tombstones for
 * records that disappeared locally.
 * @param state App state.
 * @param meta Sync bookkeeping.
 * @returns Records to push with their base versions.
 */
export function collectChanges(state: AppState, meta: SyncMeta): LocalChanges {
  const records: PushRecord[] = [];
  const hashes: Record<string, string> = {};
  const projected = projectRecords(state);
  for (const [recordId, json] of projected) {
    const hash = hashString(json);
    const known = meta.records[recordId];
    if (known && !known.deleted && known.hash === hash) continue;
    records.push({ recordId, json, deleted: false, baseVersion: known?.version ?? 0 });
    hashes[recordId] = hash;
  }
  for (const [recordId, known] of Object.entries(meta.records)) {
    if (known.deleted || projected.has(recordId)) continue;
    records.push({ recordId, json: null, deleted: true, baseVersion: known.version });
    hashes[recordId] = "";
  }
  return { records, hashes };
}

/**
 * Updates the bookkeeping after a push: accepted records now match the server.
 * @param meta Sync bookkeeping.
 * @param changes What was pushed.
 * @param accepted Records the server accepted, with their new versions.
 * @returns New bookkeeping.
 */
export function markPushed(meta: SyncMeta, changes: LocalChanges, accepted: { recordId: string; version: number }[]): SyncMeta {
  const records = { ...meta.records };
  for (const { recordId, version } of accepted) {
    const pushed = changes.records.find((r) => r.recordId === recordId);
    if (pushed) records[recordId] = { hash: changes.hashes[recordId] ?? "", version, deleted: pushed.deleted };
  }
  return { ...meta, records };
}

export interface RemoteRecord {
  recordId: string;
  json: string | null;
  deleted: boolean;
  version: number;
}

/**
 * True when the local data is still the untouched first-launch setup, so signing in on this device
 * adopts the account's data instead of merging a duplicate default space into it.
 * @param state App state.
 * @returns Whether the local sidebar is pristine.
 */
export function isPristine(state: AppState): boolean {
  if (state.spaceOrder.length !== 1) return false;
  const space = state.spaces[state.spaceOrder[0]];
  if (!space || (state.items[space.pinnedId]?.childrenIds.length ?? 0) > 0) return false;
  return (state.items[state.favoritesId]?.childrenIds ?? []).every((id) => {
    const item = state.items[id];
    return isTab(item) && DEFAULT_FAVORITE_URLS.has(item.data.savedUrl);
  });
}

/**
 * Merges pulled records into the state. A record changed locally since the last sync keeps the
 * local version (it is pushed right after, over the remote one); otherwise the remote version
 * replaces it. On a device's first sync with an account that already has spaces, a pristine local
 * setup is replaced by the account's data (today tabs are kept).
 * Must receive every pulled page at once: the repair pass removes items whose parent is missing,
 * which would wrongly drop a child whose parent arrives in a later page.
 * @param state Current state.
 * @param remote Decrypted records from the server.
 * @param now Current epoch ms.
 * @returns The merged state with updated bookkeeping (cursor not included).
 */
export function applyRemote(state: AppState, remote: RemoteRecord[], now: number): AppState {
  const draft = structuredClone(state);
  const meta = draft.sync;
  const firstSync = Object.keys(meta.records).length === 0;
  const adopt = firstSync && remote.some((r) => r.recordId.startsWith("space:") && !r.deleted) && isPristine(state);

  let keptToday: ID[] = [];
  if (adopt) keptToday = dropLocalSidebar(draft);

  const projected = projectRecords(draft);
  const toApply: { id: string; body: Record<string, unknown> | null }[] = [];
  for (const record of remote) {
    const known = meta.records[record.recordId];
    const local = projected.get(record.recordId);
    const localDirty = known ? (local === undefined ? !known.deleted : hashString(local) !== known.hash) : local !== undefined;
    if (localDirty && !adopt) {
      // Keep the local change; push it next with the remote version as base so it overwrites.
      meta.records[record.recordId] = { hash: known?.hash ?? "", version: record.version, deleted: known?.deleted ?? false };
      continue;
    }
    let body: Record<string, unknown> | null = null;
    if (!record.deleted && record.json) {
      try {
        body = JSON.parse(record.json);
      } catch {
        continue;
      }
    }
    toApply.push({ id: record.recordId, body });
    meta.records[record.recordId] = { hash: body ? hashString(stableStringify(body)) : "", version: record.version, deleted: record.deleted };
  }

  applyChanges(draft, toApply, now);
  ensureUsable(draft, now);
  // Re-attach the device's own today tabs before the repair pass, which drops parentless items.
  const today = draft.spaces[draft.spaceOrder[0]].todayId;
  for (const id of keptToday) if (draft.items[id]) attach(draft, id, today);
  repairTree(draft);
  ensureUsable(draft, now);
  return draft;
}

/**
 * Removes the local spaces, pinned items and favorites (pristine adoption), keeping today tabs aside.
 * @param draft Mutable state copy.
 * @returns Ids of the detached today items, to re-attach afterwards.
 */
function dropLocalSidebar(draft: AppState): ID[] {
  const kept: ID[] = [];
  for (const spaceId of draft.spaceOrder) {
    const space = draft.spaces[spaceId];
    for (const id of [...(draft.items[space.todayId]?.childrenIds ?? [])]) {
      detach(draft, id);
      kept.push(id);
    }
    removeTree(draft, space.todayId);
    removeTree(draft, space.pinnedId);
    delete draft.spaces[spaceId];
    delete draft.window.selection[spaceId];
  }
  draft.spaceOrder = [];
  for (const id of [...(draft.items[draft.favoritesId]?.childrenIds ?? [])]) removeTree(draft, id);
  return kept;
}

/**
 * Deletes an item and its subtree without archiving (sync-driven removal).
 * @param draft Mutable state copy.
 * @param id Subtree root.
 */
function removeTree(draft: AppState, id: ID): void {
  const item = draft.items[id];
  if (!item) return;
  detach(draft, id);
  for (const child of [...item.childrenIds]) {
    if (draft.items[child]) draft.items[child].parentId = null;
    removeTree(draft, child);
  }
  delete draft.items[id];
  draft.loadedTabIds = draft.loadedTabIds.filter((t) => t !== id);
}

/**
 * Writes remote records into the state: upserts first, tombstones next, then orders. The caller
 * runs repairTree() afterwards so concurrent edits can never leave a broken sidebar.
 * @param draft Mutable state copy.
 * @param changes Records to apply (body null = deleted).
 * @param now Current epoch ms.
 */
export function applyChanges(draft: AppState, changes: { id: string; body: Record<string, unknown> | null }[], now: number): void {
  const upserts = changes.filter((c) => c.body);
  const deletions = changes.filter((c) => !c.body);
  let spaceOrder: unknown = null;
  let favorites: unknown = null;

  // Spaces before items so pinned containers exist; items in any order (parents fixed by repair).
  for (const { id, body } of upserts.filter((c) => c.id.startsWith("space:"))) upsertSpace(draft, id.slice(6), body!, now);
  for (const { id, body } of upserts) {
    if (id.startsWith("item:")) upsertItem(draft, id.slice(5), body!, now);
    else if (id === "settings") applySettings(draft, body!);
    else if (id === "spaceOrder") spaceOrder = body!.order;
    else if (id === "favorites") favorites = body!.children;
  }
  for (const { id } of deletions) {
    if (id.startsWith("item:")) {
      const itemId = id.slice(5);
      if (draft.items[itemId] && !isContainer(draft.items[itemId])) removeTree(draft, itemId);
    } else if (id.startsWith("space:")) removeSpace(draft, id.slice(6));
  }
  if (Array.isArray(spaceOrder)) {
    const order = spaceOrder.filter((s): s is string => typeof s === "string" && Boolean(draft.spaces[s]));
    draft.spaceOrder = [...new Set([...order, ...draft.spaceOrder.filter((s) => !order.includes(s))])];
  }
  if (Array.isArray(favorites)) {
    const container = draft.items[draft.favoritesId];
    const ordered = favorites.filter((f): f is string => typeof f === "string");
    container.childrenIds = [...new Set([...ordered, ...container.childrenIds])];
  }
}

/**
 * Creates or updates a space from its record.
 * @param draft Mutable state copy.
 * @param spaceId Space id.
 * @param body Record content.
 * @param now Current epoch ms.
 */
function upsertSpace(draft: AppState, spaceId: ID, body: Record<string, unknown>, now: number): void {
  const pinnedId = typeof body.pinnedId === "string" ? body.pinnedId : null;
  if (!pinnedId) return;
  const theme = isTheme(body.theme) ? body.theme : DEFAULT_THEME;
  const existing = draft.spaces[spaceId];
  if (existing) {
    existing.name = typeof body.name === "string" && body.name.trim() ? body.name : existing.name;
    existing.icon = typeof body.icon === "string" && body.icon ? body.icon : existing.icon;
    existing.theme = theme;
    return;
  }
  if (!draft.items[pinnedId]) {
    const pinned = makeItem<ContainerData>({ kind: "container", role: "pinned", spaceId }, now);
    pinned.id = pinnedId;
    draft.items[pinnedId] = pinned;
  }
  // "Today" stays local: each device gets its own container for a synced space.
  const today = makeItem<ContainerData>({ kind: "container", role: "today", spaceId }, now);
  draft.items[today.id] = today;
  const space: Space = {
    id: spaceId,
    name: typeof body.name === "string" && body.name.trim() ? body.name : t("default.spaceFallback"),
    icon: typeof body.icon === "string" && body.icon ? body.icon : "🪐",
    theme,
    pinnedId,
    todayId: today.id,
  };
  draft.spaces[spaceId] = space;
  if (!draft.spaceOrder.includes(spaceId)) draft.spaceOrder.push(spaceId);
  draft.window.selection[spaceId] = { itemId: null, focusedTabId: null };
}

/**
 * Removes a space deleted on another device (never the last one).
 * @param draft Mutable state copy.
 * @param spaceId Space id.
 */
function removeSpace(draft: AppState, spaceId: ID): void {
  const space = draft.spaces[spaceId];
  if (!space || draft.spaceOrder.length <= 1) return;
  removeTree(draft, space.todayId);
  removeTree(draft, space.pinnedId);
  delete draft.spaces[spaceId];
  delete draft.window.selection[spaceId];
  draft.spaceOrder = draft.spaceOrder.filter((s) => s !== spaceId);
  if (draft.window.focusedSpaceId === spaceId) draft.window.focusedSpaceId = draft.spaceOrder[0];
}

/**
 * Creates or updates a pinned-side item from its record.
 * @param draft Mutable state copy.
 * @param itemId Item id.
 * @param body Record content.
 * @param now Current epoch ms.
 */
function upsertItem(draft: AppState, itemId: ID, body: Record<string, unknown>, now: number): void {
  const data = body.data as Record<string, unknown> | undefined;
  if (!data || typeof data.kind !== "string") return;
  const existing = draft.items[itemId];
  let next: ItemData | null = null;
  if (data.kind === "tab" && typeof data.savedUrl === "string") {
    const loaded = draft.loadedTabIds.includes(itemId);
    const previous = isTab(existing) ? existing.data : null;
    next = {
      kind: "tab",
      savedUrl: data.savedUrl,
      // A page already open keeps its current URL; otherwise it opens at the synced pinned URL.
      url: previous && loaded ? previous.url : data.savedUrl,
      title: typeof data.title === "string" ? data.title : "",
      favicon: typeof data.favicon === "string" ? data.favicon : null,
      lastActiveAt: previous?.lastActiveAt ?? now,
    };
  } else if (data.kind === "folder") {
    next = { kind: "folder", title: typeof data.title === "string" ? data.title : t("default.folderFallback"), collapsed: Boolean(data.collapsed) };
  } else if (data.kind === "split") {
    const previous = isSplit(existing) ? existing.data : null;
    next = {
      kind: "split",
      orientation: data.orientation === "vertical" ? "vertical" : "horizontal",
      widthFactors: Array.isArray(data.widthFactors) ? data.widthFactors.filter((f): f is number => typeof f === "number") : [],
      focusedChildId: previous?.focusedChildId ?? null,
      lastActiveAt: previous?.lastActiveAt ?? now,
    };
  } else if (data.kind === "container" && data.role === "pinned" && typeof data.spaceId === "string") {
    next = { kind: "container", role: "pinned", spaceId: data.spaceId };
  }
  if (!next) return;

  const rawParent = typeof body.parentId === "string" ? body.parentId : null;
  const parentId = rawParent === FAVORITES_PARENT ? draft.favoritesId : rawParent;
  const childrenIds = Array.isArray(body.childrenIds) ? body.childrenIds.filter((c): c is string => typeof c === "string") : [];
  const item: SidebarItem = existing
    ? { ...existing, data: next, parentId, childrenIds }
    : { id: itemId, parentId, childrenIds, createdAt: typeof body.createdAt === "number" ? body.createdAt : now, data: next };
  draft.items[itemId] = item;
}

/**
 * Applies synced settings with validation.
 * @param draft Mutable state copy.
 * @param body Record content.
 */
function applySettings(draft: AppState, body: Record<string, unknown>): void {
  const settings = body.settings as Partial<AppState["settings"]> | undefined;
  if (settings && typeof settings === "object") {
    if (["oneHour", "twelveHours", "twentyFourHours", "sevenDays", "thirtyDays", "never"].includes(settings.autoArchive as string)) {
      draft.settings.autoArchive = settings.autoArchive!;
    }
    if (["google", "duckduckgo", "bing"].includes(settings.searchEngine as string)) draft.settings.searchEngine = settings.searchEngine!;
  }
  if (body.sidebarMode === "anchored" || body.sidebarMode === "hidden") draft.window.sidebarMode = body.sidebarMode;
  if (typeof body.sidebarWidth === "number") {
    draft.window.sidebarWidth = Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, body.sidebarWidth)));
  }
}

/**
 * Validates a theme value from a record.
 * @param value Candidate theme.
 * @returns Whether it is a usable SpaceTheme.
 */
function isTheme(value: unknown): value is SpaceTheme {
  const theme = value as SpaceTheme | undefined;
  return (
    Boolean(theme) &&
    Array.isArray(theme!.colors) &&
    theme!.colors.length === 2 &&
    theme!.colors.every((c) => typeof c === "string" && /^#[0-9a-f]{3,8}$/i.test(c)) &&
    ["light", "dark", "auto"].includes(theme!.mode)
  );
}

/**
 * Makes the item tree consistent after merging: every child list only holds existing items that
 * point back to that parent (no duplicates), items pointing to a parent are listed in it, synced
 * orphans are removed, and splits with fewer than two panes are collapsed.
 * @param draft Mutable state copy.
 */
export function repairTree(draft: AppState): void {
  for (const item of Object.values(draft.items)) {
    if (!isContainer(item) && (item.parentId === null || !draft.items[item.parentId])) removeTree(draft, item.id);
  }
  for (const item of Object.values(draft.items)) {
    const seen = new Set<ID>();
    item.childrenIds = item.childrenIds.filter((c) => {
      if (seen.has(c) || !draft.items[c] || draft.items[c].parentId !== item.id) return false;
      seen.add(c);
      return true;
    });
  }
  for (const item of Object.values(draft.items)) {
    if (item.parentId && !draft.items[item.parentId].childrenIds.includes(item.id)) draft.items[item.parentId].childrenIds.push(item.id);
  }
  for (const item of Object.values(draft.items)) {
    if (isTab(draft.items[item.parentId ?? ""]) || (isTab(item) && item.childrenIds.length)) item.childrenIds = [];
  }
  for (const item of Object.values(draft.items)) {
    if (isSplit(item) && draft.items[item.id]) collapseSplitIfNeeded(draft, item.id);
  }
}

/**
 * Keeps the state usable after a merge: at least one space, a focused space, valid selections.
 * @param draft Mutable state copy.
 * @param now Current epoch ms.
 */
function ensureUsable(draft: AppState, now: number): void {
  if (!draft.spaceOrder.length) {
    upsertSpace(draft, uid(), { name: t("default.spaceName"), icon: "🪐", theme: DEFAULT_THEME, pinnedId: uid() }, now);
  }
  if (!draft.spaces[draft.window.focusedSpaceId]) draft.window.focusedSpaceId = draft.spaceOrder[0];
  for (const [spaceId, selection] of Object.entries(draft.window.selection)) {
    if (!draft.spaces[spaceId]) delete draft.window.selection[spaceId];
    else if (selection.itemId && !draft.items[selection.itemId]) draft.window.selection[spaceId] = { itemId: null, focusedTabId: null };
    else if (selection.focusedTabId && !draft.items[selection.focusedTabId]) selection.focusedTabId = selection.itemId;
  }
  draft.loadedTabIds = draft.loadedTabIds.filter((id) => isTab(draft.items[id]));
}
