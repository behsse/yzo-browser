import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { floatingSidebarDecision } from "./lib/floatingSidebar";
import { t } from "./lib/i18n";
import { matchShortcut, type ShortcutAction } from "./lib/shortcuts";
import { resolveAppearance, sidebarBackground } from "./lib/theme";
import { PEEK_ID, tabCommand } from "./lib/tabs";
import { useStore } from "./state/store";
import { isTab } from "./state/tree";
import type { ID } from "./state/types";
import { AccountPanel } from "./ui/AccountPanel";
import { ArchivePanel } from "./ui/ArchivePanel";
import { CommandBar } from "./ui/CommandBar";
import { ContextMenu } from "./ui/ContextMenu";
import { Peek } from "./ui/Peek";
import { Sidebar } from "./ui/Sidebar";
import { SpaceEditor } from "./ui/SpaceEditor";
import { UiContext, type CommandBarMode, type MenuState, type UiValue } from "./ui/UiContext";
import { ViewHostProvider } from "./ui/ViewHost";
import { WebArea } from "./ui/WebArea";

const AUTO_ARCHIVE_INTERVAL_MS = 60_000;
const TOAST_MS = 1800;
const HIDE_DELAY_MS = 120;
const CURSOR_POLL_MS = 50;
/** Matches --slide-out-ms in styles.css, plus a frame of margin. */
const FLOATING_EXIT_MS = 200;
/** Gap between the floating sidebar card and the window edges (matches .floating-zone padding). */
const FLOATING_MARGIN_PX = 6;

/**
 * Root component: lays out the sidebar and content, owns the transient overlays and routes every
 * shortcut (from the UI's own keydown or forwarded by the main process from web pages).
 * @returns App element.
 */
export function App() {
  const { state, dispatch } = useStore();
  const [commandBar, setCommandBar] = useState<CommandBarMode | null>(null);
  const [peekUrl, setPeekUrl] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [spaceEditor, setSpaceEditor] = useState<ID | "new" | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);
  const stateRef = useRef(state);
  stateRef.current = state;

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const runAction = useCallback(
    (action: ShortcutAction) => {
      const s = stateRef.current;
      const now = Date.now();
      const spaceId = s.window.focusedSpaceId;
      const selection = s.window.selection[spaceId];
      const focusedId = selection?.focusedTabId ?? null;
      const focusedTab = focusedId ? s.items[focusedId] : undefined;

      if (action.startsWith("switchSpace")) {
        dispatch({ type: "switchSpaceIndex", index: Number(action.slice(-1)) - 1 });
        return;
      }
      switch (action) {
        case "newTab":
          setCommandBar("new");
          break;
        case "openLocation":
          setCommandBar(focusedId ? "current" : "new");
          break;
        case "addSplit":
          setCommandBar(focusedId ? "split" : "new");
          break;
        case "closeTab":
          if (focusedId) dispatch({ type: "closeItem", id: focusedId, now });
          break;
        case "reopenClosed":
          if (s.archive.length) dispatch({ type: "reopenClosed", now });
          break;
        case "togglePin":
          if (focusedId) dispatch({ type: "togglePin", id: focusedId });
          break;
        case "toggleSidebar":
          dispatch({ type: "setSidebarMode", mode: s.window.sidebarMode === "anchored" ? "hidden" : "anchored" });
          setRevealed(false);
          break;
        case "reload":
          void tabCommand(focusedId, "reload");
          break;
        case "back":
          void tabCommand(focusedId, "back");
          break;
        case "forward":
          void tabCommand(focusedId, "forward");
          break;
        case "nextTab":
        case "previousTab":
          dispatch({ type: "cycleContent", delta: action === "nextTab" ? 1 : -1, now });
          break;
        case "copyUrl":
          if (isTab(focusedTab)) {
            void navigator.clipboard.writeText(focusedTab.data.url);
            showToast(t("toast.linkCopied"));
          }
          break;
        case "clearToday":
          dispatch({ type: "clearToday", spaceId, now });
          showToast(t("toast.todayArchived"));
          break;
        case "newFolder":
          dispatch({ type: "createFolder", spaceId, title: t("default.folderName"), now });
          break;
        case "openArchive":
          setArchiveOpen(true);
          break;
        case "devTools":
          void tabCommand(focusedId, "devtools");
          break;
      }
    },
    [dispatch, showToast],
  );

  const ui: UiValue = useMemo(
    () => ({
      openCommandBar: setCommandBar,
      openPeek: setPeekUrl,
      openArchive: () => setArchiveOpen(true),
      openAccount: () => setAccountOpen(true),
      openSpaceEditor: setSpaceEditor,
      openMenu: setMenu,
      showToast,
      runAction,
    }),
    [runAction, showToast],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPeekUrl(null);
        setArchiveOpen(false);
        setAccountOpen(false);
        setSpaceEditor(null);
        return;
      }
      const action = matchShortcut({ key: event.key, ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey });
      if (!action) return;
      event.preventDefault();
      runAction(action);
    };
    window.addEventListener("keydown", onKey);
    const offShortcut = window.yzo?.onShortcut(runAction);
    const offPeek = window.yzo?.onPeek(({ url }) => setPeekUrl(url));
    const offTab = window.yzo?.onOpenTab(({ url, background }) =>
      dispatch({ type: "createTab", url, target: "today", activate: !background, now: Date.now() }),
    );
    return () => {
      window.removeEventListener("keydown", onKey);
      offShortcut?.();
      offPeek?.();
      offTab?.();
    };
  }, [runAction, dispatch]);

  // Page events from the native tab views feed the store (URL, title, favicon, history, focus).
  useEffect(() => {
    return window.yzo?.onTabEvent((event) => {
      if (event.tabId === PEEK_ID) return;
      const now = Date.now();
      switch (event.type) {
        case "navigate":
          dispatch({ type: "updateTab", id: event.tabId, url: event.url, now });
          dispatch({ type: "recordVisit", url: event.url, title: "", now });
          break;
        case "navigate-in-page":
          dispatch({ type: "updateTab", id: event.tabId, url: event.url, now });
          break;
        case "title":
          dispatch({ type: "updateTab", id: event.tabId, title: event.title, now });
          dispatch({ type: "recordVisit", url: event.url, title: event.title, now });
          break;
        case "favicon":
          dispatch({ type: "updateTab", id: event.tabId, favicon: event.favicon, now });
          break;
        case "focus":
          dispatch({ type: "activate", id: event.tabId, now });
          break;
      }
    });
  }, [dispatch]);

  // Tab requests from extensions (chrome.tabs.create / update({ active }) / remove).
  useEffect(() => {
    const offCreate = window.yzo?.onTabCreate(({ id, url, active }) =>
      dispatch({ type: "createTab", id, url, target: "today", activate: active, load: true, now: Date.now() }),
    );
    const offActivate = window.yzo?.onTabActivate(({ id }) => dispatch({ type: "activate", id, now: Date.now() }));
    const offClose = window.yzo?.onTabClose(({ id }) => dispatch({ type: "closeItem", id, now: Date.now() }));
    return () => {
      offCreate?.();
      offActivate?.();
      offClose?.();
    };
  }, [dispatch]);

  useEffect(() => {
    dispatch({ type: "runAutoArchive", now: Date.now() });
    const timer = window.setInterval(() => dispatch({ type: "runAutoArchive", now: Date.now() }), AUTO_ARCHIVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [dispatch]);

  const hidden = state.window.sidebarMode === "hidden";
  const zoneWidth = state.window.sidebarWidth + 2 * FLOATING_MARGIN_PX;

  // The floating sidebar closes after a short grace period, so brushing past its edge does not hide it.
  const reveal = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = undefined;
    setRevealed(true);
  }, []);
  const scheduleHide = useCallback(() => {
    // Keep an already running delay: repeated calls (polling) must not postpone the close forever.
    if (hideTimer.current !== undefined) return;
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = undefined;
      setRevealed(false);
    }, HIDE_DELAY_MS);
  }, []);

  // Pointer events over a page go to the page's process, so the UI cannot always see the cursor
  // leave toward the page. While the floating sidebar is open, poll the real cursor position.
  useEffect(() => {
    if (!hidden || !revealed || !window.yzo) return;
    const timer = window.setInterval(async () => {
      const cursor = await window.yzo?.cursorPosition();
      if (!cursor) return;
      if (floatingSidebarDecision(cursor, zoneWidth) === "hide") scheduleHide();
      else reveal();
    }, CURSOR_POLL_MS);
    return () => window.clearInterval(timer);
  }, [hidden, revealed, zoneWidth, scheduleHide, reveal]);

  // Keep the pages frozen until the floating sidebar has finished sliding out, so the native views
  // do not cover it mid-animation.
  const [floatingFrozen, setFloatingFrozen] = useState(false);
  useEffect(() => {
    if (revealed) {
      setFloatingFrozen(true);
      return;
    }
    const timer = window.setTimeout(() => setFloatingFrozen(false), FLOATING_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [revealed]);

  const overlayOpen = Boolean(commandBar || peekUrl || archiveOpen || accountOpen || spaceEditor || menu || (hidden && floatingFrozen));
  const theme = state.spaces[state.window.focusedSpaceId].theme;

  return (
    <ViewHostProvider overlayOpen={overlayOpen} peekUrl={peekUrl}>
      <UiContext.Provider value={ui}>
        <div
          className={`app app-${resolveAppearance(theme)}${hidden ? " app-sidebar-hidden" : ""}`}
          style={{ background: sidebarBackground(theme) }}
        >
          {/* The anchored sidebar stays mounted and its slot animates its width, so Ctrl+S slides the
              page instead of jumping. It is inert while collapsed. */}
          <div className="sidebar-slot" style={{ width: hidden ? 0 : state.window.sidebarWidth }} inert={hidden}>
            <Sidebar />
          </div>
          {/* Never mark the reveal edge as a drag region: Electron drag regions receive no mouse events. */}
          {hidden && <div className="reveal-edge" onMouseEnter={reveal} onMouseMove={reveal} />}
          {hidden && <div className="hidden-drag-strip drag" />}
          {/* The hover zone is the whole left column (window top to bottom, from the left edge), so the
              margins above, below and left of the card keep it open; only moving right toward the page
              closes it. While it is open the pages are frozen behind screenshots, and an invisible layer
              covers the page side: entering it starts the hide delay, clicking it closes immediately. */}
          {hidden && revealed && (
            <div
              className="floating-catcher"
              style={{ left: zoneWidth }}
              onMouseEnter={scheduleHide}
              onMouseDown={() => setRevealed(false)}
            />
          )}
          {/* Mounted for the whole hidden mode so both opening and closing can transition. */}
          {hidden && (
            <div
              className={"floating-zone" + (revealed ? " floating-zone-open" : "")}
              style={{ width: zoneWidth }}
              onMouseEnter={revealed ? reveal : undefined}
              onMouseMove={revealed ? reveal : undefined}
              inert={!revealed}
            >
              <div className="floating-card">
                <Sidebar floating />
              </div>
            </div>
          )}
          <WebArea />
        </div>

        {commandBar && <CommandBar mode={commandBar} onClose={() => setCommandBar(null)} />}
        {peekUrl && <Peek url={peekUrl} onClose={() => setPeekUrl(null)} />}
        {archiveOpen && <ArchivePanel onClose={() => setArchiveOpen(false)} />}
        {accountOpen && <AccountPanel onClose={() => setAccountOpen(false)} />}
        {spaceEditor && <SpaceEditor spaceId={spaceEditor} onClose={() => setSpaceEditor(null)} />}
        {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
        {toast && <div className="toast">{toast}</div>}
      </UiContext.Provider>
    </ViewHostProvider>
  );
}
