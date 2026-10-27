import type { DownloadEntry } from "../env";
import { t } from "./i18n";

/**
 * Size in Ko / Mo / Go (KB / MB / GB), with one decimal above a megabyte, like Chrome.
 * @param bytes Size in bytes.
 * @returns Readable size.
 */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return t("size.gigabytes", { size: (mb / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 }) });
  if (mb >= 1) return t("size.megabytes", { size: mb.toLocaleString(undefined, { maximumFractionDigits: 1 }) });
  return t("size.kilobytes", { size: Math.max(1, Math.round(bytes / 1024)) });
}

/**
 * Share of a download already received, between 0 and 1 (0 when the size is unknown).
 * @param entry Download.
 * @returns Progress.
 */
export function downloadProgress(entry: Pick<DownloadEntry, "receivedBytes" | "totalBytes">): number {
  return entry.totalBytes > 0 ? Math.min(1, entry.receivedBytes / entry.totalBytes) : 0;
}

/**
 * Status line of a download: progress while it runs, then what clicking it does or why it stopped.
 * @param entry Download.
 * @returns Text under the file name.
 */
export function downloadStatus(entry: DownloadEntry): string {
  if (entry.state === "progressing") {
    if (entry.paused) return t("downloads.paused");
    if (!entry.totalBytes) return formatBytes(entry.receivedBytes);
    return t("downloads.progress", { received: formatBytes(entry.receivedBytes), total: formatBytes(entry.totalBytes) });
  }
  if (entry.state === "cancelled") return t("downloads.cancelled");
  if (entry.state === "interrupted") return t("downloads.failed");
  return entry.exists ? t("downloads.openFile") : t("downloads.deleted");
}

/**
 * Groups downloads by the day they started, newest day first (the downloads page).
 * @param entries Downloads, newest first.
 * @param locale Language of the day labels.
 * @returns Day label and its downloads.
 */
export function groupByDay(entries: DownloadEntry[], locale?: string): { day: string; entries: DownloadEntry[] }[] {
  const groups: { day: string; entries: DownloadEntry[] }[] = [];
  for (const entry of entries) {
    const day = new Date(entry.startTime).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
    const last = groups[groups.length - 1];
    if (last?.day === day) last.entries.push(entry);
    else groups.push({ day, entries: [entry] });
  }
  return groups;
}
