import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ViewBounds, ViewSyncPayload } from "../env";
import { tabCommand } from "../lib/tabs";
import { useStore } from "../state/store";
import { isTab } from "../state/tree";
import type { ID } from "../state/types";

const CLEAR_SNAPSHOTS_DELAY_MS = 150;
const FOCUS_RETRY_MS = 300;

interface ViewHostValue {
  /** Ref callback marking where a visible tab's native view must be placed. */
  slotRef(id: ID): (element: HTMLElement | null) => void;
  /** Ref callback for the Peek card's page area. */
  peekRef(element: HTMLElement | null): void;
  /** Screenshot shown in a slot while the views are frozen. */
  snapshots: Record<ID, string>;
  /** True while tab views are hidden behind screenshots. */
  frozen: boolean;
  /** Freezes the views during a drag so pointer events reach the UI instead of the pages. */
  setDragging(dragging: boolean): void;
  /** Chromium id of a tab's page, needed by extension icons to show per-tab state. */
  webContentsIdOf(id: ID | null): number | undefined;
}

const ViewHostContext = createContext<ViewHostValue | null>(null);

/**
 * Reads the rectangle of an element in window coordinates.
 * @param element Slot element.
 * @returns Bounds, or null when the element has no size.
 */
function boundsOf(element: HTMLElement | undefined | null): ViewBounds | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : null;
}

/**
 * Bridges the React layout and the main process's native tab views. Slots (plain divs) mark where
 * each visible page goes; their rectangles are sent to the main process whenever layout changes,
 * coalesced to one message per animation frame. While an HTML overlay is open the views are frozen:
 * the main process sends screenshots, this provider shows them in the slots and acknowledges, and
 * only then are the native views hidden — so overlays can be drawn over the page area seamlessly.
 * @param props.overlayOpen Whether an HTML overlay currently covers the page area.
 * @param props.peekUrl URL previewed in Peek, or null.
 * @param props.children App tree.
 * @returns Provider element.
 */
export function ViewHostProvider({ overlayOpen, peekUrl, children }: { overlayOpen: boolean; peekUrl: string | null; children: ReactNode }) {
  const { state } = useStore();
  const slots = useRef(new Map<ID, HTMLElement>());
  const slotCallbacks = useRef(new Map<ID, (element: HTMLElement | null) => void>());
  const peekElement = useRef<HTMLElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const frame = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [snapshots, setSnapshots] = useState<Record<ID, string>>({});
  const [webContentsIds, setWebContentsIds] = useState<Record<ID, number>>({});
  const frozen = overlayOpen || dragging;

  const latest = useRef({ state, frozen, peekUrl });
  latest.current = { state, frozen, peekUrl };

  const sendSync = useCallback(() => {
    frame.current = 0;
    if (!window.yzo) return;
    const { state: s, frozen: isFrozen, peekUrl: peek } = latest.current;
    const ids = new Set([...s.loadedTabIds, ...slots.current.keys()]);
    const tabs: ViewSyncPayload["tabs"] = [];
    for (const id of ids) {
      const item = s.items[id];
      if (!isTab(item)) continue;
      tabs.push({ id, url: item.data.url, bounds: boundsOf(slots.current.get(id)) });
    }
    window.yzo.syncViews({
      tabs,
      frozen: isFrozen,
      peek: peek ? { url: peek, bounds: boundsOf(peekElement.current) } : null,
      activeTabId: s.window.selection[s.window.focusedSpaceId]?.focusedTabId ?? null,
    });
  }, []);

  const scheduleSync = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(sendSync);
  }, [sendSync]);

  if (!observer.current && typeof ResizeObserver !== "undefined") observer.current = new ResizeObserver(scheduleSync);

  // Any re-render may move slots (tab switch, split change, sidebar toggle…): resync after layout.
  useLayoutEffect(() => {
    scheduleSync();
  });

  useEffect(() => {
    window.addEventListener("resize", scheduleSync);
    return () => window.removeEventListener("resize", scheduleSync);
  }, [scheduleSync]);

  useEffect(() => {
    return window.yzo?.onTabEvent((event) => {
      if (event.type === "attached") setWebContentsIds((ids) => ({ ...ids, [event.tabId]: event.webContentsId }));
    });
  }, []);

  // Show the screenshots the main process captured, then let it hide the native views.
  useEffect(() => {
    return window.yzo?.onSnapshots(async ({ token, shots }) => {
      await Promise.all(
        Object.values(shots).map((src) => {
          const image = new Image();
          image.src = src;
          return image.decode().catch(() => undefined);
        }),
      );
      setSnapshots(shots);
      requestAnimationFrame(() => requestAnimationFrame(() => window.yzo?.ackSnapshots(token)));
    });
  }, []);

  // Once unfrozen the live pages are back on top: drop the screenshots shortly after.
  useEffect(() => {
    if (frozen) return;
    const timer = window.setTimeout(() => setSnapshots({}), CLEAR_SNAPSHOTS_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [frozen]);

  // Keyboard focus follows the selected tab, like clicking into a page.
  const focusedTabId = state.window.selection[state.window.focusedSpaceId]?.focusedTabId ?? null;
  useEffect(() => {
    if (!focusedTabId || frozen) return;
    const first = window.setTimeout(() => void tabCommand(focusedTabId, "focus"), 0);
    const retry = window.setTimeout(() => void tabCommand(focusedTabId, "focus"), FOCUS_RETRY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(retry);
    };
  }, [focusedTabId, frozen]);

  const slotRef = useCallback(
    (id: ID) => {
      let callback = slotCallbacks.current.get(id);
      if (!callback) {
        callback = (element: HTMLElement | null) => {
          const previous = slots.current.get(id);
          if (previous) observer.current?.unobserve(previous);
          if (element) {
            slots.current.set(id, element);
            observer.current?.observe(element);
          } else {
            slots.current.delete(id);
            slotCallbacks.current.delete(id);
          }
          scheduleSync();
        };
        slotCallbacks.current.set(id, callback);
      }
      return callback;
    },
    [scheduleSync],
  );

  const peekRef = useCallback(
    (element: HTMLElement | null) => {
      if (peekElement.current) observer.current?.unobserve(peekElement.current);
      peekElement.current = element;
      if (element) observer.current?.observe(element);
      scheduleSync();
    },
    [scheduleSync],
  );

  const webContentsIdOf = useCallback((id: ID | null) => (id ? webContentsIds[id] : undefined), [webContentsIds]);

  const value = useMemo<ViewHostValue>(
    () => ({ slotRef, peekRef, snapshots, frozen, setDragging, webContentsIdOf }),
    [slotRef, peekRef, snapshots, frozen, webContentsIdOf],
  );
  return <ViewHostContext.Provider value={value}>{children}</ViewHostContext.Provider>;
}

/**
 * Reads the view host.
 * @returns Slot registration, snapshots and freeze controls.
 */
export function useViewHost(): ViewHostValue {
  const value = useContext(ViewHostContext);
  if (!value) throw new Error("useViewHost must be used inside ViewHostProvider");
  return value;
}
