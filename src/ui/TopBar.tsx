import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { t } from "../lib/i18n";
import { EXTENSIONS_URL, isInternalUrl, settingsUrl } from "../lib/internalPages";
import { IS_PRIVATE } from "../lib/privateMode";
import { checkForUpdatesWithToasts } from "../lib/updates";
import { shortcutLabel } from "../lib/shortcuts";
import { tabCommand } from "../lib/tabs";
import { displayHost } from "../lib/url";
import { useStore } from "../state/store";
import { isTab } from "../state/tree";
import { useSync } from "../sync/SyncProvider";
import { ExtensionActionButton, useExtensionActions } from "./extensionActions";
import { BrandMark, Icon } from "./Icon";
import { useUi, type MenuEntry } from "./UiContext";
import { useDownloads } from "./useDownloads";
import { useViewHost } from "./ViewHost";

/**
 * Minimize / maximize / close buttons of the frameless window, in the Windows order.
 * @returns Button group.
 */
function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    window.yzo?.isMaximized().then(setMaximized);
    return window.yzo?.onMaximized(setMaximized);
  }, []);
  if (!window.yzo) return null;
  return (
    <div className="window-controls">
      <button title={t("window.minimize")} onClick={() => window.yzo?.windowControl("minimize")}>
        <Icon name="minimize" />
      </button>
      <button title={maximized ? t("window.restore") : t("window.maximize")} onClick={() => window.yzo?.windowControl("maximize")}>
        <Icon name={maximized ? "restore" : "maximize"} />
      </button>
      <button className="window-close" title={t("common.close")} onClick={() => window.yzo?.windowControl("close")}>
        <Icon name="close" />
      </button>
    </div>
  );
}

/**
 * Toggles the window's full screen; the arrows point inward while it is on, to leave it.
 * @returns Button.
 */
function FullScreenButton() {
  const [fullScreen, setFullScreen] = useState(false);
  useEffect(() => {
    window.yzo?.isFullScreen().then(setFullScreen);
    return window.yzo?.onFullScreen(setFullScreen);
  }, []);
  return (
    <button title={fullScreen ? t("topbar.exitFullscreen") : t("topbar.fullscreen")} onClick={() => window.yzo?.windowControl("fullscreen")}>
      <Icon name={fullScreen ? "exitFullscreen" : "fullscreen"} />
    </button>
  );
}

/** Approximate width of the browser menu, so it opens aligned on the "…" button's right edge. */
const BROWSER_MENU_WIDTH = 300;
/** Where "Help and feedback" leads: the project's issue tracker. */
const HELP_URL = "https://github.com/behsse/yzo-browser/issues";

/**
 * Zoom shown in the browser menu, "110 %"; "100 %" when unknown.
 * @param factor Zoom factor from the page.
 * @returns Label.
 */
function zoomLabel(factor: unknown): string {
  return `${Math.round((typeof factor === "number" ? factor : 1) * 100)} %`;
}

/** Distance the pointer must travel, button held, before a press on the floating top bar moves the window. */
const DRAG_THRESHOLD_PX = 3;

/**
 * Press on the floating top bar's background (not a button): once the pointer starts moving, Windows
 * takes over and moves the window like from its title bar, restoring it first when it is maximized.
 * Waiting for the movement keeps plain clicks and double-clicks (maximize) working.
 * @param event Pointer press on the bar.
 */
function startWindowDrag(event: ReactPointerEvent<HTMLElement>) {
  if (event.button !== 0 || (event.target as HTMLElement).closest("button, browser-action-list")) return;
  const { screenX: startX, screenY: startY } = event;
  const move = (e: PointerEvent) => {
    if (e.buttons !== 1) return stop();
    if (Math.hypot(e.screenX - startX, e.screenY - startY) < DRAG_THRESHOLD_PX) return;
    stop();
    window.yzo?.windowDrag();
  };
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
}

/**
 * Arc-style top bar spanning the window: logo (app menu), sidebar toggle and navigation on the left,
 * the current site in the middle, extensions, split view and window controls on the right. The bar
 * is the window's drag region; only its buttons opt out.
 * @param props.floating True for the bar shown over the pages while the top bar is hidden: no drag region
 *   there (they do not work while the UI is above the pages), a press moves the window instead.
 * @returns Top bar element.
 */
export function TopBar({ floating = false }: { floating?: boolean }) {
  const { state, dispatch } = useStore();
  const ui = useUi();
  const sync = useSync();
  const host = useViewHost();
  const selection = state.window.selection[state.window.focusedSpaceId];
  const focusedId = selection?.focusedTabId ?? null;
  const focusedTab = focusedId ? state.items[focusedId] : undefined;
  const url = isTab(focusedTab) ? focusedTab.data.url : "";
  const actions = useExtensionActions();
  const pinned = state.settings.pinnedExtensions ?? [];
  const pinnedActions = pinned.filter((id) => actions.some((action) => action.id === id));
  const downloading = useDownloads().some((entry) => entry.state === "progressing" && !entry.paused);

  // Arc-style app menu behind the logo: new tab / window, updates, account at the bottom.
  const openAppMenu = (anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const account: MenuEntry = sync.status?.signedIn
      ? { icon: "user", label: t("appMenu.account", { email: sync.status.email ?? "" }), onSelect: () => ui.openAccount() }
      : { icon: "user", label: t("account.signIn"), onSelect: () => ui.openAccount("signIn") };
    const importArc: MenuEntry = {
      icon: "archive",
      label: t("appMenu.importArc"),
      onSelect: async () => {
        const result = await window.yzo?.importArc();
        if (!result || result.status === "cancelled") return;
        if (result.status === "notFound" || !result.data) return ui.showToast(t("arcImport.notFound"));
        dispatch({ type: "importArc", data: result.data, now: Date.now() });
        ui.showToast(t("arcImport.done", { spaces: result.data.spaces.length, extensions: result.extensions ?? 0 }));
      },
    };
    const checkUpdates: MenuEntry = { icon: "sync", label: t("appMenu.checkUpdates"), onSelect: () => void checkForUpdatesWithToasts(ui.showToast) };
    const settings: MenuEntry = {
      icon: "settings",
      label: t("appMenu.settings"),
      onSelect: () => dispatch({ type: "createTab", url: settingsUrl(), title: t("settings.title"), target: "today", activate: true, now: Date.now() }),
    };
    ui.openMenu({
      x: rect.left,
      y: rect.bottom + 4,
      entries: [
        { icon: "tab", label: t("appMenu.newTab"), hint: shortcutLabel("newTab"), onSelect: () => ui.runAction("newTab") },
        // Multi-window is not built yet: shown so the menu matches Arc, but disabled.
        { icon: "restore", label: t("appMenu.newWindow"), hint: "Ctrl+N", disabled: true, onSelect: () => {} },
        "separator",
        // A private instance keeps nothing: no import into it, no account.
        settings,
        "separator",
        ...(IS_PRIVATE ? [] : [importArc, "separator" as const]),
        checkUpdates,
        ...(IS_PRIVATE ? [] : ["separator" as const, account]),
      ],
    });
  };

  // Browser menu behind the "…" button, like Brave's (same look as the logo's menu): account, windows,
  // downloads and extensions, print and save, zoom of the page, settings, developer tools, help, quit.
  const openBrowserMenu = async (anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    // Print, save and zoom act on a web page (not on Yzo's own pages).
    const pageTab = url && !isInternalUrl(url) ? focusedId : null;
    const zoom = pageTab ? await tabCommand(pageTab, "zoom", "get") : null;
    const fullScreen = Boolean(await window.yzo?.isFullScreen());
    const openPage = (target: string, title: string) =>
      dispatch({ type: "createTab", url: target, title, target: "today", activate: true, now: Date.now() });
    const account: MenuEntry = sync.status?.signedIn
      ? { icon: "user", label: t("mainMenu.syncedAs", { email: sync.status.email ?? "" }), onSelect: () => ui.openAccount() }
      : { icon: "user", label: t("mainMenu.syncPitch"), hint: t("mainMenu.signIn"), onSelect: () => ui.openAccount("signIn") };
    ui.openMenu({
      x: rect.right - BROWSER_MENU_WIDTH,
      y: rect.bottom + 4,
      entries: [
        // A private window has no account.
        ...(IS_PRIVATE ? [] : [account, "separator" as const]),
        { icon: "tab", label: t("appMenu.newTab"), hint: shortcutLabel("newTab"), onSelect: () => ui.runAction("newTab") },
        // Multi-window is not built yet: shown like in the logo's menu, but disabled.
        { icon: "restore", label: t("appMenu.newWindow"), hint: "Ctrl+N", disabled: true, onSelect: () => {} },
        { icon: "incognito", label: t("mainMenu.newPrivateWindow"), hint: shortcutLabel("privateWindow"), onSelect: () => ui.runAction("privateWindow") },
        "separator",
        { icon: "download", label: t("downloads.title"), hint: shortcutLabel("downloads"), onSelect: () => ui.runAction("downloads") },
        { icon: "extensions", label: t("extensions.title"), onSelect: () => openPage(EXTENSIONS_URL, t("extensions.title")) },
        "separator",
        { icon: "print", label: t("mainMenu.print"), hint: shortcutLabel("print"), disabled: !pageTab, onSelect: () => ui.runAction("print") },
        { icon: "save", label: t("mainMenu.savePage"), disabled: !pageTab, onSelect: () => void tabCommand(pageTab, "savePage") },
        "separator",
        {
          icon: "zoom",
          label: t("mainMenu.zoom"),
          disabled: !pageTab,
          zoom: {
            value: zoomLabel(zoom),
            fullScreen,
            onAction: async (action) => {
              if (action === "fullscreen") {
                window.yzo?.windowControl("fullscreen");
                return null;
              }
              return zoomLabel(await tabCommand(pageTab, "zoom", action));
            },
          },
          onSelect: () => {},
        },
        "separator",
        { icon: "settings", label: t("settings.title"), onSelect: () => openPage(settingsUrl(), t("settings.title")) },
        { icon: "code", label: t("topbar.devTools"), hint: shortcutLabel("devTools"), disabled: !pageTab, onSelect: () => ui.runAction("devTools") },
        { icon: "help", label: t("mainMenu.help"), onSelect: () => openPage(HELP_URL, t("mainMenu.help")) },
        "separator",
        { icon: "close", label: t("mainMenu.quit"), hint: shortcutLabel("quit"), onSelect: () => ui.runAction("quit") },
      ],
    });
  };

  return (
    <header
      className={"topbar" + (floating ? "" : " drag")}
      onPointerDown={floating ? startWindowDrag : undefined}
      onDoubleClick={(event) => {
        if (floating && !(event.target as HTMLElement).closest("button")) window.yzo?.windowControl("maximize");
      }}
    >
      <div className="topbar-side topbar-left">
        {/* The Yzo logo opens the app menu, like Arc's. */}
        <button className="brand-mark" title={t("appMenu.title")} aria-haspopup="menu" onClick={(event) => openAppMenu(event.currentTarget)}>
          <BrandMark />
        </button>
        <button
          className={state.window.sidebarMode === "hidden" ? "" : "topbar-locked"}
          title={t("sidebar.toggleSidebar", { shortcut: shortcutLabel("toggleSidebar") })}
          onClick={() => ui.runAction("toggleSidebar")}
        >
          <Icon name="sidebar" />
        </button>
        <button
          className={state.window.topBarMode === "hidden" ? "" : "topbar-locked"}
          title={t("topbar.toggle", { shortcut: shortcutLabel("toggleTopBar") })}
          onClick={() => ui.runAction("toggleTopBar")}
        >
          <Icon name="topbar" />
        </button>
        <FullScreenButton />
        <span className="topbar-divider" />
        <button title={t("sidebar.back")} onClick={() => void tabCommand(focusedId, "back")}>
          <Icon name="back" />
        </button>
        <button title={t("sidebar.forward")} onClick={() => void tabCommand(focusedId, "forward")}>
          <Icon name="forward" />
        </button>
        <button title={t("sidebar.reload", { shortcut: shortcutLabel("reload") })} onClick={() => ui.runAction("reload")}>
          <Icon name="reload" />
        </button>
        {/* Opens a private instance; lit in one, like the locks. */}
        <button className={IS_PRIVATE ? "topbar-locked" : ""} title={t("topbar.private")} onClick={() => window.yzo?.openPrivateWindow()}>
          <Icon name="incognito" />
        </button>
      </div>

      <div className="topbar-address">
        {url && (
          <button title={t("sidebar.copyLink", { shortcut: shortcutLabel("copyUrl") })} onClick={() => ui.runAction("copyUrl")}>
            <Icon name="link" />
          </button>
        )}
        <button className="topbar-host" title={url || t("sidebar.searchOrUrl")} onClick={() => ui.openCommandBar(url ? "current" : "new")}>
          {url ? displayHost(url) : t("sidebar.searchOrUrl")}
        </button>
        {url && !isInternalUrl(url) && (
          <button
            title={t("topbar.siteMenu")}
            aria-haspopup="dialog"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              ui.openSitePanel({ left: rect.left, bottom: rect.bottom });
            }}
          >
            <Icon name="sliders" />
          </button>
        )}
      </div>

      <div className="topbar-side topbar-right">
        {/* Only the pinned extensions show here; the others live in the extensions panel. */}
        {pinnedActions.map((id) => (
          <ExtensionActionButton key={id} id={id} tabId={host.webContentsIdOf(focusedId) ?? -1} className="topbar-extension" />
        ))}
        <button
          title={t("sidebar.extensions")}
          aria-haspopup="dialog"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            ui.openExtensions({ right: rect.right, bottom: rect.bottom });
          }}
        >
          <Icon name="extensions" />
        </button>
        <button
          className={downloading ? "topbar-downloading" : ""}
          title={t("topbar.downloads")}
          aria-haspopup="dialog"
          data-downloads-button=""
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            ui.openDownloads({ right: rect.right, bottom: rect.bottom });
          }}
        >
          <Icon name="download" />
        </button>
        <button title={t("topbar.splitView", { shortcut: shortcutLabel("addSplit") })} onClick={() => ui.runAction("addSplit")}>
          <Icon name="split" />
        </button>
        <button title={t("topbar.more")} aria-haspopup="menu" onClick={(event) => void openBrowserMenu(event.currentTarget)}>
          <Icon name="more" />
        </button>
        <span className="topbar-divider" />
        <WindowControls />
      </div>
    </header>
  );
}
