import { useMemo, useState } from "react";
import { THRESHOLDS } from "../lib/autoArchive";
import { locale, t, type MessageKey } from "../lib/i18n";
import { displayHost } from "../lib/url";
import { useStore } from "../state/store";
import type { ArchiveEntry, AutoArchiveThreshold, SearchEngine } from "../state/types";
import { Favicon } from "./Favicon";
import { Icon } from "./Icon";

const REASON_LABELS: Record<ArchiveEntry["reason"], MessageKey> = {
  manual: "archive.reasonManual",
  auto: "archive.reasonAuto",
  spaceDeleted: "archive.reasonSpaceDeleted",
};

/**
 * Groups archive entries by calendar day for display.
 * @param entries Archive entries, newest first.
 * @returns [day label, entries] pairs.
 */
function groupByDay(entries: ArchiveEntry[]): [string, ArchiveEntry[]][] {
  const groups = new Map<string, ArchiveEntry[]>();
  const format = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" });
  for (const entry of entries) {
    const label = format.format(entry.archivedAt);
    groups.set(label, [...(groups.get(label) ?? []), entry]);
  }
  return [...groups];
}

/**
 * Archive browser and settings: restore closed or auto-archived tabs, and choose the auto-archive
 * delay and the search engine.
 * @param props.onClose Closes the panel.
 * @returns Modal overlay.
 */
export function ArchivePanel({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [filter, setFilter] = useState("");
  const entries = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? state.archive.filter((e) => e.title.toLowerCase().includes(q) || e.url.toLowerCase().includes(q)) : state.archive;
  }, [filter, state.archive]);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="panel" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-label={t("archive.dialog")}>
        <header className="panel-header">
          <h2>{t("archive.title")}</h2>
          <button title={t("common.close")} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>

        <section className="settings">
          <label>
            {t("archive.autoArchiveAfter")}
            <select
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
          <label>
            {t("archive.searchEngine")}
            <select
              value={state.settings.searchEngine}
              onChange={(event) => dispatch({ type: "updateSettings", settings: { searchEngine: event.target.value as SearchEngine } })}
            >
              <option value="google">Google</option>
              <option value="duckduckgo">DuckDuckGo</option>
              <option value="bing">Bing</option>
            </select>
          </label>
        </section>

        <input className="panel-search" placeholder={t("archive.filter")} value={filter} onChange={(event) => setFilter(event.target.value)} autoFocus />

        <div className="archive-list">
          {!entries.length && <p className="muted">{t("archive.empty")}</p>}
          {groupByDay(entries).map(([day, group]) => (
            <div key={day}>
              <h3>{day}</h3>
              {group.map((entry) => (
                <div key={entry.id} className="archive-row">
                  <Favicon src={entry.favicon} url={entry.url} />
                  <div className="archive-text">
                    <span className="row-title">{entry.title}</span>
                    <span className="muted">
                      {displayHost(entry.url)} · {t(REASON_LABELS[entry.reason])} · {state.spaces[entry.spaceId]?.name ?? t("archive.deletedSpace")}
                    </span>
                  </div>
                  <button onClick={() => dispatch({ type: "restoreArchived", archiveId: entry.id, now: Date.now() })}>{t("archive.restore")}</button>
                  <button title={t("archive.deleteForever")} onClick={() => dispatch({ type: "deleteArchived", archiveId: entry.id })}>
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
