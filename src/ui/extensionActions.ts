import { createElement, useEffect, useState } from "react";
import { PARTITION as TABS_PARTITION } from "../lib/tabs";

/** An extension that has a toolbar action (icon, popup, badge). */
export interface ExtensionAction {
  id: string;
  title: string;
}

/** Chrome Web Store extension ids: 32 letters a–p. */
const EXTENSION_ID = /^[a-p]{32}$/;

/**
 * Lists the extensions that have a toolbar action, kept up to date as extensions are installed,
 * removed or change their action. Reads the state electron-chrome-extensions exposes to the UI
 * (window.browserAction); empty outside Electron.
 * @returns Actions in install order.
 */
export function useExtensionActions(): ExtensionAction[] {
  const [actions, setActions] = useState<ExtensionAction[]>([]);
  useEffect(() => {
    const api = window.browserAction;
    if (!api) return;
    const update = (state: BrowserActionState) =>
      setActions(state.actions.filter((action) => EXTENSION_ID.test(action.id)).map((action) => ({ id: action.id, title: action.title ?? "" })));
    api.addEventListener("update", update);
    api.addObserver(TABS_PARTITION);
    void api.getState(TABS_PARTITION).catch(() => undefined);
    return () => {
      api.removeEventListener("update", update);
      api.removeObserver(TABS_PARTITION);
    };
  }, []);
  return actions;
}

/**
 * One extension's action button, drawn and driven by electron-chrome-extensions (`<button
 * is="browser-action">`): icon, badge, and its popup or click event when pressed.
 * @param props.id Extension id; it must be in useExtensionActions() so its state is loaded.
 * @param props.tabId Chromium id of the active tab's page (per-tab icons and badges), or -1.
 * @param props.className Extra class.
 * @returns Button element.
 */
export function ExtensionActionButton({ id, tabId, className }: { id: string; tabId: number; className?: string }) {
  // Custom attributes of a customized built-in element: React sets them as attributes.
  return createElement("button", { is: "browser-action", id, partition: TABS_PARTITION, tab: String(tabId), alignment: "bottom left", class: className });
}
