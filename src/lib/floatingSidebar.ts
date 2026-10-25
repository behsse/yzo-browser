export interface CursorPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Decides whether the floating sidebar should stay open for a cursor position. The hover zone is
 * the left column below the top bar; leaving the window by the bottom or left keeps it open, while
 * going up into the top bar (or above the window) or right, onto the page, closes it.
 * @param cursor Cursor position relative to the window content.
 * @param zoneWidth Width of the left hover column in pixels.
 * @param topBarHeight Height of the top bar in pixels, which is not part of the zone.
 * @returns "keep" to stay open, "hide" to start the close delay.
 */
export function floatingSidebarDecision(cursor: CursorPosition, zoneWidth: number, topBarHeight: number): "keep" | "hide" {
  if (cursor.y < topBarHeight) return "hide";
  if (cursor.x < zoneWidth) return "keep";
  if (cursor.x >= cursor.width) return "hide";
  const insideVertically = cursor.y >= 0 && cursor.y < cursor.height;
  return insideVertically ? "hide" : "keep";
}
