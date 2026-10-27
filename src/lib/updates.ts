import { t } from "./i18n";

/**
 * Manual update check (Yzo menu, settings), reported in toasts: checking, then the outcome.
 * @param showToast Shows a short message.
 */
export async function checkForUpdatesWithToasts(showToast: (message: string) => void): Promise<void> {
  showToast(t("updates.checking"));
  const result = await window.yzo?.checkForUpdates();
  const status = result?.status ?? "dev";
  showToast(t(`updates.${status}`, { version: result?.version ?? "" }));
}
