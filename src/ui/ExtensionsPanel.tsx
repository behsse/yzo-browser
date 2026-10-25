import { t } from "../lib/i18n";
import { useStore } from "../state/store";
import { Icon } from "./Icon";
import { ExtensionActionButton, useExtensionActions } from "./extensionActions";
import { useUi } from "./UiContext";
import { useViewHost } from "./ViewHost";

const CHROME_WEB_STORE_URL = "https://chromewebstore.google.com/category/extensions";
const PANEL_WIDTH = 248;

/**
 * Extensions panel under the puzzle button, like Arc's: every extension as a tile (click opens its
 * popup), a pin on hover to show it in the top bar, right-click for options and removal, and "+" to
 * add more from the Chrome Web Store.
 * @param props.anchor Bottom-right corner of the puzzle button, in window coordinates.
 * @param props.onClose Closes the panel.
 * @returns Panel overlay.
 */
export function ExtensionsPanel({ anchor, onClose }: { anchor: { right: number; bottom: number }; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const ui = useUi();
  const host = useViewHost();
  const actions = useExtensionActions();
  const pinned = state.settings.pinnedExtensions ?? [];
  const tabId = host.webContentsIdOf(state.window.selection[state.window.focusedSpaceId]?.focusedTabId ?? null) ?? -1;

  const openTab = (url: string) => dispatch({ type: "createTab", url, target: "today", activate: true, now: Date.now() });
  const togglePin = (id: string) =>
    dispatch({ type: "updateSettings", settings: { pinnedExtensions: pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id] } });

  // Yzo's own menu instead of the library's English one: pin, options, removal.
  const openTileMenu = async (id: string, x: number, y: number) => {
    const installed = (await window.yzo?.listExtensions())?.find((ext) => ext.id === id);
    ui.openMenu({
      x,
      y,
      entries: [
        { label: pinned.includes(id) ? t("extensions.unpin") : t("extensions.pin"), onSelect: () => togglePin(id) },
        ...(installed?.optionsUrl ? [{ label: t("extensions.options"), onSelect: () => openTab(installed.optionsUrl!) }] : []),
        "separator",
        {
          label: t("common.delete"),
          danger: true,
          onSelect: async () => {
            const removed = await window.yzo?.uninstallExtension(id);
            ui.showToast(removed ? t("extensions.removed", { name: installed?.name ?? "" }) : t("extensions.removeFailed"));
          },
        },
      ],
    });
  };

  return (
    <div className="popover-layer" onMouseDown={onClose}>
      <div
        className="extensions-panel"
        style={{ top: anchor.bottom + 6, left: Math.max(8, anchor.right - PANEL_WIDTH), width: PANEL_WIDTH }}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label={t("extensions.title")}
      >
        <h3>{t("extensions.title")}</h3>
        <div className="extensions-grid">
          {actions.map(({ id, title }) => (
            <div
              key={id}
              className="extension-tile"
              // Capture phase: runs before the action button's own context menu.
              onContextMenuCapture={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void openTileMenu(id, event.clientX, event.clientY);
              }}
              // Bubbles after the button has opened the extension's popup.
              onClick={(event) => {
                if (!(event.target as HTMLElement).closest(".extension-pin")) onClose();
              }}
            >
              <ExtensionActionButton id={id} tabId={tabId} className="extension-tile-action" />
              <button
                className={"extension-pin" + (pinned.includes(id) ? " extension-pin-on" : "")}
                title={(pinned.includes(id) ? t("extensions.unpin") : t("extensions.pin")) + (title ? ` (${title})` : "")}
                onClick={() => togglePin(id)}
              >
                <Icon name="pin" size={12} />
              </button>
            </div>
          ))}
          <button
            className="extension-tile extension-add"
            title={t("extensions.addFromStore")}
            onClick={() => {
              openTab(CHROME_WEB_STORE_URL);
              onClose();
            }}
          >
            <Icon name="plus" />
          </button>
        </div>
      </div>
    </div>
  );
}
