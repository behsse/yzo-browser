import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { t } from "../lib/i18n";
import { isInternalUrl, siteSettingsUrl } from "../lib/internalPages";
import { IS_PRIVATE } from "../lib/privateMode";
import { shortcutLabel } from "../lib/shortcuts";
import { tabCommand } from "../lib/tabs";
import { displayHost } from "../lib/url";
import { useStore } from "../state/store";
import { isTab } from "../state/tree";
import { useSync } from "../sync/SyncProvider";
import { ExtensionActionButton, useExtensionActions } from "./extensionActions";
import { BrandMark, Icon } from "./Icon";
import { useUi, type MenuEntry } from "./UiContext";
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
  const webContentsId = host.webContentsIdOf(focusedId);

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
    const checkUpdates: MenuEntry = {
      icon: "sync",
      label: t("appMenu.checkUpdates"),
      onSelect: async () => {
        ui.showToast(t("updates.checking"));
        const result = await window.yzo?.checkForUpdates();
        const status = result?.status ?? "dev";
        ui.showToast(t(`updates.${status}`, { version: result?.version ?? "" }));
      },
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
        ...(IS_PRIVATE ? [] : [importArc, "separator" as const]),
        checkUpdates,
        ...(IS_PRIVATE ? [] : ["separator" as const, account]),
      ],
    });
  };

  // Site controls behind the sliders icon, next to the address: share, shield, connection, dev tools, more.
  const openSiteMenu = async (anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const position = { x: rect.left, y: rect.bottom + 4 };
    const pageUrl = url;
    const tabId = focusedId;
    const pageHost = displayHost(pageUrl);
    const info = await window.yzo?.site.info(webContentsId ?? -1, pageUrl);
    const shield: MenuEntry = info?.shield.enabled
      ? { icon: "shield", label: t("site.shieldOn", { count: info.shield.blocked }), onSelect: () => void setShield(pageUrl, tabId, false) }
      : { icon: "shield", label: t("site.shieldOff"), disabled: !info, onSelect: () => void setShield(pageUrl, tabId, true) };
    const connection: MenuEntry = info?.secure
      ? {
          icon: "lock",
          label: t("site.secure"),
          disabled: !info.certificate,
          onSelect: async () => {
            if (!(await window.yzo?.site.showCertificate(new URL(pageUrl).hostname))) ui.showToast(t("site.certificateUnavailable"));
          },
        }
      : { icon: "unlock", label: t("site.notSecure"), disabled: true, onSelect: () => {} };
    const clear = async (kind: "cache" | "cookies") => {
      if (await window.yzo?.site.clear(pageUrl, kind)) ui.showToast(t(kind === "cache" ? "site.cacheCleared" : "site.cookiesCleared", { host: pageHost }));
    };
    const more: MenuEntry = {
      icon: "more",
      label: t("site.more"),
      // The picked menu closes first; open the next one after it.
      onSelect: () =>
        window.setTimeout(() =>
          ui.openMenu({
            ...position,
            entries: [
              { icon: "trash", label: t("site.clearCache"), onSelect: () => void clear("cache") },
              { icon: "trash", label: t("site.clearCookies"), onSelect: () => void clear("cookies") },
              "separator",
              {
                icon: "settings",
                label: t("site.allSettings"),
                onSelect: () => {
                  const siteHost = new URL(pageUrl).host;
                  dispatch({ type: "createTab", url: siteSettingsUrl(siteHost), title: t("siteSettings.title", { host: siteHost }), target: "today", activate: true, now: Date.now() });
                },
              },
            ],
          }),
        ),
    };
    ui.openMenu({
      ...position,
      entries: [
        { icon: "share", label: t("site.share"), hint: shortcutLabel("copyUrl"), onSelect: () => ui.runAction("copyUrl") },
        "separator",
        shield,
        connection,
        "separator",
        { icon: "settings", label: t("topbar.devTools"), hint: shortcutLabel("devTools"), onSelect: () => ui.runAction("devTools") },
        more,
      ],
    });
  };

  // Turning the shield on or off for a site applies on the next load: reload the page.
  const setShield = async (pageUrl: string, tabId: string | null, enabled: boolean) => {
    if (await window.yzo?.site.setShield(pageUrl, enabled)) void tabCommand(tabId, "reload");
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
          <button title={t("topbar.siteMenu")} aria-haspopup="menu" onClick={(event) => void openSiteMenu(event.currentTarget)}>
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
        {/* Downloads and the menu are visual only for now. */}
        <button title={t("topbar.downloads")}>
          <Icon name="download" />
        </button>
        <button title={t("topbar.splitView", { shortcut: shortcutLabel("addSplit") })} onClick={() => ui.runAction("addSplit")}>
          <Icon name="split" />
        </button>
        <button title={t("topbar.more")} aria-haspopup="menu">
          <Icon name="more" />
        </button>
        <span className="topbar-divider" />
        <WindowControls />
      </div>
    </header>
  );
}
