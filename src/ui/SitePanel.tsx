import { useEffect, useState } from "react";
import type { SiteInfo } from "../env";
import { t } from "../lib/i18n";
import { siteSettingsUrl } from "../lib/internalPages";
import { shortcutLabel } from "../lib/shortcuts";
import { tabCommand } from "../lib/tabs";
import { displayHost } from "../lib/url";
import { useStore } from "../state/store";
import { isTab } from "../state/tree";
import { Icon } from "./Icon";
import { useUi } from "./UiContext";
import { useViewHost } from "./ViewHost";

const PANEL_WIDTH = 272;

/**
 * Site controls under the sliders next to the address, like Arc's: share the URL, the tracking
 * protection, and a footer with the connection, developer tools and more actions.
 * @param props.anchor Bottom-left corner of the sliders button, in window coordinates.
 * @param props.onClose Closes the panel.
 * @returns Panel overlay.
 */
export function SitePanel({ anchor, onClose }: { anchor: { left: number; bottom: number }; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const ui = useUi();
  const host = useViewHost();
  const tabId = state.window.selection[state.window.focusedSpaceId]?.focusedTabId ?? null;
  const tab = tabId ? state.items[tabId] : undefined;
  const url = isTab(tab) ? tab.data.url : "";
  const webContentsId = host.webContentsIdOf(tabId) ?? -1;
  const [info, setInfo] = useState<SiteInfo | null>(null);

  useEffect(() => {
    if (url) void window.yzo?.site.info(webContentsId, url).then(setInfo);
  }, [url, webContentsId]);

  const openTab = (target: string, title?: string) => dispatch({ type: "createTab", url: target, title, target: "today", activate: true, now: Date.now() });

  // Turning the shield on or off applies on the next load: reload the page.
  const toggleShield = async () => {
    if (!info || !(await window.yzo?.site.setShield(url, !info.shield.enabled))) return;
    setInfo({ ...info, shield: { enabled: !info.shield.enabled, blocked: 0 } });
    void tabCommand(tabId, "reload");
  };

  const clear = async (kind: "cache" | "cookies") => {
    if (await window.yzo?.site.clear(url, kind)) ui.showToast(t(kind === "cache" ? "site.cacheCleared" : "site.cookiesCleared", { host: displayHost(url) }));
  };

  // The other actions, in a menu above the panel's "…" button.
  const openMore = (button: HTMLElement) => {
    const rect = button.getBoundingClientRect();
    const siteHost = new URL(url).host;
    ui.openMenu({
      x: rect.left,
      y: rect.bottom + 4,
      entries: [
        { icon: "trash", label: t("site.clearCache"), onSelect: () => void clear("cache") },
        { icon: "trash", label: t("site.clearCookies"), onSelect: () => void clear("cookies") },
        "separator",
        {
          icon: "settings",
          label: t("site.allSettings"),
          onSelect: () => {
            onClose();
            openTab(siteSettingsUrl(siteHost), t("siteSettings.title", { host: siteHost }));
          },
        },
      ],
    });
  };

  const left = Math.max(8, Math.min(anchor.left - PANEL_WIDTH / 2 + 14, window.innerWidth - PANEL_WIDTH - 8));

  return (
    <div className="popover-layer" onMouseDown={onClose}>
      <div
        className="site-panel"
        style={{ top: anchor.bottom + 6, left, width: PANEL_WIDTH }}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label={t("topbar.siteMenu")}
      >
        <button
          className="site-share"
          title={`${t("site.share")} (${shortcutLabel("copyUrl")})`}
          onClick={() => {
            ui.runAction("copyUrl");
            onClose();
          }}
        >
          <Icon name="share" /> {t("site.share")}
        </button>

        <hr />
        <h3>{t("site.settingsHeading")}</h3>
        <button className="site-setting" disabled={!info} onClick={() => void toggleShield()}>
          <span className={"site-setting-icon" + (info?.shield.enabled ? " site-setting-icon-on" : "")}>
            <Icon name="shield" />
          </span>
          <span className="site-setting-text">
            <span>{t("site.shieldTitle")}</span>
            <span className="site-setting-detail">
              {info?.shield.enabled ? t("site.shieldOnDetail", { count: info.shield.blocked }) : t("site.shieldOffDetail")}
            </span>
          </span>
        </button>

        <hr />
        <footer className="site-footer">
          <button
            className="site-pill"
            disabled={!info?.certificate}
            title={info?.certificate ? t("siteSettings.viewCertificate") : undefined}
            onClick={async () => {
              onClose();
              if (!(await window.yzo?.site.showCertificate(new URL(url).hostname))) ui.showToast(t("site.certificateUnavailable"));
            }}
          >
            <Icon name={info?.secure ? "lock" : "unlock"} /> {info?.secure ? t("site.secure") : t("site.notSecure")}
          </button>
          <button
            className="site-pill"
            title={`${t("topbar.devTools")} (${shortcutLabel("devTools")})`}
            onClick={() => {
              onClose();
              ui.runAction("devTools");
            }}
          >
            <Icon name="code" />
          </button>
          <span className="site-footer-spacer" />
          <button className="site-pill" title={t("site.more")} aria-haspopup="menu" onClick={(event) => openMore(event.currentTarget)}>
            <Icon name="more" />
          </button>
        </footer>
      </div>
    </div>
  );
}
