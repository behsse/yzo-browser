import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { t } from "../lib/i18n";
import { shortcutLabel } from "../lib/shortcuts";
import { useStore } from "../state/store";
import { isSplit, isTab } from "../state/tree";
import type { ID } from "../state/types";
import { useViewHost } from "./ViewHost";

interface PaneLayout {
  style: CSSProperties;
  focused: boolean;
}

const GAP_PX = 6;

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
 * Content area: lays out one slot per visible tab (the native page view is placed over it by the
 * main process), shows page screenshots while views are frozen, and provides the draggable split
 * dividers.
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
  const layout = layoutPanes(visible, factors, vertical, selection?.focusedTabId ?? null);

  // Pages are native views that swallow the pointer, so dividers freeze them while dragging and
  // end the drag on release (or as soon as no button is pressed anymore).
  const startDrag = (index: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isSplit(content) || !areaRef.current) return;
    event.preventDefault();
    const rect = areaRef.current.getBoundingClientRect();
    host.setDragging(true);
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
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <main className="web-area" ref={areaRef}>
      {visible.map((id) => {
        const pane = layout.get(id)!;
        const snapshot = host.frozen ? host.snapshots[id] : undefined;
        return (
          <div key={id} ref={host.slotRef(id)} className={"web-pane" + (pane.focused ? " web-pane-focused" : "")} style={pane.style}>
            {snapshot && <img className="web-pane-snapshot" src={snapshot} alt="" draggable={false} />}
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
