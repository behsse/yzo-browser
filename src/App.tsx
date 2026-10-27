import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cursorOnTopEdge, floatingSidebarDecision, floatingTopBarDecision } from "./lib/floatingSidebar";
import { t } from "./lib/i18n";
import { matchShortcut, type ShortcutAction } from "./lib/shortcuts";
import { displayTheme } from "./lib/privateMode";
import { resolveAppearance, sidebarBackground } from "./lib/theme";
import { PEEK_ID, tabCommand } from "./lib/tabs";
import { useStore } from "./state/store";
import { isTab } from "./state/tree";
import type { ID } from "./state/types";
import { AccountPanel } from "./ui/AccountPanel";
import { ArchivePanel } from "./ui/ArchivePanel";
import { CommandBar } from "./ui/CommandBar";
import { ExtensionsPanel } from "./ui/ExtensionsPanel";
import { SitePanel } from "./ui/SitePanel";
import { DownloadsPanel } from "./ui/DownloadsPanel";
import { ContextMenu } from "./ui/ContextMenu";
import { ICON_PATHS } from "./ui/Icon";
import { Peek } from "./ui/Peek";
import { Sidebar } from "./ui/Sidebar";
import { TopBar } from "./ui/TopBar";
import { SpaceEditor } from "./ui/SpaceEditor";
import { UiContext, type AccountMode, type CommandBarMode, type MenuState, type UiValue } from "./ui/UiContext";
import { useMissingFavicons } from "./ui/useMissingFavicons";
import { ViewHostProvider } from "./ui/ViewHost";
import { WebArea } from "./ui/WebArea";

const AUTO_ARCHIVE_INTERVAL_MS = 60_000;
const TOAST_MS = 1800;
const HIDE_DELAY_MS = 120;
const CURSOR_POLL_MS = 50;
/** Matches --slide-out-ms in styles.css, plus a frame of margin. */
const FLOATING_EXIT_MS = 200;
/** Height of the window top edge that reveals the hidden top bar. */
const TOP_EDGE_PX = 8;
/** How long after the window last moved the revealed top bar stays open (window drag by the bar). */
const WINDOW_MOVE_HOLD_MS = 400;
/** Gap between the floating sidebar card and the window edges (matches .floating-zone padding). */
const FLOATING_MARGIN_PX = 6;
/** Height of the top bar (--topbar-height in styles.css). */
const TOP_BAR_HEIGHT_PX = 32;

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
  const [accountOpen, setAccountOpen] = useState<AccountMode | null>(null);
  const [extensionsAnchor, setExtensionsAnchor] = useState<{ right: number; bottom: number } | null>(null);
  const [sitePanelAnchor, setSitePanelAnchor] = useState<{ left: number; bottom: number } | null>(null);
  const [downloadsAnchor, setDownloadsAnchor] = useState<{ right: number; bottom: number } | null>(null);
  const [spaceEditor, setSpaceEditor] = useState<ID | "new" | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  /** A menu shown by the popup layer above the pages (no freeze needed). */
  const [nativeMenuOpen, setNativeMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [topRevealed, setTopRevealed] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);
  const topHideTimer = useRef<number | undefined>(undefined);
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
        case "toggleTopBar":
          dispatch({ type: "setTopBarMode", mode: s.window.topBarMode === "hidden" ? "anchored" : "hidden" });
          setTopRevealed(false);
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

  // Inside Electron, menus are drawn above the live pages by the main process, so videos keep playing.
  // Elsewhere (tests, plain browser) they fall back to the HTML ContextMenu.
  const openMenu = useCallback((next: MenuState) => {
    const bridge = window.yzo;
    if (!bridge?.showMenu) return setMenu(next);
    const entries = next.entries.map((entry) =>
      entry === "separator"
        ? ("separator" as const)
        : { label: entry.label, icon: entry.icon ? ICON_PATHS[entry.icon] : undefined, hint: entry.hint, danger: entry.danger, disabled: entry.disabled },
    );
    setNativeMenuOpen(true);
    void bridge.showMenu(entries, next.x, next.y).then((index) => {
      setNativeMenuOpen(false);
      const picked = index === null ? undefined : next.entries[index];
      if (picked && picked !== "separator" && !picked.disabled) picked.onSelect();
    });
  }, []);

  const ui: UiValue = useMemo(
    () => ({
      openCommandBar: setCommandBar,
      openPeek: setPeekUrl,
      openArchive: () => setArchiveOpen(true),
      openAccount: (mode = "signIn") => setAccountOpen(mode),
      openSpaceEditor: setSpaceEditor,
      openMenu,
      openExtensions: setExtensionsAnchor,
      openSitePanel: setSitePanelAnchor,
      openDownloads: setDownloadsAnchor,
      showToast,
      runAction,
    }),
    [runAction, showToast, openMenu],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPeekUrl(null);
        setArchiveOpen(false);
        setAccountOpen(null);
        setExtensionsAnchor(null);
        setSitePanelAnchor(null);
        setDownloadsAnchor(null);
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

  // A new download opens the downloads panel under its button, like Chrome's bubble (not while the top
  // bar is hidden: the button is not on screen then).
  useEffect(() => {
    return window.yzo?.downloads.onStarted(() => {
      const button = document.querySelector<HTMLElement>(".topbar-slot [data-downloads-button]");
      const rect = button?.getBoundingClientRect();
      if (rect && rect.width) setDownloadsAnchor({ right: rect.right, bottom: rect.bottom });
    });
  }, []);

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

  useMissingFavicons(state, dispatch);

  useEffect(() => {
    dispatch({ type: "runAutoArchive", now: Date.now() });
    const timer = window.setInterval(() => dispatch({ type: "runAutoArchive", now: Date.now() }), AUTO_ARCHIVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [dispatch]);

  const hidden = state.window.sidebarMode === "hidden";
  const topHidden = state.window.topBarMode === "hidden";
  const zoneWidth = state.window.sidebarWidth + 2 * FLOATING_MARGIN_PX;

  // The floating sidebar closes after a short grace period, so brushing past its edge does not hide it.
  const reveal = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = undefined;
    setRevealed(true);
  }, []);
  // A menu or dialog opened from the floating sidebar (extensions, space editor…) can extend past it:
  // the sidebar stays open until it closes, then the cursor position decides again.
  const holdFloating = nativeMenuOpen || Boolean(menu || commandBar || peekUrl || archiveOpen || accountOpen || spaceEditor || extensionsAnchor || sitePanelAnchor || downloadsAnchor);
  const holdFloatingRef = useRef(holdFloating);
  holdFloatingRef.current = holdFloating;
  const scheduleHide = useCallback(() => {
    if (holdFloatingRef.current) return;
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
      if (floatingSidebarDecision(cursor, zoneWidth, topHidden ? 0 : TOP_BAR_HEIGHT_PX) === "hide") scheduleHide();
      else reveal();
    }, CURSOR_POLL_MS);
    return () => window.clearInterval(timer);
  }, [hidden, topHidden, revealed, zoneWidth, scheduleHide, reveal]);

  // Keep the UI raised above the pages until the floating sidebar has finished sliding out, so the
  // native views do not cover it mid-animation.
  const [floatingFrozen, setFloatingFrozen] = useState(false);
  useEffect(() => {
    if (revealed) {
      setFloatingFrozen(true);
      return;
    }
    const timer = window.setTimeout(() => setFloatingFrozen(false), FLOATING_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [revealed]);

  // Hidden top bar: slides down over the pages on hover of the top edge, like the floating sidebar.
  // Pressing it hands the move to Windows (electron/window-drag.cjs), so it drags like a title bar.
  const revealTop = useCallback(() => {
    window.clearTimeout(topHideTimer.current);
    topHideTimer.current = undefined;
    setTopRevealed(true);
  }, []);
  // While the window is dragged by the revealed bar, the cursor stays on it but its position can lag:
  // keep the bar open until the window has stopped moving for a moment.
  const lastWindowMove = useRef(0);
  useEffect(() => window.yzo?.onWindowMoved(() => (lastWindowMove.current = Date.now())), []);
  const scheduleTopHide = useCallback(() => {
    if (holdFloatingRef.current || topHideTimer.current !== undefined) return;
    if (Date.now() - lastWindowMove.current < WINDOW_MOVE_HOLD_MS) return;
    topHideTimer.current = window.setTimeout(() => {
      topHideTimer.current = undefined;
      setTopRevealed(false);
    }, HIDE_DELAY_MS);
  }, []);
  useEffect(() => {
    if (!topHidden || !topRevealed || !window.yzo) return;
    const timer = window.setInterval(async () => {
      const cursor = await window.yzo?.cursorPosition();
      if (!cursor) return;
      if (floatingTopBarDecision(cursor, TOP_BAR_HEIGHT_PX) === "hide") scheduleTopHide();
      else revealTop();
    }, CURSOR_POLL_MS);
    return () => window.clearInterval(timer);
  }, [topHidden, topRevealed, scheduleTopHide, revealTop]);
  // The top edge is mostly covered by the resize border and the pages, out of reach of the reveal
  // edge element: watch the cursor there too while the bar is hidden.
  useEffect(() => {
    if (!topHidden || topRevealed || !window.yzo) return;
    const timer = window.setInterval(async () => {
      const cursor = await window.yzo?.cursorPosition();
      if (cursor && cursorOnTopEdge(cursor, TOP_EDGE_PX)) revealTop();
    }, CURSOR_POLL_MS);
    return () => window.clearInterval(timer);
  }, [topHidden, topRevealed, revealTop]);
  // Keep the UI raised until the floating top bar has slid out, like the floating sidebar.
  const [topFrozen, setTopFrozen] = useState(false);
  useEffect(() => {
    if (topRevealed) {
      setTopFrozen(true);
      return;
    }
    const timer = window.setTimeout(() => setTopFrozen(false), FLOATING_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [topRevealed]);
  const overlayOpen = Boolean(
    commandBar || peekUrl || archiveOpen || accountOpen || spaceEditor || menu || extensionsAnchor || sitePanelAnchor || downloadsAnchor || (hidden && floatingFrozen) || (topHidden && topFrozen),
  );
  const theme = displayTheme(state.spaces[state.window.focusedSpaceId].theme);

  return (
    <ViewHostProvider overlayOpen={overlayOpen} peekUrl={peekUrl}>
      <UiContext.Provider value={ui}>
        <div className={`app app-${resolveAppearance(theme)}${hidden ? " app-sidebar-hidden" : ""}${topHidden ? " app-topbar-hidden" : ""}`}>
          {/* The space gradient, with a hole over each page: the UI view is transparent there, so the
              live pages show through when the UI is stacked above them. */}
          <div className="app-backdrop" style={{ background: sidebarBackground(theme) }} />
          {/* Anchored, the bar takes its row (the slot animates its height when it is hidden or locked). */}
          <div className="topbar-slot">{!topHidden && <TopBar />}</div>
          {topHidden && (
            <>
              {/* Never a drag region: Electron drag regions receive no mouse events. */}
              <div className="topbar-reveal-edge" onMouseEnter={revealTop} onMouseMove={revealTop} />
              <div className={"floating-topbar" + (topRevealed ? " floating-topbar-open" : "")} style={{ background: sidebarBackground(theme) }} inert={!topRevealed}>
                <TopBar floating />
              </div>
            </>
          )}
          <div className="app-body">
          {/* The anchored sidebar stays mounted and its slot animates its width, so Ctrl+S slides the
              page instead of jumping. It is inert while collapsed. */}
          <div className="sidebar-slot" style={{ width: hidden ? 0 : state.window.sidebarWidth }} inert={hidden}>
            <Sidebar />
          </div>
          {/* Never mark the reveal edge as a drag region: Electron drag regions receive no mouse events. */}
          {hidden && <div className="reveal-edge" onMouseEnter={reveal} onMouseMove={reveal} />}
          {/* The hover zone is the whole left column (window top to bottom, from the left edge), so the
              margins above, below and left of the card keep it open; only moving right toward the page
              closes it. While it is open the UI is raised above the live pages, and an invisible layer
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
        </div>

        {commandBar && <CommandBar mode={commandBar} onClose={() => setCommandBar(null)} />}
        {peekUrl && <Peek url={peekUrl} onClose={() => setPeekUrl(null)} />}
        {archiveOpen && <ArchivePanel onClose={() => setArchiveOpen(false)} />}
        {accountOpen && <AccountPanel initialMode={accountOpen} onClose={() => setAccountOpen(null)} />}
        {extensionsAnchor && <ExtensionsPanel anchor={extensionsAnchor} onClose={() => setExtensionsAnchor(null)} />}
        {sitePanelAnchor && <SitePanel anchor={sitePanelAnchor} onClose={() => setSitePanelAnchor(null)} />}
        {downloadsAnchor && <DownloadsPanel anchor={downloadsAnchor} onClose={() => setDownloadsAnchor(null)} />}
        {spaceEditor && <SpaceEditor spaceId={spaceEditor} onClose={() => setSpaceEditor(null)} />}
        {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
        {toast && <div className="toast">{toast}</div>}
      </UiContext.Provider>
    </ViewHostProvider>
  );
}
