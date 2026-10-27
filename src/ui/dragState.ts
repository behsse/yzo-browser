import { useSyncExternalStore } from "react";
import type { ID } from "../state/types";

// The sidebar item being dragged, shared with the page area: while a tab is dragged, the UI is raised
// above the pages so they can show where it would split (pages are native views that would otherwise
// receive the drag).

let dragged: ID | null = null;
const listeners = new Set<() => void>();

/**
 * Sets (or clears, with null) the sidebar item being dragged.
 * @param id Dragged item id.
 */
export function setSidebarDrag(id: ID | null): void {
  if (dragged === id) return;
  dragged = id;
  for (const listener of listeners) listener();
}

/**
 * Reads the sidebar item being dragged, outside React.
 * @returns Item id, or null.
 */
export function getSidebarDrag(): ID | null {
  return dragged;
}

/**
 * Follows the sidebar item being dragged.
 * @returns Item id, or null when nothing is dragged.
 */
export function useSidebarDrag(): ID | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => dragged,
  );
}
