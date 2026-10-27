import { useEffect, useState } from "react";
import type { DownloadEntry } from "../env";

/**
 * Every download, newest first, kept up to date from the main process.
 * @returns Downloads (empty until loaded).
 */
export function useDownloads(): DownloadEntry[] {
  const [entries, setEntries] = useState<DownloadEntry[]>([]);
  useEffect(() => {
    const bridge = window.yzo?.downloads;
    if (!bridge) return;
    void bridge.list().then(setEntries);
    const offChanged = bridge.onChanged((entry) =>
      setEntries((list) => (list.some((e) => e.id === entry.id) ? list.map((e) => (e.id === entry.id ? entry : e)) : [entry, ...list])),
    );
    const offRemoved = bridge.onRemoved((id) => setEntries((list) => list.filter((e) => e.id !== id)));
    const offCleared = bridge.onCleared(() => setEntries((list) => list.filter((e) => e.state === "progressing")));
    return () => {
      offChanged();
      offRemoved();
      offCleared();
    };
  }, []);
  return entries;
}
