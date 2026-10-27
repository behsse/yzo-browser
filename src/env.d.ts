import type { DetailedHTMLProps, HTMLAttributes } from "react";
import type { ShortcutAction } from "./lib/shortcuts";

/** On-screen rectangle of a tab view, in CSS pixels relative to the window content. */
export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Layout sent to the main process, which places one native view per loaded tab. */
export interface ViewSyncPayload {
  tabs: { id: string; url: string; bounds: ViewBounds | null }[];
  /** Hide the tab views (after screenshots) so HTML overlays can be drawn over the page area. */
  /** Stack the UI above the pages (overlay open): it then draws over them through transparent slots. */
  raised: boolean;
  peek: { url: string; bounds: ViewBounds | null } | null;
  /** Selected tab, reported to extensions as the active Chrome tab. */
  activeTabId: string | null;
}

export interface InstalledExtension {
  id: string;
  name: string;
  description: string;
  version: string;
  /** Largest icon up to 128px, as a data: URL. */
  icon: string | null;
  /** Turned on; off extensions stay installed but never run. */
  enabled: boolean;
  /** Runs in private windows too (from the next one opened). */
  privateAllowed: boolean;
  /** Extension options page, if it declares one (only while it is on). */
  optionsUrl: string | null;
  /** Its permission warnings in plain words, like Chrome's. */
  permissions: string[];
  /** Size of its files, in bytes. */
  size: number;
  /** Its Chrome Web Store page, for store installs. */
  storeUrl: string | null;
}

export type TabCommand = "back" | "forward" | "reload" | "load" | "devtools" | "focus" | "state" | "print" | "savePage" | "zoom";

export type TabEvent =
  | { tabId: string; type: "navigate" | "navigate-in-page"; url: string }
  | { tabId: string; type: "title"; title: string; url: string }
  | { tabId: string; type: "favicon"; favicon: string | null }
  /** Background color at the top of the page, "#rrggbb" (split pane bars take it). */
  | { tabId: string; type: "color"; color: string }
  | { tabId: string; type: "focus" }
  | { tabId: string; type: "attached"; webContentsId: number };

/** Result of an account IPC call: a value, or a stable error code for the UI. */
export type AccountResult<T> = { ok: true; value: T } | { ok: false; code: string };

export interface AccountStatus {
  signedIn: boolean;
  email: string | null;
  serverUrl: string;
  /** Whether the OS keychain is available to keep the session across restarts. */
  keychain: boolean;
}

export interface PushRecord {
  recordId: string;
  json: string | null;
  deleted: boolean;
  baseVersion: number;
}

export interface PushResponse {
  accepted: { recordId: string; version: number }[];
  conflicts: { recordId: string; version: number }[];
  cursor: number;
}

export interface PullResponse {
  records: { recordId: string; json: string | null; deleted: boolean; version: number }[];
  cursor: number;
  hasMore: boolean;
  /** Records that failed decryption/authentication and were skipped. */
  rejected: number;
}

export interface AccountBridge {
  status(): Promise<AccountResult<AccountStatus>>;
  signUp(serverUrl: string, email: string, password: string): Promise<AccountResult<{ email: string; recoveryKey: string }>>;
  signIn(serverUrl: string, email: string, password: string): Promise<AccountResult<{ email: string; recoveryKey: string | null }>>;
  signOut(): Promise<AccountResult<void>>;
  deleteAccount(): Promise<AccountResult<void>>;
  push(records: PushRecord[]): Promise<AccountResult<PushResponse>>;
  pull(since: number): Promise<AccountResult<PullResponse>>;
}

/** Serializable menu entry sent to the popup menu layer; the icon is an SVG path. */
export interface NativeMenuEntry {
  label: string;
  icon?: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Drawn as a zoom row (− value + and full screen) instead of a plain entry. */
  zoom?: { value: string; fullScreen?: boolean };
}

export interface YzoBridge {
  account: AccountBridge;
  loadState(): Promise<string | null>;
  saveState(json: string): Promise<boolean>;
  windowControl(action: "minimize" | "maximize" | "fullscreen" | "close"): void;
  /** Hands a press on the floating top bar to the system, which moves the window like from its title bar. */
  windowDrag(): void;
  /** Fires while the window is being moved. */
  onWindowMoved(callback: () => void): () => void;
  isMaximized(): Promise<boolean>;
  isFullScreen(): Promise<boolean>;
  /** Cursor position relative to the window content (DIPs), or null if unavailable. */
  cursorPosition(): Promise<{ x: number; y: number; width: number; height: number } | null>;
  /** Shows a popup menu above the pages; resolves to the picked entry index, or null when dismissed. */
  showMenu(entries: (NativeMenuEntry | "separator")[], x: number, y: number): Promise<number | null>;
  /** Finds the icon of a site without opening it; null when none was found. */
  resolveFavicon(url: string): Promise<string | null>;
  /** Reads Arc's data after a confirmation dialog; extensions install in the background. */
  importArc(): Promise<{ status: "notFound" | "cancelled" | "imported"; data?: import("./state/types").ArcImportData; extensions?: number } | null>;
  /** Starts a private instance of Yzo in its own process (electron/private-mode.cjs). */
  openPrivateWindow(): void;
  site: SiteBridge;
  downloads: DownloadsBridge;
  /** Yzo's version (package.json). */
  appVersion(): Promise<string>;
  /** Manual update check; "dev" outside packaged builds. */
  checkForUpdates(): Promise<{ status: "dev" | "upToDate" | "available" | "error"; version?: string } | null>;
  syncViews(payload: ViewSyncPayload): void;
  tabCommand(tabId: string, command: TabCommand, arg?: string): Promise<unknown>;
  onTabEvent(callback: (event: TabEvent) => void): () => void;
  onTabCreate(callback: (request: { id: string; url: string; active: boolean }) => void): () => void;
  onTabActivate(callback: (request: { id: string }) => void): () => void;
  onTabClose(callback: (request: { id: string }) => void): () => void;
  listExtensions(): Promise<InstalledExtension[]>;
  uninstallExtension(id: string): Promise<boolean>;
  /** Turns an installed extension on or off (kept across restarts). */
  setExtensionEnabled(id: string, enabled: boolean): Promise<boolean>;
  /** Lets an extension run in private windows, from the next one opened. */
  setExtensionPrivateAllowed(id: string, allowed: boolean): Promise<boolean>;
  onMaximized(callback: (maximized: boolean) => void): () => void;
  /** A button of an open menu's zoom row was pressed. */
  onMenuAction(callback: (event: { index: number; action: "out" | "in" | "fullscreen" }) => void): () => void;
  /** Shows a new value in the open menu's zoom row. */
  updateMenuZoom(index: number, value: string): void;
  /** Fires when the window enters or leaves full screen. */
  onFullScreen(callback: (fullScreen: boolean) => void): () => void;
  onShortcut(callback: (action: ShortcutAction) => void): () => void;
  onPeek(callback: (payload: { url: string }) => void): () => void;
  onOpenTab(callback: (payload: { url: string; background: boolean }) => void): () => void;
}

/** One download (electron/downloads.cjs). */
export interface DownloadEntry {
  id: string;
  url: string;
  filename: string;
  /** Where it is saved; empty while the save dialog is open. */
  path: string;
  mime: string;
  totalBytes: number;
  receivedBytes: number;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
  paused: boolean;
  startTime: number;
  endTime: number | null;
  /** File icon from the system, as a data: URL, once completed. */
  icon: string | null;
  /** Started since the app opened (listed in the downloads panel). */
  thisSession: boolean;
  /** False when a completed download's file was deleted or moved. */
  exists: boolean;
}

export type DownloadAction = "open" | "show" | "pause" | "resume" | "cancel" | "remove" | "trash" | "copyLink";

export interface DownloadSettings {
  directory: string;
  /** Ask where to save each file. */
  ask: boolean;
  /** Private window: shown but not changeable. */
  readOnly: boolean;
}

/** Downloads (electron/downloads.cjs). */
export interface DownloadsBridge {
  list(): Promise<DownloadEntry[]>;
  act(id: string, action: DownloadAction): Promise<boolean>;
  /** Forgets finished downloads; the files stay. */
  clear(): Promise<void>;
  getSettings(): Promise<DownloadSettings | null>;
  /** chooseDirectory opens a folder picker. */
  updateSettings(change: { ask?: boolean; chooseDirectory?: boolean }): Promise<DownloadSettings | null>;
  onChanged(callback: (entry: DownloadEntry) => void): () => void;
  /** A new download began (the panel opens). */
  onStarted(callback: (id: string) => void): () => void;
  onRemoved(callback: (id: string) => void): () => void;
  onCleared(callback: () => void): () => void;
}

/** What the site menu shows about the focused page. */
export interface SiteInfo {
  /** Ad and tracker shield: on for this site, requests blocked since the page loaded. */
  shield: { enabled: boolean; blocked: number };
  /** Loaded over https (an invalid certificate is refused, so https means a valid one). */
  secure: boolean;
  /** A certificate can be shown for the host. */
  certificate: boolean;
}

/** Site controls (electron/shield.cjs, electron/site-info.cjs). */
export interface SiteBridge {
  info(webContentsId: number, url: string): Promise<SiteInfo | null>;
  /** Turns the shield on or off for the page's site; reload the page to apply it. */
  setShield(url: string, enabled: boolean): Promise<boolean>;
  /** Opens the system's certificate window for a host; false when unavailable. */
  showCertificate(host: string): Promise<boolean>;
  /** Clears the site's cache or cookies. */
  clear(url: string, kind: "cache" | "cookies"): Promise<boolean>;
}

/** State of the extension actions, from electron-chrome-extensions' browser-action preload. */
export interface BrowserActionState {
  activeTabId?: number;
  actions: { id: string; title?: string }[];
}

declare global {
  /** Exposed by electron-chrome-extensions' browser-action preload (see scripts/build-preload.mjs). */
  type BrowserActionState = import("./env").BrowserActionState;
  interface Window {
    browserAction?: {
      addEventListener(name: "update", listener: (state: BrowserActionState) => void): void;
      removeEventListener(name: "update", listener: (state: BrowserActionState) => void): void;
      getState(partition: string): Promise<BrowserActionState>;
      addObserver(partition: string): void;
      removeObserver(partition: string): void;
    };
    /** Present inside Electron only (see electron/preload.cjs). */
    yzo?: YzoBridge;
  }
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      /** Extension action buttons, provided by electron-chrome-extensions (injected by the preload). */
      "browser-action-list": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        partition?: string;
        tab?: number;
        alignment?: string;
      };
    }
  }
}
