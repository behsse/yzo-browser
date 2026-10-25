import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ViewBounds, ViewSyncPayload } from "../env";
import { pageHolesMask } from "../lib/pageMask";
import { tabCommand } from "../lib/tabs";
import { useStore } from "../state/store";
import { isTab } from "../state/tree";
import type { ID } from "../state/types";

const FOCUS_RETRY_MS = 300;

interface ViewHostValue {
  /** Ref callback marking where a visible tab's native view must be placed. */
  slotRef(id: ID): (element: HTMLElement | null) => void;
  /** Ref callback for the Peek card's page area. */
  peekRef(element: HTMLElement | null): void;
  /** True while the UI is stacked above the live pages. */
  raised: boolean;
  /** Raises the UI during a drag so pointer events reach it instead of the pages. */
  setDragging(dragging: boolean): void;
  /** Chromium id of a tab's page, needed by extension icons to show per-tab state. */
  webContentsIdOf(id: ID | null): number | undefined;
}

const ViewHostContext = createContext<ViewHostValue | null>(null);

/** Until this time (epoch ms), the selected page does not take the keyboard back. */
let pageFocusHeldUntil = 0;

/**
 * Keeps the selected page from taking the keyboard focus for a moment. Used when an extension popup
 * opens as its panel closes: focusing the page would blur the popup, which then closes itself.
 * @param ms Duration in milliseconds.
 */
export function holdPageFocus(ms: number): void {
  pageFocusHeldUntil = Date.now() + ms;
}

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
 * coalesced to one message per animation frame. While an HTML overlay is open the UI is raised above
 * the pages: it is transparent over the slots (the backdrop is masked there), so overlays are drawn
 * over the live pages and videos keep playing.
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
  const [webContentsIds, setWebContentsIds] = useState<Record<ID, number>>({});
  const raised = overlayOpen || dragging;

  const latest = useRef({ state, raised, peekUrl });
  latest.current = { state, raised, peekUrl };
  const lastMask = useRef("");

  const sendSync = useCallback(() => {
    frame.current = 0;
    if (!window.yzo) return;
    const { state: s, raised: isRaised, peekUrl: peek } = latest.current;
    const ids = new Set([...s.loadedTabIds, ...slots.current.keys()]);
    const tabs: ViewSyncPayload["tabs"] = [];
    for (const id of ids) {
      const item = s.items[id];
      if (!isTab(item)) continue;
      tabs.push({ id, url: item.data.url, bounds: boundsOf(slots.current.get(id)) });
    }
    const mask = pageHolesMask(
      tabs.flatMap((tab) => (tab.bounds ? [tab.bounds] : [])),
      window.innerWidth,
      window.innerHeight,
    );
    if (mask !== lastMask.current) {
      lastMask.current = mask;
      document.documentElement.style.setProperty("--page-holes", mask);
    }
    window.yzo.syncViews({
      tabs,
      raised: isRaised,
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

  // Keyboard focus follows the selected tab, like clicking into a page.
  const focusedTabId = state.window.selection[state.window.focusedSpaceId]?.focusedTabId ?? null;
  useEffect(() => {
    if (!focusedTabId || raised) return;
    const focus = () => {
      if (Date.now() >= pageFocusHeldUntil) void tabCommand(focusedTabId, "focus");
    };
    const first = window.setTimeout(focus, 0);
    const retry = window.setTimeout(focus, FOCUS_RETRY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(retry);
    };
  }, [focusedTabId, raised]);

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
    () => ({ slotRef, peekRef, raised, setDragging, webContentsIdOf }),
    [slotRef, peekRef, raised, webContentsIdOf],
  );
  return <ViewHostContext.Provider value={value}>{children}</ViewHostContext.Provider>;
}

/**
 * Reads the view host.
 * @returns Slot registration and raise controls.
 */
export function useViewHost(): ViewHostValue {
  const value = useContext(ViewHostContext);
  if (!value) throw new Error("useViewHost must be used inside ViewHostProvider");
  return value;
}
