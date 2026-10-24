import { createContext, useContext } from "react";
import type { ShortcutAction } from "../lib/shortcuts";
import type { ID } from "../state/types";

export type CommandBarMode = "new" | "current" | "split";

export interface MenuEntry {
  label: string;
  hint?: string;
  danger?: boolean;
  /** Informational entry: shown greyed out and not clickable. */
  disabled?: boolean;
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
  openAccount(): void;
  openSpaceEditor(spaceId: ID | "new"): void;
  openMenu(menu: MenuState): void;
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
