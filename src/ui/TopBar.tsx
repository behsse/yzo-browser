import { useEffect, useState } from "react";
import { t } from "../lib/i18n";
import { shortcutLabel } from "../lib/shortcuts";
import { PARTITION as TABS_PARTITION, tabCommand } from "../lib/tabs";
import { displayHost } from "../lib/url";
import { useStore } from "../state/store";
import { isTab } from "../state/tree";
import { useSync } from "../sync/SyncProvider";
import { Icon } from "./Icon";
import { useUi, type MenuEntry } from "./UiContext";
import { useViewHost } from "./ViewHost";

const CHROME_WEB_STORE_URL = "https://chromewebstore.google.com/category/extensions";

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
 * Arc-style top bar spanning the window: logo (app menu), sidebar toggle and navigation on the left,
 * the current site in the middle, extensions, split view and window controls on the right. The bar
 * is the window's drag region; only its buttons opt out.
 * @returns Top bar element.
 */
export function TopBar() {
  const { state, dispatch } = useStore();
  const ui = useUi();
  const sync = useSync();
  const host = useViewHost();
  const selection = state.window.selection[state.window.focusedSpaceId];
  const focusedId = selection?.focusedTabId ?? null;
  const focusedTab = focusedId ? state.items[focusedId] : undefined;
  const url = isTab(focusedTab) ? focusedTab.data.url : "";

  // Arc-style app menu behind the logo: new tab / window, updates, account at the bottom.
  const openAppMenu = (anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const account: MenuEntry = sync.status?.signedIn
      ? { icon: "user", label: t("appMenu.account", { email: sync.status.email ?? "" }), onSelect: () => ui.openAccount() }
      : { icon: "user", label: t("account.signIn"), onSelect: () => ui.openAccount("signIn") };
    ui.openMenu({
      x: rect.left,
      y: rect.bottom + 4,
      entries: [
        { icon: "tab", label: t("appMenu.newTab"), hint: shortcutLabel("newTab"), onSelect: () => ui.runAction("newTab") },
        // Multi-window is not built yet: shown so the menu matches Arc, but disabled.
        { icon: "restore", label: t("appMenu.newWindow"), hint: "Ctrl+N", disabled: true, onSelect: () => {} },
        "separator",
        {
          icon: "sync",
          label: t("appMenu.checkUpdates"),
          onSelect: async () => {
            ui.showToast(t("updates.checking"));
            const result = await window.yzo?.checkForUpdates();
            const status = result?.status ?? "dev";
            ui.showToast(t(`updates.${status}`, { version: result?.version ?? "" }));
          },
        },
        "separator",
        account,
      ],
    });
  };

  // Site controls behind the sliders icon, next to the address.
  const openSiteMenu = (anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    ui.openMenu({
      x: rect.left,
      y: rect.bottom + 4,
      entries: [
        { icon: "copy", label: t("common.copyLink"), hint: shortcutLabel("copyUrl"), onSelect: () => ui.runAction("copyUrl") },
        { icon: "reload", label: t("page.reload"), hint: shortcutLabel("reload"), onSelect: () => ui.runAction("reload") },
        "separator",
        { icon: "settings", label: t("topbar.devTools"), hint: shortcutLabel("devTools"), onSelect: () => ui.runAction("devTools") },
      ],
    });
  };

  // Lists installed extensions with their actions, plus the way to add more.
  const openExtensionsMenu = async (anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const installed = (await window.yzo?.listExtensions()) ?? [];
    const openTab = (target: string) => dispatch({ type: "createTab", url: target, target: "today", activate: true, now: Date.now() });
    const entries: (MenuEntry | "separator")[] = installed.length
      ? installed.flatMap((ext) => [
          { label: `${ext.name} ${ext.version}`, disabled: true, onSelect: () => {} },
          ...(ext.optionsUrl ? [{ label: t("extensions.options"), onSelect: () => openTab(ext.optionsUrl!) }] : []),
          {
            label: t("common.delete"),
            danger: true,
            onSelect: async () => {
              const removed = await window.yzo?.uninstallExtension(ext.id);
              ui.showToast(removed ? t("extensions.removed", { name: ext.name }) : t("extensions.removeFailed"));
            },
          },
          "separator" as const,
        ])
      : [{ label: t("extensions.none"), disabled: true, onSelect: () => {} }, "separator" as const];
    entries.push({ label: t("extensions.addFromStore"), onSelect: () => openTab(CHROME_WEB_STORE_URL) });
    // Right-aligned under the button, since it sits at the right edge of the window.
    ui.openMenu({ x: rect.right - 240, y: rect.bottom + 4, entries });
  };

  return (
    <header className="topbar drag">
      <div className="topbar-side topbar-left">
        {/* Placeholder mark until the real logo exists; opens the app menu, like Arc's logo. */}
        <button className="brand-mark" title={t("appMenu.title")} aria-haspopup="menu" onClick={(event) => openAppMenu(event.currentTarget)}>
          <Icon name="brand" />
        </button>
        <button title={t("sidebar.toggleSidebar", { shortcut: shortcutLabel("toggleSidebar") })} onClick={() => ui.runAction("toggleSidebar")}>
          <Icon name="sidebar" />
        </button>
        <button title={t("sidebar.back")} onClick={() => void tabCommand(focusedId, "back")}>
          <Icon name="back" />
        </button>
        <button title={t("sidebar.forward")} onClick={() => void tabCommand(focusedId, "forward")}>
          <Icon name="forward" />
        </button>
        <button title={t("sidebar.reload", { shortcut: shortcutLabel("reload") })} onClick={() => ui.runAction("reload")}>
          <Icon name="reload" />
        </button>
      </div>

      <div className="topbar-address">
        {url && (
          <button className="topbar-icon" title={t("sidebar.copyLink", { shortcut: shortcutLabel("copyUrl") })} onClick={() => ui.runAction("copyUrl")}>
            <Icon name="link" size={16} />
          </button>
        )}
        <button className="topbar-host" title={url || t("sidebar.searchOrUrl")} onClick={() => ui.openCommandBar(url ? "current" : "new")}>
          {url ? displayHost(url) : t("sidebar.searchOrUrl")}
        </button>
        {url && (
          <button className="topbar-icon" title={t("topbar.siteMenu")} aria-haspopup="menu" onClick={(event) => openSiteMenu(event.currentTarget)}>
            <Icon name="sliders" size={16} />
          </button>
        )}
      </div>

      <div className="topbar-side topbar-right">
        {/* Extension action buttons (icons, popups, badges) rendered by electron-chrome-extensions. */}
        {window.yzo && <browser-action-list className="extension-actions" partition={TABS_PARTITION} alignment="bottom left" tab={host.webContentsIdOf(focusedId)} />}
        <button title={t("sidebar.extensions")} onClick={(event) => void openExtensionsMenu(event.currentTarget)}>
          <Icon name="extensions" />
        </button>
        <button title={t("topbar.splitView", { shortcut: shortcutLabel("addSplit") })} onClick={() => ui.runAction("addSplit")}>
          <Icon name="split" />
        </button>
        <span className="topbar-divider" />
        <WindowControls />
      </div>
    </header>
  );
}
