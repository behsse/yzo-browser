import { useCallback, useEffect, useState } from "react";
import type { SiteInfo } from "../env";
import { t } from "../lib/i18n";
import { parseInternalUrl } from "../lib/internalPages";
import { DownloadsPage } from "./DownloadsPage";
import { ExtensionsPage } from "./ExtensionsPage";
import { Icon } from "./Icon";
import { SettingsPage } from "./SettingsPage";
import { useUi } from "./UiContext";

/** Permissions Yzo grants every site (electron/main.cjs ALLOWED_PERMISSIONS); the rest is refused. */
const ALLOWED_PERMISSION_KEYS = ["siteSettings.permFullscreen", "siteSettings.permClipboard", "siteSettings.permPointerLock", "siteSettings.permDrm"] as const;

/**
 * Settings of one site (yzo://settings/sites/<host>): shield, connection, permissions, data.
 * @param props.host Site host, with its port if any.
 * @returns Page content.
 */
function SiteSettingsPage({ host }: { host: string }) {
  const ui = useUi();
  const [info, setInfo] = useState<SiteInfo | null>(null);
  const siteUrl = `https://${host}/`;
  const hostname = host.replace(/:\d+$/, "");

  const refresh = useCallback(() => {
    void window.yzo?.site.info(-1, siteUrl).then(setInfo);
  }, [siteUrl]);
  useEffect(refresh, [refresh]);

  const toggleShield = async () => {
    if (!info) return;
    await window.yzo?.site.setShield(siteUrl, !info.shield.enabled);
    refresh();
  };

  // The page does not know whether the site was opened over http or https: clear both origins.
  const clear = async (kind: "cache" | "cookies") => {
    await Promise.all([window.yzo?.site.clear(siteUrl, kind), window.yzo?.site.clear(`http://${host}/`, kind)]);
    ui.showToast(t(kind === "cache" ? "site.cacheCleared" : "site.cookiesCleared", { host }));
  };

  return (
    <div className="internal-page">
      <header className="internal-header">
        <p className="muted">{t("siteSettings.heading")}</p>
        <h1>{host}</h1>
      </header>

      <section className="internal-section">
        <h2>{t("siteSettings.shield")}</h2>
        <label className="internal-row">
          <span>
            <Icon name="shield" /> {t("siteSettings.shieldLabel")}
          </span>
          <input type="checkbox" className="switch" checked={info?.shield.enabled ?? false} disabled={!info} onChange={() => void toggleShield()} />
        </label>
      </section>

      <section className="internal-section">
        <h2>{t("siteSettings.connection")}</h2>
        <div className="internal-row">
          <span>
            <Icon name={info?.certificate ? "lock" : "unlock"} /> {t(info?.certificate ? "siteSettings.certificateKnown" : "siteSettings.certificateUnknown")}
          </span>
          {info?.certificate && (
            <button
              onClick={async () => {
                if (!(await window.yzo?.site.showCertificate(hostname))) ui.showToast(t("site.certificateUnavailable"));
              }}
            >
              {t("siteSettings.viewCertificate")}
            </button>
          )}
        </div>
      </section>

      <section className="internal-section">
        <h2>{t("siteSettings.permissions")}</h2>
        {ALLOWED_PERMISSION_KEYS.map((key) => (
          <div key={key} className="internal-row">
            <span>{t(key)}</span>
            <span className="muted">{t("siteSettings.allowed")}</span>
          </div>
        ))}
        <div className="internal-row">
          <span>{t("siteSettings.permOthers")}</span>
          <span className="muted">{t("siteSettings.blocked")}</span>
        </div>
      </section>

      <section className="internal-section">
        <h2>{t("siteSettings.data")}</h2>
        <div className="internal-actions">
          <button onClick={() => void clear("cookies")}>{t("site.clearCookies")}</button>
          <button onClick={() => void clear("cache")}>{t("site.clearCache")}</button>
        </div>
      </section>
    </div>
  );
}

/**
 * One of Yzo's own pages, drawn in a tab's slot.
 * @param props.url yzo:// address of the tab.
 * @param props.navigate Changes the tab's address.
 * @returns Page content.
 */
export function InternalPage({ url, navigate }: { url: string; navigate: (url: string) => void }) {
  const page = parseInternalUrl(url);
  if (page.kind === "siteSettings") return <SiteSettingsPage key={page.host} host={page.host} />;
  if (page.kind === "extensions") return <ExtensionsPage navigate={navigate} />;
  if (page.kind === "extensionDetails") return <ExtensionsPage detailsId={page.id} navigate={navigate} />;
  if (page.kind === "settings") return <SettingsPage section={page.section} navigate={navigate} />;
  if (page.kind === "downloads") return <DownloadsPage />;
  return (
    <div className="internal-page">
      <p className="muted">{t("siteSettings.notFound")}</p>
    </div>
  );
}
