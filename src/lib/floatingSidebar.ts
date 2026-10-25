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
/**
 * Decides whether the floating top bar stays open: the cursor must stay on the bar (a little margin
 * below it included) or above the window.
 * @param cursor Cursor position relative to the window content.
 * @param barHeight Height of the top bar in pixels.
 * @returns "keep" to stay open, "hide" to start the close delay.
 */
export function floatingTopBarDecision(cursor: CursorPosition, barHeight: number): "keep" | "hide" {
  const insideHorizontally = cursor.x >= 0 && cursor.x < cursor.width;
  return insideHorizontally && cursor.y < barHeight + TOP_BAR_MARGIN_PX ? "keep" : "hide";
}

/**
 * Whether the cursor is on the top edge of the window, which reveals the hidden top bar. Polled, since
 * the edge is mostly covered by the window resize border and the pages, which hide it from the UI.
 * @param cursor Cursor position relative to the window content.
 * @param edgeHeight Height of the edge in pixels.
 * @returns True on the edge.
 */
export function cursorOnTopEdge(cursor: CursorPosition, edgeHeight: number): boolean {
  return cursor.x >= 0 && cursor.x < cursor.width && cursor.y >= 0 && cursor.y < edgeHeight;
}

/** Extra height under the floating top bar that still counts as hovering it. */
const TOP_BAR_MARGIN_PX = 8;

export function floatingSidebarDecision(cursor: CursorPosition, zoneWidth: number, topBarHeight: number): "keep" | "hide" {
  // Hidden top bar: leaving the window by the top keeps the sidebar open, as before the top bar.
  if (topBarHeight === 0 && cursor.y < 0) return cursor.x < zoneWidth ? "keep" : "hide";
  if (cursor.y < topBarHeight) return "hide";
  if (cursor.x < zoneWidth) return "keep";
  if (cursor.x >= cursor.width) return "hide";
  const insideVertically = cursor.y >= 0 && cursor.y < cursor.height;
  return insideVertically ? "hide" : "keep";
}
