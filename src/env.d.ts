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
  frozen: boolean;
  peek: { url: string; bounds: ViewBounds | null } | null;
  /** Selected tab, reported to extensions as the active Chrome tab. */
  activeTabId: string | null;
}

export interface InstalledExtension {
  id: string;
  name: string;
  version: string;
  /** Extension options page, if it declares one. */
  optionsUrl: string | null;
}

export type TabCommand = "back" | "forward" | "reload" | "load" | "devtools" | "focus" | "state";

export type TabEvent =
  | { tabId: string; type: "navigate" | "navigate-in-page"; url: string }
  | { tabId: string; type: "title"; title: string; url: string }
  | { tabId: string; type: "favicon"; favicon: string | null }
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

export interface YzoBridge {
  account: AccountBridge;
  loadState(): Promise<string | null>;
  saveState(json: string): Promise<boolean>;
  windowControl(action: "minimize" | "maximize" | "close"): void;
  isMaximized(): Promise<boolean>;
  /** Cursor position relative to the window content (DIPs), or null if unavailable. */
  cursorPosition(): Promise<{ x: number; y: number; width: number; height: number } | null>;
  syncViews(payload: ViewSyncPayload): void;
  ackSnapshots(token: number): void;
  tabCommand(tabId: string, command: TabCommand, arg?: string): Promise<unknown>;
  onSnapshots(callback: (payload: { token: number; shots: Record<string, string> }) => void): () => void;
  onTabEvent(callback: (event: TabEvent) => void): () => void;
  onTabCreate(callback: (request: { id: string; url: string; active: boolean }) => void): () => void;
  onTabActivate(callback: (request: { id: string }) => void): () => void;
  onTabClose(callback: (request: { id: string }) => void): () => void;
  listExtensions(): Promise<InstalledExtension[]>;
  uninstallExtension(id: string): Promise<boolean>;
  onMaximized(callback: (maximized: boolean) => void): () => void;
  onShortcut(callback: (action: ShortcutAction) => void): () => void;
  onPeek(callback: (payload: { url: string }) => void): () => void;
  onOpenTab(callback: (payload: { url: string; background: boolean }) => void): () => void;
}

declare global {
  interface Window {
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
