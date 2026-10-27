import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { t } from "../lib/i18n";
import { isInternalUrl } from "../lib/internalPages";
import { dropPlacement, dropPreview, dropSide, type DropSide, type Rect } from "../lib/splitDrop";
import { shortcutLabel } from "../lib/shortcuts";
import { useStore } from "../state/store";
import { isSplit, isTab } from "../state/tree";
import type { ID } from "../state/types";
import { InternalPage } from "./InternalPage";
import { useSidebarDrag, setSidebarDrag } from "./dragState";
import { PaneBar, paneBarColors } from "./PaneBar";
import { useViewHost } from "./ViewHost";

interface PaneLayout {
  style: CSSProperties;
  focused: boolean;
}

const GAP_PX = 6;
/** Duration of the panes sliding to a new order (.web-area-animated in styles.css). */
const PANE_SLIDE_MS = 220;

/**
 * Pane sizes as shares adding up to 1, one per pane (equal shares when the stored ones do not fit).
 * @param factors Stored shares.
 * @param count Number of panes.
 * @returns Shares.
 */
function normalizePaneFactors(factors: number[], count: number): number[] {
  const valid = factors.length === count && factors.every((f) => Number.isFinite(f) && f > 0);
  if (!valid) return Array.from({ length: count }, () => 1 / count);
  const total = factors.reduce((a, b) => a + b, 0);
  return factors.map((f) => f / total);
}

/**
 * Computes the on-screen rectangle of each visible tab: the whole area for a single tab, or one
 * slice per pane for a split view, sized by its width factors.
 * @param ids Visible tab ids in order.
 * @param factors Relative sizes (sum 1).
 * @param vertical Stack panes top-to-bottom instead of side by side.
 * @param focusedId Tab receiving commands.
 * @returns Layout per tab id.
 */
function layoutPanes(ids: ID[], factors: number[], vertical: boolean, focusedId: ID | null): Map<ID, PaneLayout> {
  const layout = new Map<ID, PaneLayout>();
  let offset = 0;
  ids.forEach((id, i) => {
    const share = factors[i] ?? 1 / ids.length;
    const start = `calc(${offset * 100}% + ${i ? GAP_PX / 2 : 0}px)`;
    const size = `calc(${share * 100}% - ${ids.length > 1 ? (i === 0 || i === ids.length - 1 ? GAP_PX / 2 : GAP_PX) : 0}px)`;
    const style: CSSProperties = vertical
      ? { left: 0, right: 0, top: start, height: size }
      : { top: 0, bottom: 0, left: start, width: size };
    layout.set(id, { style, focused: ids.length > 1 && id === focusedId });
    offset += share;
  });
  return layout;
}

/**
 * Top color of each loaded page, as the main process reads it (split pane bars take it).
 * @returns Colors by tab id.
 */
function usePageColors(): Record<ID, string> {
  const [colors, setColors] = useState<Record<ID, string>>({});
  useEffect(() => {
    return window.yzo?.onTabEvent((event) => {
      if (event.type === "color") setColors((all) => (all[event.tabId] === event.color ? all : { ...all, [event.tabId]: event.color }));
    });
  }, []);
  return colors;
}

/**
 * Content area: lays out one slot per visible tab (the native page view is placed over it by the
 * main process) and provides the draggable split dividers. In a split, each pane has its own bar in
 * the site's color, like Arc (navigation, address, split actions; drag it to move the pane). A tab dragged from the sidebar splits the
 * page it is dropped on, on the side it is dropped (like Zen).
 * @returns Content element.
 */
export function WebArea() {
  const { state, dispatch } = useStore();
  const host = useViewHost();
  const areaRef = useRef<HTMLDivElement>(null);
  const selection = state.window.selection[state.window.focusedSpaceId];
  const content = selection?.itemId ? state.items[selection.itemId] : undefined;

  let visible: ID[] = [];
  let factors: number[] = [1];
  let vertical = false;
  if (isTab(content)) visible = [content.id];
  if (isSplit(content)) {
    visible = content.childrenIds.filter((id) => isTab(state.items[id]));
    factors = content.data.widthFactors;
    vertical = content.data.orientation === "vertical";
  }
  const [reorder, setReorder] = useState<{ id: ID; to: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  // While a pane is moved with its grip, the others make room live: show the order it would give.
  if (reorder && visible.includes(reorder.id)) {
    const from = visible.indexOf(reorder.id);
    const order = [...visible];
    const moved = [...normalizePaneFactors(factors, visible.length)];
    order.splice(from, 1);
    order.splice(reorder.to, 0, reorder.id);
    const [factor] = moved.splice(from, 1);
    moved.splice(reorder.to, 0, factor);
    visible = order;
    factors = moved;
  }
  const layout = layoutPanes(visible, factors, vertical, selection?.focusedTabId ?? null);

  // Panes slide to a new order: the pages follow their slots every frame during the transition.
  const orderKey = visible.join(",");
  const lastOrder = useRef(orderKey);
  useLayoutEffect(() => {
    if (lastOrder.current !== orderKey && lastOrder.current.split(",").sort().join() === orderKey.split(",").sort().join()) {
      host.followAnimation(PANE_SLIDE_MS + 60);
    }
    lastOrder.current = orderKey;
  }, [orderKey, host]);

  // Pages are native views that swallow the pointer, so dividers raise the UI above them while
  // dragging and end the drag on release (or as soon as no button is pressed anymore).
  const startDrag = (index: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isSplit(content) || !areaRef.current) return;
    event.preventDefault();
    const rect = areaRef.current.getBoundingClientRect();
    host.setDragging(true);
    setResizing(true);
    const move = (e: PointerEvent) => {
      if (e.buttons === 0) return up();
      const position = vertical ? (e.clientY - rect.top) / rect.height : (e.clientX - rect.left) / rect.width;
      const before = factors.slice(0, index).reduce((a, b) => a + b, 0);
      const pair = factors[index] + factors[index + 1];
      const left = Math.min(pair - 0.1, Math.max(0.1, position - before));
      const next = [...factors];
      next[index] = left;
      next[index + 1] = pair - left;
      dispatch({ type: "setSplitFactors", id: content.id, factors: next });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      host.setDragging(false);
      setResizing(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const split = isSplit(content) ? content : null;
  const draggedTab = useSidebarDrag();
  const tabDragged = draggedTab !== null && isTab(state.items[draggedTab]);
  const [dropTarget, setDropTarget] = useState<{ paneId: ID | null; side: DropSide | null; rect: Rect } | null>(null);
  const frames = useRef(new Map<ID, HTMLElement>());
  const colors = usePageColors();

  // A tab dragged from the sidebar: the UI goes above the pages so they can show where it would land.
  useEffect(() => {
    if (!tabDragged) return setDropTarget(null);
    host.setDragging(true);
    return () => host.setDragging(false);
  }, [tabDragged]);

  /**
   * Rectangle of a pane, relative to the page area.
   * @param id Pane tab id.
   * @returns Rectangle, or null when the pane is not on screen.
   */
  const paneRect = (id: ID): Rect | null => {
    const frame = frames.current.get(id)?.getBoundingClientRect();
    const area = areaRef.current?.getBoundingClientRect();
    return frame && area ? { left: frame.left - area.left, top: frame.top - area.top, width: frame.width, height: frame.height } : null;
  };

  /**
   * Pane under the pointer, if any.
   * @param x Pointer x in the window.
   * @param y Pointer y in the window.
   * @returns Pane id and its index, or null.
   */
  const paneAt = (x: number, y: number): { id: ID; index: number } | null => {
    for (const [index, id] of visible.entries()) {
      const r = frames.current.get(id)?.getBoundingClientRect();
      if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { id, index };
    }
    return null;
  };

  const onDropOver = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const area = areaRef.current?.getBoundingClientRect();
    if (!area || !draggedTab) return;
    // Nothing shown: the tab simply opens.
    if (!visible.length) return setDropTarget({ paneId: null, side: null, rect: { left: 0, top: 0, width: area.width, height: area.height } });
    const pane = paneAt(event.clientX, event.clientY);
    const rect = pane && paneRect(pane.id);
    // Dropping the page shown alone onto itself does nothing.
    if (!pane || !rect || (!split && pane.id === draggedTab)) return setDropTarget(null);
    const side = dropSide(event.clientX - area.left, event.clientY - area.top, rect, split?.data.orientation);
    setDropTarget({ paneId: pane.id, side, rect: dropPreview(side, rect) });
  };

  const onDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const target = dropTarget;
    const dragged = draggedTab;
    setDropTarget(null);
    setSidebarDrag(null);
    if (!target || !dragged) return;
    if (!target.paneId || !target.side) return dispatch({ type: "activate", id: dragged, now: Date.now() });
    const { index, orientation } = dropPlacement(target.side, visible.indexOf(target.paneId));
    dispatch({ type: "splitWithTab", tabId: target.paneId, otherTabId: dragged, index, orientation, now: Date.now() });
  };

  // The grip of a pane's bar moves it among the panes, the others making room as it goes; the UI is
  // raised so the pointer is seen over the pages.
  const startReorder = (id: ID) => (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    const area = areaRef.current?.getBoundingClientRect();
    if (!area || !split) return;
    const count = visible.length;
    const original = split.childrenIds.filter((child) => isTab(state.items[child]));
    const baseFactors = normalizePaneFactors(split.data.widthFactors, original.length);
    const from = original.indexOf(id);
    host.setDragging(true);
    let to = from;
    setReorder({ id, to });
    const move = (e: PointerEvent) => {
      if (e.buttons === 0) return up();
      // The pane goes where the pointer is along the split, measured on the layout without it moved.
      const position = vertical ? (e.clientY - area.top) / area.height : (e.clientX - area.left) / area.width;
      let edge = 0;
      let next = count - 1;
      for (let i = 0; i < count; i++) {
        edge += baseFactors[i];
        if (position < edge) {
          next = i;
          break;
        }
      }
      if (next !== to) {
        to = next;
        setReorder({ id, to });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      host.setDragging(false);
      setReorder(null);
      if (to !== from) dispatch({ type: "moveSplitPane", id, index: to });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <main
      className={"web-area" + (split && !resizing ? " web-area-animated" : "")}
      ref={areaRef}
    >
      {visible.map((id) => {
        const pane = layout.get(id)!;
        const item = state.items[id];
        const className = "web-pane" + (pane.focused ? " web-pane-focused" : "") + (split ? " web-pane-split" : "");
        const frameRef = (element: HTMLElement | null) => {
          if (element) frames.current.set(id, element);
          else frames.current.delete(id);
        };
        return (
          <div
            key={id}
            ref={frameRef}
            className={
              "web-pane-frame" +
              (split ? " web-pane-frame-split" : "") +
              (split && pane.focused ? " web-pane-frame-focused" : "") +
              (reorder?.id === id ? " web-pane-frame-moving" : "")
            }
            style={{ ...pane.style, ...(split ? paneBarColors(colors[id]) : {}) }}
          >
            {split && <PaneBar id={id} split={split} onReorderStart={startReorder(id)} />}
            {isTab(item) && isInternalUrl(item.data.url) ? (
              <div className={className + " internal-pane"} onMouseDown={() => dispatch({ type: "activate", id, now: Date.now() })}>
                <InternalPage url={item.data.url} navigate={(next) => dispatch({ type: "updateTab", id, url: next, now: Date.now() })} />
              </div>
            ) : (
              <div ref={host.slotRef(id)} className={className} />
            )}
          </div>
        );
      })}

      {visible.slice(0, -1).map((_, i) => {
        const at = factors.slice(0, i + 1).reduce((a, b) => a + b, 0) * 100;
        return (
          <div
            key={"divider-" + i}
            className={"split-divider" + (vertical ? " split-divider-vertical" : "")}
            style={vertical ? { top: `calc(${at}% - 4px)` } : { left: `calc(${at}% - 4px)` }}
            onPointerDown={startDrag(i)}
          />
        );
      })}

      {tabDragged && (
        <div className="split-drop-layer" onDragOver={onDropOver} onDragLeave={() => setDropTarget(null)} onDrop={onDrop}>
          {dropTarget && (
            <div
              className="split-drop-target"
              style={{ left: dropTarget.rect.left, top: dropTarget.rect.top, width: dropTarget.rect.width, height: dropTarget.rect.height }}
            />
          )}
        </div>
      )}

      {!visible.length && (
        <div className="empty-state">
          <div className="empty-logo">yzo</div>
          <p>
            <kbd>{shortcutLabel("newTab")}</kbd> {t("empty.newTab")} · <kbd>{shortcutLabel("toggleSidebar")}</kbd> {t("empty.sidebar")} ·{" "}
            <kbd>{shortcutLabel("addSplit")}</kbd> {t("empty.split")}
          </p>
        </div>
      )}
    </main>
  );
}
