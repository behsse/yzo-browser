import type { AutoArchiveThreshold } from "../state/types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Inactivity duration for each threshold observed in Arc's AutoArchiveInactiveThreshold enum. */
export const THRESHOLD_MS: Record<AutoArchiveThreshold, number> = {
  oneHour: HOUR,
  twelveHours: 12 * HOUR,
  twentyFourHours: DAY,
  sevenDays: 7 * DAY,
  thirtyDays: 30 * DAY,
  never: Number.POSITIVE_INFINITY,
};

export const THRESHOLDS: AutoArchiveThreshold[] = ["oneHour", "twelveHours", "twentyFourHours", "sevenDays", "thirtyDays", "never"];

/**
 * Tells whether an unpinned tab has been inactive long enough to be archived.
 * @param lastActiveAt Epoch ms of the tab's last activation or navigation.
 * @param threshold Configured auto-archive threshold.
 * @param now Current epoch ms.
 * @returns True when the tab must be archived.
 */
export function isArchivable(lastActiveAt: number, threshold: AutoArchiveThreshold, now: number): boolean {
  return now - lastActiveAt >= THRESHOLD_MS[threshold];
}
