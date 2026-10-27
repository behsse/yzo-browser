import { useMemo, useState } from "react";
import { downloadProgress, downloadStatus, groupByDay } from "../lib/downloads";
import { t } from "../lib/i18n";
import { displayHost } from "../lib/url";
import { DownloadIcon, downloadAction } from "./DownloadsPanel";
import { Icon } from "./Icon";
import { useUi } from "./UiContext";
import { useDownloads } from "./useDownloads";

/**
 * Download history (yzo://downloads), like Brave's: search, "Clear all", downloads grouped by day,
 * each with its link, folder and removal; deleted files are struck through.
 * @returns Page content.
 */
export function DownloadsPage() {
  const ui = useUi();
  const entries = useDownloads();
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const words = query.trim().toLowerCase();
    return groupByDay(entries.filter((entry) => !words || `${entry.filename} ${entry.url}`.toLowerCase().includes(words)));
  }, [entries, query]);

  return (
    <div className="dl-page">
      <header className="dl-header">
        <h1>
          <Icon name="download" /> {t("downloads.title")}
        </h1>
        <label className="ext-search">
          <Icon name="search" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("downloads.search")} />
        </label>
        <button className="ext-pill" disabled={!entries.some((e) => e.state !== "progressing")} onClick={() => void window.yzo?.downloads.clear()}>
          {t("downloads.clearAll")}
        </button>
      </header>

      <main className="dl-main">
        {!entries.length && <p className="ext-empty">{t("downloads.emptyHistory")}</p>}
        {entries.length > 0 && !groups.length && <p className="ext-empty">{t("downloads.noMatch", { query: query.trim() })}</p>}
        {groups.map((group) => (
          <section key={group.day} className="dl-day">
            <h2>{group.day}</h2>
            {group.entries.map((entry) => {
              const done = entry.state === "completed" && entry.exists;
              return (
                <article key={entry.id} className={"dl-card" + (entry.exists && entry.state !== "cancelled" ? "" : " dl-card-gone")}>
                  <DownloadIcon entry={entry} />
                  <div className="dl-text">
                    <button className="dl-name" disabled={!done} onClick={() => void downloadAction(entry, "open")}>
                      {entry.filename}
                    </button>
                    <span className="dl-status">
                      {entry.state === "completed" && entry.exists ? (/^https?:/.test(entry.url) ? displayHost(entry.url) : "") : downloadStatus(entry)}
                    </span>
                    {entry.state === "progressing" && (
                      <>
                        <span className="download-bar">
                          <span style={{ width: `${downloadProgress(entry) * 100}%` }} />
                        </span>
                        <span className="dl-controls">
                          <button className="ext-pill" onClick={() => void downloadAction(entry, entry.paused ? "resume" : "pause")}>
                            {entry.paused ? t("downloads.resume") : t("downloads.pause")}
                          </button>
                          <button className="ext-pill" onClick={() => void downloadAction(entry, "cancel")}>
                            {t("downloads.cancel")}
                          </button>
                        </span>
                      </>
                    )}
                  </div>
                  <div className="dl-actions">
                    <button
                      title={t("downloads.copyLink")}
                      onClick={() => void downloadAction(entry, "copyLink").then((ok) => ok && ui.showToast(t("toast.linkCopied")))}
                    >
                      <Icon name="link" />
                    </button>
                    {done && (
                      <button title={t("downloads.showInFolder")} onClick={() => void downloadAction(entry, "show")}>
                        <Icon name="folder" />
                      </button>
                    )}
                    {entry.state !== "progressing" && (
                      <button title={t("downloads.remove")} onClick={() => void downloadAction(entry, "remove")}>
                        <Icon name="close" />
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        ))}
      </main>
    </div>
  );
}
