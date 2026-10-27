import { useCallback, useEffect, useMemo, useState } from "react";
import type { InstalledExtension } from "../env";
import { t } from "../lib/i18n";
import { EXTENSIONS_URL, extensionDetailsUrl } from "../lib/internalPages";
import { IS_PRIVATE } from "../lib/privateMode";
import { useStore } from "../state/store";
import { Icon } from "./Icon";
import { useUi } from "./UiContext";

const CHROME_WEB_STORE_URL = "https://chromewebstore.google.com/category/extensions";

/**
 * Installed extensions, refreshed when the window gets the focus back (an install from the Web Store).
 * @returns The list (null while loading) and a reload function.
 */
function useInstalledExtensions(): [InstalledExtension[] | null, () => void] {
  const [list, setList] = useState<InstalledExtension[] | null>(null);
  const reload = useCallback(() => {
    void window.yzo?.listExtensions().then(setList);
  }, []);
  useEffect(() => {
    reload();
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [reload]);
  return [list, reload];
}

/**
 * Size in Ko / Mo (KB / MB), like Chrome's extension details.
 * @param bytes Size in bytes.
 * @returns Readable size.
 */
function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return t("extensionsPage.kilobytes", { size: Math.max(1, Math.round(bytes / 1024)) });
  return t("extensionsPage.megabytes", { size: (bytes / (1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 1 }) });
}

/**
 * Extension icon, or a puzzle piece when it has none.
 * @param props.extension Extension.
 * @returns Icon element.
 */
function ExtensionIcon({ extension }: { extension: InstalledExtension }) {
  if (extension.icon) return <img className="ext-icon" src={extension.icon} alt="" />;
  return (
    <span className="ext-icon">
      <Icon name="extensions" size={28} />
    </span>
  );
}

/**
 * Yzo's extension manager (yzo://extensions), like Brave's and Arc's: search, one card per
 * extension with details, removal and an on/off switch, and a details view (yzo://extensions/<id>).
 * @param props.detailsId Extension shown in the details view, if any.
 * @param props.navigate Changes the tab's address (to move between the list and the details).
 * @returns Page content.
 */
export function ExtensionsPage({ detailsId, navigate }: { detailsId?: string; navigate: (url: string) => void }) {
  const { state, dispatch } = useStore();
  const ui = useUi();
  const pinned = state.settings.pinnedExtensions ?? [];
  const [list, reload] = useInstalledExtensions();
  const [query, setQuery] = useState("");

  const openTab = (url: string) => dispatch({ type: "createTab", url, target: "today", activate: true, now: Date.now() });

  const setEnabled = async (extension: InstalledExtension, enabled: boolean) => {
    await window.yzo?.setExtensionEnabled(extension.id, enabled);
    reload();
  };

  // Same list as the pin in the extensions panel.
  const togglePin = (id: string, pin: boolean) =>
    dispatch({ type: "updateSettings", settings: { pinnedExtensions: pin ? [...pinned.filter((p) => p !== id), id] : pinned.filter((p) => p !== id) } });

  const remove = async (extension: InstalledExtension) => {
    if (!window.confirm(t("extensionsPage.confirmRemove", { name: extension.name }))) return;
    const removed = await window.yzo?.uninstallExtension(extension.id);
    ui.showToast(removed ? t("extensions.removed", { name: extension.name }) : t("extensions.removeFailed"));
    if (removed && detailsId) navigate(EXTENSIONS_URL);
    reload();
  };

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    return (list ?? []).filter((ext) => !words || `${ext.name} ${ext.description}`.toLowerCase().includes(words));
  }, [list, query]);

  const details = detailsId ? list?.find((ext) => ext.id === detailsId) : undefined;

  const allowPrivate = async (extension: InstalledExtension, allowed: boolean) => {
    await window.yzo?.setExtensionPrivateAllowed(extension.id, allowed);
    reload();
  };

  // A private window shows the extensions but their choices are made from a normal one.
  const toggle = (extension: InstalledExtension) => (
    <input
      type="checkbox"
      className="switch"
      disabled={IS_PRIVATE}
      checked={extension.enabled}
      title={t("extensionsPage.toggle", { name: extension.name })}
      aria-label={t("extensionsPage.toggle", { name: extension.name })}
      onChange={(event) => void setEnabled(extension, event.target.checked)}
    />
  );

  return (
    <div className="ext-page">
      <nav className="ext-nav">
        <h1>
          <Icon name="extensions" /> {t("extensions.title")}
        </h1>
        <button className="ext-nav-item ext-nav-active" onClick={() => navigate(EXTENSIONS_URL)}>
          <Icon name="extensions" /> {t("extensionsPage.mine")}
        </button>
        <hr />
        <p className="ext-discover">
          {t("extensionsPage.discover")}{" "}
          <button className="ext-link" onClick={() => openTab(CHROME_WEB_STORE_URL)}>
            {t("extensionsPage.store")}
          </button>
        </p>
      </nav>

      <main className="ext-main">
        {detailsId ? (
          <>
            {list && !details && <p className="ext-empty">{t("extensionsPage.notFound")}</p>}
            {details && (
              <section className="ext-details">
                <header className="ext-details-header">
                  <button className="ext-icon-button" title={t("extensions.title")} onClick={() => navigate(EXTENSIONS_URL)}>
                    <Icon name="back" />
                  </button>
                  <ExtensionIcon extension={details} />
                  <h2>{details.name}</h2>
                </header>
                <label className="ext-row ext-row-state">
                  <span>{details.enabled ? t("extensionsPage.enabled") : t("extensionsPage.disabled")}</span>
                  {toggle(details)}
                </label>
                <div className="ext-row ext-row-stack">
                  <span>{t("extensionsPage.description")}</span>
                  <span className="ext-row-value">{details.description || "—"}</span>
                </div>
                <div className="ext-row ext-row-stack">
                  <span>{t("extensionsPage.version")}</span>
                  <span className="ext-row-value">{details.version}</span>
                </div>
                <div className="ext-row ext-row-stack">
                  <span>{t("extensionsPage.size")}</span>
                  <span className="ext-row-value">{formatSize(details.size)}</span>
                </div>
                <div className="ext-row ext-row-stack">
                  <span>{t("extensionsPage.permissions")}</span>
                  {details.permissions.length ? (
                    <ul className="ext-row-value">
                      {details.permissions.map((permission) => (
                        <li key={permission}>{permission}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="ext-row-value">{t("extensionsPage.noPermissions")}</span>
                  )}
                </div>
                {/* Not built yet: kept here so the row is not forgotten. */}
                <div className="ext-row ext-row-soon" title={t("extensionsPage.soon")}>
                  <span>{t("extensionsPage.siteSettings")}</span>
                  <span className="ext-soon">{t("extensionsPage.soon")}</span>
                </div>
                {details.enabled && (
                  <label className="ext-row">
                    <span>{t("extensionsPage.pin")}</span>
                    <input
                      type="checkbox"
                      className="switch"
                      checked={pinned.includes(details.id)}
                      onChange={(event) => togglePin(details.id, event.target.checked)}
                    />
                  </label>
                )}
                <label className="ext-row">
                  <span className="ext-row-stack-inline">
                    <span>{t("extensionsPage.allowPrivate")}</span>
                    <span className="ext-row-value">{t("extensionsPage.allowPrivateWarning")}</span>
                  </span>
                  <input
                    type="checkbox"
                    className="switch"
                    disabled={IS_PRIVATE}
                    checked={details.privateAllowed}
                    onChange={(event) => void allowPrivate(details, event.target.checked)}
                  />
                </label>
                {details.optionsUrl && (
                  <button className="ext-row ext-row-link" onClick={() => openTab(details.optionsUrl!)}>
                    <span>{t("extensionsPage.options")}</span>
                    <Icon name="external" />
                  </button>
                )}
                {details.storeUrl && (
                  <button className="ext-row ext-row-link" onClick={() => openTab(details.storeUrl!)}>
                    <span>{t("extensionsPage.viewInStore")}</span>
                    <Icon name="external" />
                  </button>
                )}
                <div className="ext-row ext-row-stack">
                  <span>{t("extensionsPage.source")}</span>
                  <span className="ext-row-value">{details.storeUrl ? t("extensionsPage.sourceStore") : t("extensionsPage.sourceUnpacked")}</span>
                </div>
                <button className="ext-row ext-row-link" disabled={IS_PRIVATE} onClick={() => void remove(details)}>
                  <span>{t("extensionsPage.removeExtension")}</span>
                  <Icon name="chevron" />
                </button>
              </section>
            )}
          </>
        ) : (
          <>
            <label className="ext-search">
              <Icon name="search" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("extensionsPage.search")} />
            </label>
            <h2 className="ext-heading">{t("extensionsPage.all")}</h2>
            {IS_PRIVATE && <p className="ext-empty">{t("extensionsPage.privateReadOnly")}</p>}
            {list && !list.length && <p className="ext-empty">{t("extensionsPage.empty")}</p>}
            {list && list.length > 0 && !shown.length && <p className="ext-empty">{t("extensionsPage.noMatch", { query: query.trim() })}</p>}
            <div className="ext-grid">
              {shown.map((extension) => (
                <article key={extension.id} className={"ext-card" + (extension.enabled ? "" : " ext-card-off")}>
                  <div className="ext-card-body">
                    <ExtensionIcon extension={extension} />
                    <div>
                      <h3>{extension.name}</h3>
                      <p>{extension.description}</p>
                    </div>
                  </div>
                  <footer className="ext-card-footer">
                    <button className="ext-pill" onClick={() => navigate(extensionDetailsUrl(extension.id))}>
                      {t("extensionsPage.details")}
                    </button>
                    <button className="ext-pill" disabled={IS_PRIVATE} onClick={() => void remove(extension)}>
                      {t("extensionsPage.remove")}
                    </button>
                    <span className="ext-spacer" />
                    {toggle(extension)}
                  </footer>
                </article>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
