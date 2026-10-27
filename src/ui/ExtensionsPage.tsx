import { useCallback, useEffect, useMemo, useState } from "react";
import type { InstalledExtension } from "../env";
import { t } from "../lib/i18n";
import { EXTENSIONS_URL, extensionDetailsUrl } from "../lib/internalPages";
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
  const { dispatch } = useStore();
  const ui = useUi();
  const [list, reload] = useInstalledExtensions();
  const [query, setQuery] = useState("");

  const openTab = (url: string) => dispatch({ type: "createTab", url, target: "today", activate: true, now: Date.now() });

  const setEnabled = async (extension: InstalledExtension, enabled: boolean) => {
    await window.yzo?.setExtensionEnabled(extension.id, enabled);
    reload();
  };

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

  const toggle = (extension: InstalledExtension) => (
    <input
      type="checkbox"
      className="switch"
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
            <button className="ext-back" onClick={() => navigate(EXTENSIONS_URL)}>
              <Icon name="back" /> {t("extensions.title")}
            </button>
            {list && !details && <p className="ext-empty">{t("extensionsPage.notFound")}</p>}
            {details && (
              <section className="ext-details">
                <header className="ext-details-header">
                  <ExtensionIcon extension={details} />
                  <h2>{details.name}</h2>
                  <span className="ext-state">{details.enabled ? t("extensionsPage.enabled") : t("extensionsPage.disabled")}</span>
                  {toggle(details)}
                </header>
                <dl>
                  <dt>{t("extensionsPage.description")}</dt>
                  <dd>{details.description || "—"}</dd>
                  <dt>{t("extensionsPage.version")}</dt>
                  <dd>{details.version}</dd>
                  <dt>{t("extensionsPage.id")}</dt>
                  <dd className="ext-mono">{details.id}</dd>
                  <dt>{t("extensionsPage.permissions")}</dt>
                  <dd>
                    {details.permissions.length ? (
                      <ul>
                        {details.permissions.map((permission) => (
                          <li key={permission}>{permission}</li>
                        ))}
                      </ul>
                    ) : (
                      t("extensionsPage.noPermissions")
                    )}
                  </dd>
                </dl>
                <div className="ext-actions">
                  {details.optionsUrl && (
                    <button className="ext-pill" onClick={() => openTab(details.optionsUrl!)}>
                      {t("extensionsPage.options")}
                    </button>
                  )}
                  {details.storeUrl && (
                    <button className="ext-pill" onClick={() => openTab(details.storeUrl!)}>
                      {t("extensionsPage.viewInStore")}
                    </button>
                  )}
                  <button className="ext-pill ext-pill-danger" onClick={() => void remove(details)}>
                    {t("extensionsPage.remove")}
                  </button>
                </div>
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
                    <button className="ext-pill" onClick={() => void remove(extension)}>
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
