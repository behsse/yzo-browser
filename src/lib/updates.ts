import { useEffect, useState } from "react";
import type { UpdateState } from "../env";
import { t } from "./i18n";

/**
 * Where the update of an installed Yzo stands, kept up to date from the main process.
 * @returns Update state, or null until known (and outside Electron).
 */
export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    const bridge = window.yzo?.updates;
    if (!bridge) return;
    void bridge.state().then((current) => current && setState(current));
    return bridge.onState(setState);
  }, []);
  return state;
}

/**
 * Sentence describing an update state, for toasts and the settings.
 * @param state Update state.
 * @returns Message, or null when there is nothing to say (no check done yet).
 */
export function updateMessage(state: UpdateState): string | null {
  switch (state.status) {
    case "idle":
      return null;
    case "downloading":
      return t("updates.downloading", { version: state.version, percent: state.percent });
    default:
      return t(`updates.${state.status}`, { version: state.version });
  }
}

/**
 * Manual update check (Yzo menu, settings), reported in toasts: checking, then the outcome. Progress
 * and the restart button then show in the top bar.
 * @param showToast Shows a short message.
 */
export async function checkForUpdatesWithToasts(showToast: (message: string) => void): Promise<void> {
  showToast(t("updates.checking"));
  const state = await window.yzo?.updates.check();
  const message = updateMessage(state ?? { status: "dev", version: "", percent: 0, autoDownload: true });
  if (message) showToast(message);
}
