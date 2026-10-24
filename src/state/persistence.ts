import type { AppState } from "./types";

/**
 * Serializes the state for disk, dropping session-only data (live tab pages).
 * @param state App state.
 * @returns JSON string.
 */
export function serializeState(state: AppState): string {
  const { loadedTabIds: _loaded, ...persisted } = state;
  return JSON.stringify(persisted);
}

/**
 * Parses and validates a persisted state. Anything malformed — wrong version, missing containers,
 * dangling parent links — is rejected so a corrupt file falls back to a fresh state instead of
 * crashing the UI.
 * @param json Raw file content.
 * @returns A usable state, or null when the content cannot be trusted.
 */
export function parseState(json: string | null): AppState | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<AppState>;
  if (s.version !== 1 || !s.items || !s.spaces || !Array.isArray(s.spaceOrder) || !s.window || !s.settings) return null;
  if (!Array.isArray(s.archive) || !Array.isArray(s.history) || typeof s.favoritesId !== "string") return null;
  if (!s.spaceOrder.length || !s.items[s.favoritesId]) return null;
  for (const id of s.spaceOrder) {
    const space = s.spaces[id];
    if (!space || !s.items[space.pinnedId] || !s.items[space.todayId]) return null;
  }
  const items = s.items;
  for (const item of Object.values(items)) {
    if (!item || typeof item.id !== "string" || !Array.isArray(item.childrenIds) || !item.data) return null;
    if (item.parentId !== null && !items[item.parentId]) return null;
    if (item.childrenIds.some((child) => !items[child])) return null;
  }
  const focused = s.spaces[s.window.focusedSpaceId] ? s.window.focusedSpaceId : s.spaceOrder[0];
  return {
    ...(s as AppState),
    commandMemory: s.commandMemory ?? {},
    sync: s.sync ?? { cursor: 0, records: {}, email: null, lastSyncAt: null },
    window: { ...s.window, focusedSpaceId: focused, selection: s.window.selection ?? {} },
    loadedTabIds: [],
  };
}
