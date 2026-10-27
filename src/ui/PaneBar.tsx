import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { t } from "../lib/i18n";
import { isInternalUrl } from "../lib/internalPages";
import { tabCommand } from "../lib/tabs";
import { relativeLuminance } from "../lib/theme";
import { displayHost } from "../lib/url";
import { useStore } from "../state/store";
import { isTab } from "../state/tree";
import type { ID, SidebarItem, SplitData } from "../state/types";
import { Icon } from "./Icon";
import { useUi } from "./UiContext";

/**
 * Colors of a pane bar from the page's top color: the site's own color, with dark or light text.
 * @param color "#rrggbb" read from the page, if known.
 * @returns CSS variables for the bar.
 */
export function paneBarColors(color: string | undefined): CSSProperties {
  if (!color) return {};
  const dark = relativeLuminance(color) < 0.4;
  return { "--pane-color": color, "--pane-fg": dark ? "#f4f4f7" : "#1d1d22", "--pane-hover": dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.08)" } as CSSProperties;
}

/**
 * Bar above each page of a split, like Arc's: back, forward and reload on the left, the site with
 * copy-link and site settings in the middle, and the split actions on the right. Dragging the bar
 * moves the pane. It takes the color of the top of the page.
 * @param props.id Pane tab id.
 * @param props.split Split the pane belongs to.
 * @param props.onReorderStart Starts moving the pane (press on the bar's background).
 * @returns Bar element.
 */
export function PaneBar({ id, split, onReorderStart }: { id: ID; split: SidebarItem<SplitData>; onReorderStart: (event: ReactPointerEvent<HTMLElement>) => void }) {
  const { state, dispatch } = useStore();
  const ui = useUi();
  const item = state.items[id];
  const url = isTab(item) ? item.data.url : "";
  const web = Boolean(url) && !isInternalUrl(url);
  const focus = () => dispatch({ type: "activate", id, now: Date.now() });

  return (
    <div
      className="pane-bar"
      onPointerDown={(event) => {
        if (event.button === 0 && !(event.target as HTMLElement).closest("button")) onReorderStart(event);
      }}
    >
      <div className="pane-bar-side">
        <button title={t("sidebar.back")} disabled={!web} onClick={() => void tabCommand(id, "back")}>
          <Icon name="back" size={15} />
        </button>
        <button title={t("sidebar.forward")} disabled={!web} onClick={() => void tabCommand(id, "forward")}>
          <Icon name="forward" size={15} />
        </button>
        <button title={t("page.reload")} disabled={!web} onClick={() => void tabCommand(id, "reload")}>
          <Icon name="reload" size={15} />
        </button>
      </div>

      <div className="pane-bar-address">
        {web && (
          <button
            title={t("common.copyLink")}
            onClick={() => {
              void navigator.clipboard.writeText(url);
              ui.showToast(t("toast.linkCopied"));
            }}
          >
            <Icon name="link" size={15} />
          </button>
        )}
        <button
          className="pane-bar-host"
          title={url}
          onClick={() => {
            focus();
            ui.openCommandBar("current");
          }}
        >
          {displayHost(url)}
        </button>
        {web && (
          <button
            title={t("topbar.siteMenu")}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              focus();
              ui.openSitePanel({ left: rect.left, bottom: rect.bottom });
            }}
          >
            <Icon name="sliders" size={15} />
          </button>
        )}
      </div>

      <div className="pane-bar-side pane-bar-end">
        <button title={t("split.detach")} onClick={() => dispatch({ type: "detachSplitPane", id, now: Date.now() })}>
          <Icon name="fullscreen" size={14} />
        </button>
        <button title={t("split.stop")} onClick={() => dispatch({ type: "unsplit", id: split.id })}>
          <Icon name={split.data.orientation === "vertical" ? "splitVertical" : "split"} size={15} />
        </button>
        <button title={t("split.closePane")} onClick={() => dispatch({ type: "closeItem", id, now: Date.now() })}>
          <Icon name="closeCircle" size={15} />
        </button>
      </div>
    </div>
  );
}
