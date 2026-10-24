export interface CursorPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Decides whether the floating sidebar should stay open for a cursor position. The hover zone is
 * the whole left column; leaving the window by the top, bottom or left keeps it open, and only going
 * right — onto the page or out of the window on that side — closes it.
 * @param cursor Cursor position relative to the window content.
 * @param zoneWidth Width of the left hover column in pixels.
 * @returns "keep" to stay open, "hide" to start the close delay.
 */
export function floatingSidebarDecision(cursor: CursorPosition, zoneWidth: number): "keep" | "hide" {
  if (cursor.x < zoneWidth) return "keep";
  if (cursor.x >= cursor.width) return "hide";
  const insideVertically = cursor.y >= 0 && cursor.y < cursor.height;
  return insideVertically ? "hide" : "keep";
}
