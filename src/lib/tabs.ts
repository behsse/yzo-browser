import type { TabCommand } from "../env";
import type { ID } from "../state/types";

/**
 * Session partition of the tab pages (see electron/main.cjs). Extensions are loaded there. A private
 * window passes its own in the address.
 */
export const PARTITION = new URLSearchParams(window.location.search).get("partition") ?? "persist:yzo";

/** Id reserved by the main process for the Peek view (see electron/views.cjs). */
export const PEEK_ID = "__peek__";

/**
 * Runs a navigation command on a tab's page in the main process. Pages are native views there, so
 * the UI never holds a direct reference to them.
 * @param tabId Tab (or PEEK_ID); null is ignored.
 * @param command Command to run.
 * @param arg URL for "load".
 * @returns The command result ("state" only), or undefined.
 */
export function tabCommand(tabId: ID | null, command: TabCommand, arg?: string): Promise<unknown> {
  if (!tabId || !window.yzo) return Promise.resolve(undefined);
  return window.yzo.tabCommand(tabId, command, arg);
}
