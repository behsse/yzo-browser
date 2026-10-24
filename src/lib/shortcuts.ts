import bindings from "../../shared/shortcuts.json";

/**
 * Keyboard shortcuts. The table in shared/shortcuts.json is the single source of truth: the
 * renderer matches it on its own keydown events, and the main process matches it on tab page input
 * so shortcuts keep working while a web page has focus (Arc filters Chromium shortcuts the same way).
 */

export type ShortcutAction =
  | "newTab"
  | "openLocation"
  | "closeTab"
  | "reopenClosed"
  | "togglePin"
  | "toggleSidebar"
  | "addSplit"
  | "reload"
  | "back"
  | "forward"
  | "nextTab"
  | "previousTab"
  | "copyUrl"
  | "clearToday"
  | "newFolder"
  | "openArchive"
  | "devTools"
  | `switchSpace${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;

export interface ShortcutBinding {
  action: ShortcutAction;
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface KeyInput {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export const SHORTCUTS = bindings as ShortcutBinding[];

/**
 * Finds the action bound to a key press. Letters compare case-insensitively because Shift changes
 * the reported key; every modifier must match exactly so Ctrl+T and Ctrl+Shift+T stay distinct.
 * @param input Pressed key and modifier state.
 * @param table Binding table to search.
 * @returns The bound action, or null.
 */
export function matchShortcut(input: KeyInput, table: ShortcutBinding[] = SHORTCUTS): ShortcutAction | null {
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  const found = table.find(
    (b) =>
      b.key === key &&
      Boolean(b.ctrl) === input.ctrl &&
      Boolean(b.shift) === input.shift &&
      Boolean(b.alt) === input.alt,
  );
  return found ? found.action : null;
}

/**
 * Formats a binding for display in menus and tooltips, e.g. "Ctrl+Shift+T".
 * @param action Action to describe.
 * @returns Human-readable shortcut, or an empty string when the action has no binding.
 */
export function shortcutLabel(action: ShortcutAction): string {
  const b = SHORTCUTS.find((s) => s.action === action);
  if (!b) return "";
  const key = b.key.length === 1 ? b.key.toUpperCase() : b.key.replace("Arrow", "");
  return [b.ctrl && "Ctrl", b.alt && "Alt", b.shift && "Shift", key].filter(Boolean).join("+");
}
