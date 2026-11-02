import { useEffect, useState, type ReactElement } from "react";
import type { DownloadSettings } from "../env";
import { THRESHOLDS } from "../lib/autoArchive";
import { t } from "../lib/i18n";
import { EXTENSIONS_URL, SETTINGS_SECTIONS, settingsUrl, type SettingsSection } from "../lib/internalPages";
import { IS_PRIVATE } from "../lib/privateMode";
import { checkForUpdatesWithToasts, updateMessage, useUpdateState } from "../lib/updates";
import { useStore } from "../state/store";
import type { AutoArchiveThreshold, SearchEngine } from "../state/types";
import { useSync } from "../sync/SyncProvider";
import { Icon, type IconName } from "./Icon";
import { useUi } from "./UiContext";

/** Icon of each section in the left menu. */
const SECTION_ICONS: Record<SettingsSection, IconName> = {
  account: "user",
  search: "search",
  tabs: "archive",
  downloads: "download",
  about: "globe",
};

/**
 * Account section: the Yzo account and its sync, managed in the account panel.
 * @returns Section content.
 */
function AccountSection() {
  const ui = useUi();
  const sync = useSync();
  const signedIn = Boolean(sync.status?.signedIn);
  return (
    <div className="settings-card">
      <div className="ext-row ext-row-first">
        <span className="ext-row-stack-inline">
          <span>{signedIn ? t("settings.signedInAs", { email: sync.status?.email ?? "" }) : t("settings.signedOut")}</span>
          <span className="ext-row-value">{t("settings.accountNote")}</span>
        </span>
        <button className="ext-pill" disabled={IS_PRIVATE} onClick={() => ui.openAccount(signedIn ? undefined : "signIn")}>
          {signedIn ? t("settings.manageAccount") : t("account.signIn")}
        </button>
      </div>
    </div>
  );
}

/**
 * Search engine section.
 * @returns Section content.
 */
function SearchSection() {
  const { state, dispatch } = useStore();
  return (
    <div className="settings-card">
      <label className="ext-row ext-row-first">
        <span>{t("archive.searchEngine")}</span>
        <select
          className="settings-select"
          value={state.settings.searchEngine}
          onChange={(event) => dispatch({ type: "updateSettings", settings: { searchEngine: event.target.value as SearchEngine } })}
        >
          <option value="google">Google</option>
          <option value="duckduckgo">DuckDuckGo</option>
          <option value="bing">Bing</option>
        </select>
      </label>
    </div>
  );
}

/**
 * Tabs section: auto-archiving of idle tabs.
 * @returns Section content.
 */
function TabsSection() {
  const { state, dispatch } = useStore();
  return (
    <div className="settings-card">
      <label className="ext-row ext-row-first">
        <span>{t("archive.autoArchiveAfter")}</span>
        <select
          className="settings-select"
          value={state.settings.autoArchive}
          onChange={(event) => dispatch({ type: "updateSettings", settings: { autoArchive: event.target.value as AutoArchiveThreshold } })}
        >
          {THRESHOLDS.map((value) => (
            <option key={value} value={value}>
              {t(`autoArchive.${value}`)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/**
 * Downloads section, like Arc's: the folder files go to, and whether to ask each time.
 * @returns Section content.
 */
function DownloadsSection() {
  const [settings, setSettings] = useState<DownloadSettings | null>(null);
  useEffect(() => {
    void window.yzo?.downloads.getSettings().then(setSettings);
  }, []);
  const update = async (change: { ask?: boolean; chooseDirectory?: boolean }) => {
    const next = await window.yzo?.downloads.updateSettings(change);
    if (next) setSettings(next);
  };
  return (
    <div className="settings-card">
      <div className="ext-row ext-row-first">
        <span className="ext-row-stack-inline">
          <span>{t("settings.downloadLocation")}</span>
          <span className="ext-row-value">{settings?.directory ?? ""}</span>
        </span>
        <button className="ext-pill" disabled={!settings || settings.readOnly} onClick={() => void update({ chooseDirectory: true })}>
          {t("settings.change")}
        </button>
      </div>
      <label className="ext-row">
        <span>{t("settings.askWhere")}</span>
        <input
          type="checkbox"
          className="switch"
          disabled={!settings || settings.readOnly}
          checked={settings?.ask ?? false}
          onChange={(event) => void update({ ask: event.target.checked })}
        />
      </label>
    </div>
  );
}

/**
 * About section: version, where the update stands (checking, download progress, ready) and the button
 * that fits: check for updates, or restart on the downloaded one.
 * @returns Section content.
 */
function AboutSection() {
  const ui = useUi();
  const update = useUpdateState();
  const [version, setVersion] = useState("");
  useEffect(() => {
    void window.yzo?.appVersion().then(setVersion);
  }, []);
  const status = update?.status;
  const message = update && status !== "idle" ? updateMessage(update) : null;
  return (
    <div className="settings-card">
      <div className="ext-row ext-row-first">
        <span className="ext-row-stack-inline">
          <span>Yzo</span>
          <span className="ext-row-value">{t("settings.version", { version })}</span>
        </span>
        {status === "ready" ? (
          <button className="ext-pill primary" onClick={() => void window.yzo?.updates.install()}>
            {t("updates.restart")}
          </button>
        ) : status === "available" ? (
          <button className="ext-pill primary" onClick={() => void window.yzo?.updates.download()}>
            {t("updates.download", { version: update!.version })}
          </button>
        ) : (
          <button className="ext-pill" disabled={status === "checking" || status === "downloading"} onClick={() => void checkForUpdatesWithToasts(ui.showToast)}>
            {t("appMenu.checkUpdates")}
          </button>
        )}
      </div>
      {message && (
        <div className="ext-row update-status">
          <span className={status === "error" ? "danger" : "ext-row-value"}>
            {message}
            {status === "ready" && `. ${t("updates.installOnQuit")}`}
          </span>
          {status === "downloading" && (
            <div className="update-progress" role="progressbar" aria-valuenow={update!.percent} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${update!.percent}%` }} />
            </div>
          )}
        </div>
      )}
      <label className="ext-row">
        <span className="ext-row-stack-inline">
          <span>{t("updates.autoDownload")}</span>
          <span className="ext-row-value">{t("updates.autoDownloadHint")}</span>
        </span>
        <input
          type="checkbox"
          className="switch"
          disabled={!update || IS_PRIVATE}
          checked={update?.autoDownload ?? true}
          onChange={(event) => void window.yzo?.updates.setAutoDownload(event.target.checked)}
        />
      </label>
    </div>
  );
}

const SECTION_CONTENT: Record<SettingsSection, () => ReactElement> = {
  account: AccountSection,
  search: SearchSection,
  tabs: TabsSection,
  downloads: DownloadsSection,
  about: AboutSection,
};

/**
 * Yzo's settings (yzo://settings/<section>), like Arc's: sections on the left, the chosen one on the
 * right, and a link to the extensions page.
 * @param props.section Section shown.
 * @param props.navigate Changes the tab's address.
 * @returns Page content.
 */
export function SettingsPage({ section, navigate }: { section: SettingsSection; navigate: (url: string) => void }) {
  const { dispatch } = useStore();
  const Content = SECTION_CONTENT[section];
  return (
    <div className="ext-page">
      <nav className="ext-nav">
        <h1>
          <Icon name="settings" /> {t("settings.title")}
        </h1>
        {SETTINGS_SECTIONS.filter((s) => s !== "about").map((s) => (
          <button key={s} className={"ext-nav-item" + (s === section ? " ext-nav-active" : "")} onClick={() => navigate(settingsUrl(s))}>
            <Icon name={SECTION_ICONS[s]} /> {t(`settings.section.${s}`)}
          </button>
        ))}
        <hr />
        <button
          className="ext-nav-item"
          onClick={() => dispatch({ type: "createTab", url: EXTENSIONS_URL, title: t("extensions.title"), target: "today", activate: true, now: Date.now() })}
        >
          <Icon name="extensions" /> {t("extensions.title")} <Icon name="external" size={14} />
        </button>
        <button className={"ext-nav-item" + (section === "about" ? " ext-nav-active" : "")} onClick={() => navigate(settingsUrl("about"))}>
          <Icon name={SECTION_ICONS.about} /> {t("settings.section.about")}
        </button>
      </nav>
      <main className="ext-main">
        <h2 className="settings-heading">{t(`settings.section.${section}`)}</h2>
        <Content />
      </main>
    </div>
  );
}
