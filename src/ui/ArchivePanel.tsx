import { useMemo, useState } from "react";
import { THRESHOLD_LABELS } from "../lib/autoArchive";
import { displayHost } from "../lib/url";
import { useStore } from "../state/store";
import type { ArchiveEntry, AutoArchiveThreshold, SearchEngine } from "../state/types";
import { Favicon } from "./Favicon";
import { Icon } from "./Icon";

const REASON_LABELS: Record<ArchiveEntry["reason"], string> = { manual: "Fermé", auto: "Auto-archivé", spaceDeleted: "Espace supprimé" };

/**
 * Groups archive entries by calendar day for display.
 * @param entries Archive entries, newest first.
 * @returns [day label, entries] pairs.
 */
function groupByDay(entries: ArchiveEntry[]): [string, ArchiveEntry[]][] {
  const groups = new Map<string, ArchiveEntry[]>();
  const format = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
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
      <div className="panel" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-label="Archive et réglages">
        <header className="panel-header">
          <h2>Archive</h2>
          <button title="Fermer" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>

        <section className="settings">
          <label>
            Archiver les onglets inactifs après
            <select
              value={state.settings.autoArchive}
              onChange={(event) => dispatch({ type: "updateSettings", settings: { autoArchive: event.target.value as AutoArchiveThreshold } })}
            >
              {Object.entries(THRESHOLD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Moteur de recherche
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

        <input className="panel-search" placeholder="Filtrer l'archive…" value={filter} onChange={(event) => setFilter(event.target.value)} autoFocus />

        <div className="archive-list">
          {!entries.length && <p className="muted">Aucun onglet archivé.</p>}
          {groupByDay(entries).map(([day, group]) => (
            <div key={day}>
              <h3>{day}</h3>
              {group.map((entry) => (
                <div key={entry.id} className="archive-row">
                  <Favicon src={entry.favicon} url={entry.url} />
                  <div className="archive-text">
                    <span className="row-title">{entry.title}</span>
                    <span className="muted">
                      {displayHost(entry.url)} · {REASON_LABELS[entry.reason]} · {state.spaces[entry.spaceId]?.name ?? "espace supprimé"}
                    </span>
                  </div>
                  <button onClick={() => dispatch({ type: "restoreArchived", archiveId: entry.id, now: Date.now() })}>Restaurer</button>
                  <button title="Supprimer définitivement" onClick={() => dispatch({ type: "deleteArchived", archiveId: entry.id })}>
                    <Icon name="close" size={12} />
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
