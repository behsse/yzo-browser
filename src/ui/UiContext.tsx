import { createContext, useContext } from "react";
import type { ShortcutAction } from "../lib/shortcuts";
import type { IconName } from "./Icon";
import type { ID } from "../state/types";

/** "splitBefore" / "splitAfter" open the result as a new pane on that side of the focused one. */
export type CommandBarMode = "new" | "current" | "split" | "splitBefore" | "splitAfter";
export type AccountMode = "signIn" | "signUp";

export interface MenuEntry {
  label: string;
  /** Leading icon; menus that use icons give one to every entry so labels stay aligned. */
  icon?: IconName;
  hint?: string;
  danger?: boolean;
  /** Informational entry: shown greyed out and not clickable. */
  disabled?: boolean;
  /**
   * Zoom row (− value + and full screen) instead of a plain entry. Its buttons keep the menu open
   * (except full screen); onAction returns the value to show next, if it changed.
   */
  zoom?: { value: string; fullScreen?: boolean; onAction(action: "out" | "in" | "fullscreen"): Promise<string | null> };
  onSelect: () => void;
}

export interface MenuState {
  x: number;
  y: number;
  entries: (MenuEntry | "separator")[];
}

/** Transient UI state shared by the overlays; never persisted. */
export interface UiValue {
  openCommandBar(mode: CommandBarMode): void;
  openPeek(url: string): void;
  openArchive(): void;
  /** Opens the account panel, on the sign-in or sign-up form when signed out. */
  openAccount(mode?: AccountMode): void;
  openSpaceEditor(spaceId: ID | "new"): void;
  openMenu(menu: MenuState): void;
  /** Opens the extensions panel under the puzzle button (its bottom-right corner). */
  openExtensions(anchor: { right: number; bottom: number }): void;
  /** Opens the site panel under the sliders next to the address (their bottom-left corner). */
  openSitePanel(anchor: { left: number; bottom: number }): void;
  /** Opens the downloads panel under the download button (its bottom-right corner). */
  openDownloads(anchor: { right: number; bottom: number }): void;
  showToast(message: string): void;
  runAction(action: ShortcutAction): void;
}

export const UiContext = createContext<UiValue | null>(null);

/**
 * Reads the UI controller provided by App.
 * @returns Overlay openers and the shortcut action runner.
 */
export function useUi(): UiValue {
  const value = useContext(UiContext);
  if (!value) throw new Error("useUi must be used inside UiContext");
  return value;
}
