/**
 * Domain model of the browser.
 *
 * Mirrors the shape observed in Arc's StorableSidebar.json (see re/ARC-REVERSE-ENGINEERING.md §3):
 * every sidebar node lives in one flat item table linked by parentId/childrenIds, and spaces
 * own a pinned and a "today" (unpinned) container. Favorites are one global container.
 */

export type ID = string;

export type ContainerRole = "pinned" | "today" | "favorites";

export interface ContainerData {
  kind: "container";
  role: ContainerRole;
  spaceId: ID | null;
}

export interface TabData {
  kind: "tab";
  url: string;
  title: string;
  favicon: string | null;
  /** URL restored when a pinned tab is reset (Arc's savedURL). */
  savedUrl: string;
  lastActiveAt: number;
}

export interface FolderData {
  kind: "folder";
  title: string;
  collapsed: boolean;
}

export type SplitOrientation = "horizontal" | "vertical";

export interface SplitData {
  kind: "split";
  orientation: SplitOrientation;
  /** Relative size of each child pane; same length as childrenIds, sums to 1. */
  widthFactors: number[];
  focusedChildId: ID | null;
  lastActiveAt: number;
}

export type ItemData = ContainerData | TabData | FolderData | SplitData;

export interface SidebarItem<D extends ItemData = ItemData> {
  id: ID;
  parentId: ID | null;
  childrenIds: ID[];
  createdAt: number;
  data: D;
}

export type ThemeMode = "light" | "dark" | "auto";

export interface SpaceTheme {
  /** Two hex colors forming the sidebar gradient. */
  colors: [string, string];
  mode: ThemeMode;
}

export interface Space {
  id: ID;
  name: string;
  icon: string;
  theme: SpaceTheme;
  pinnedId: ID;
  todayId: ID;
}

/** Thresholds observed in Arc's AutoArchiveInactiveThreshold enum. */
export type AutoArchiveThreshold =
  | "oneHour"
  | "twelveHours"
  | "twentyFourHours"
  | "sevenDays"
  | "thirtyDays"
  | "never";

export type ArchiveReason = "manual" | "auto" | "spaceDeleted";

export interface ArchiveEntry {
  id: ID;
  title: string;
  url: string;
  favicon: string | null;
  spaceId: ID;
  reason: ArchiveReason;
  archivedAt: number;
}

export interface HistoryEntry {
  url: string;
  title: string;
  lastVisitAt: number;
  visitCount: number;
}

/** Sidebar modes observed in Arc (anchored / floating / hidden); floating is the hover reveal of hidden. */
export type SidebarMode = "anchored" | "hidden";

export type SearchEngine = "google" | "duckduckgo" | "bing";

export type SuggestionKind = "tab" | "history" | "url" | "search";

export interface SpaceSelection {
  /** Active top-level content: a tab or a split view. */
  itemId: ID | null;
  /** Tab receiving navigation commands (a child of the split when a split is active). */
  focusedTabId: ID | null;
}

export interface WindowState {
  focusedSpaceId: ID;
  selection: Record<ID, SpaceSelection>;
  sidebarMode: SidebarMode;
  sidebarWidth: number;
  /** Top bar shown above the pages, or hidden and revealed on hover of the top edge (absent = anchored). */
  topBarMode?: SidebarMode;
}

/** Data read from Arc by "Import from Arc" (electron/arc-import.cjs). */
export type ArcImportTab = { kind: "tab"; url: string; title: string; favicon?: string };
export type ArcImportNode =
  | ArcImportTab
  | { kind: "folder"; title: string; children: ArcImportNode[] }
  | { kind: "split"; orientation: SplitOrientation; factors: number[]; children: ArcImportTab[] };
export interface ArcImportData {
  spaces: { name: string | null; icon: string | null; pinned: ArcImportNode[]; today: ArcImportNode[] }[];
  favorites: ArcImportTab[];
}

export interface Settings {
  autoArchive: AutoArchiveThreshold;
  searchEngine: SearchEngine;
  /** Extension ids whose action is shown in the top bar, in order (absent on older profiles). */
  pinnedExtensions?: string[];
}

/** Sync bookkeeping for one record: what was last exchanged with the server. */
export interface SyncRecordMeta {
  /** Hash of the record content last pushed or pulled. */
  hash: string;
  /** Server version of that content (0 = never stored). */
  version: number;
  deleted: boolean;
}

export interface SyncMeta {
  /** Last server version pulled. */
  cursor: number;
  records: Record<string, SyncRecordMeta>;
  /** Account the bookkeeping belongs to; reset when another account signs in. */
  email: string | null;
  lastSyncAt: number | null;
}

export interface AppState {
  version: 1;
  items: Record<ID, SidebarItem>;
  spaceOrder: ID[];
  spaces: Record<ID, Space>;
  favoritesId: ID;
  window: WindowState;
  archive: ArchiveEntry[];
  history: HistoryEntry[];
  /** Per-query memory of the suggestion kind the user picked (Arc's queriesToSelectedArchetype). */
  commandMemory: Record<string, SuggestionKind>;
  settings: Settings;
  sync: SyncMeta;
  /** Tabs with a live page (native view) this session. Never persisted. */
  loadedTabIds: ID[];
}

export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_DEFAULT_WIDTH = 240;
export const HISTORY_LIMIT = 1000;
export const ARCHIVE_LIMIT = 500;
