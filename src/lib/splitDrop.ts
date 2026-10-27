import type { SplitOrientation } from "../state/types";

/** Side of a page a dragged tab is dropped on. */
export type DropSide = "left" | "right" | "top" | "bottom";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Side of a page the pointer is closest to. On a single page, any side splits it (left/right side by
 * side, top/bottom stacked); in a split, only the sides along its orientation insert a pane.
 * @param x Pointer x.
 * @param y Pointer y.
 * @param rect Page rectangle.
 * @param along Orientation of the split the page is in, if any.
 * @returns Drop side.
 */
export function dropSide(x: number, y: number, rect: Rect, along?: SplitOrientation): DropSide {
  const dx = (x - (rect.left + rect.width / 2)) / rect.width;
  const dy = (y - (rect.top + rect.height / 2)) / rect.height;
  const horizontal = along ? along === "horizontal" : Math.abs(dx) >= Math.abs(dy);
  if (horizontal) return dx < 0 ? "left" : "right";
  return dy < 0 ? "top" : "bottom";
}

/**
 * Where a tab dropped on a pane's side goes: its index among the panes and the split's orientation.
 * @param side Drop side.
 * @param paneIndex Index of the pane dropped on.
 * @returns Pane index and orientation.
 */
export function dropPlacement(side: DropSide, paneIndex: number): { index: number; orientation: SplitOrientation } {
  return {
    index: side === "left" || side === "top" ? paneIndex : paneIndex + 1,
    orientation: side === "left" || side === "right" ? "horizontal" : "vertical",
  };
}

/**
 * Half of a page highlighted while a tab is dragged over one of its sides.
 * @param side Drop side.
 * @param rect Page rectangle.
 * @returns Highlighted rectangle.
 */
export function dropPreview(side: DropSide, rect: Rect): Rect {
  const halfWidth = rect.width / 2;
  const halfHeight = rect.height / 2;
  if (side === "left") return { ...rect, width: halfWidth };
  if (side === "right") return { ...rect, left: rect.left + halfWidth, width: halfWidth };
  if (side === "top") return { ...rect, height: halfHeight };
  return { ...rect, top: rect.top + halfHeight, height: halfHeight };
}
