import type { DownloadAction, DownloadEntry } from "../env";
import { downloadProgress, downloadStatus } from "../lib/downloads";
import { t } from "../lib/i18n";
import { DOWNLOADS_URL } from "../lib/internalPages";
import { useStore } from "../state/store";
import { Icon } from "./Icon";
import { useUi, type MenuEntry } from "./UiContext";
import { useDownloads } from "./useDownloads";

const PANEL_WIDTH = 340;

/**
 * Runs an action on a download.
 * @param entry Download.
 * @param action What to do.
 * @returns Whether it worked.
 */
export function downloadAction(entry: DownloadEntry, action: DownloadAction): Promise<boolean> {
  return window.yzo?.downloads.act(entry.id, action) ?? Promise.resolve(false);
}

/**
 * Entries of a download's "…" menu, for its state (shared by the panel and yzo://downloads).
 * @param entry Download.
 * @param showToast Shows a confirmation.
 * @returns Menu entries.
 */
export function downloadMenuEntries(entry: DownloadEntry, showToast: (message: string) => void): (MenuEntry | "separator")[] {
  const copyLink: MenuEntry = {
    icon: "link",
    label: t("downloads.copyLink"),
    onSelect: () => void downloadAction(entry, "copyLink").then((ok) => ok && showToast(t("toast.linkCopied"))),
  };
  if (entry.state === "progressing") {
    return [
      entry.paused
        ? { icon: "play", label: t("downloads.resume"), onSelect: () => void downloadAction(entry, "resume") }
        : { icon: "pause", label: t("downloads.pause"), onSelect: () => void downloadAction(entry, "pause") },
      { icon: "close", label: t("downloads.cancel"), onSelect: () => void downloadAction(entry, "cancel") },
      "separator",
      copyLink,
    ];
  }
  const remove: MenuEntry = { icon: "close", label: t("downloads.remove"), onSelect: () => void downloadAction(entry, "remove") };
  if (entry.state !== "completed" || !entry.exists) return [copyLink, "separator", remove];
  return [
    { icon: "external", label: t("downloads.open"), onSelect: () => void downloadAction(entry, "open") },
    { icon: "folder", label: t("downloads.showInFolder"), onSelect: () => void downloadAction(entry, "show") },
    copyLink,
    "separator",
    remove,
    {
      icon: "trash",
      label: t("downloads.trash"),
      danger: true,
      onSelect: () => void downloadAction(entry, "trash").then((ok) => ok && showToast(t("downloads.trashed", { name: entry.filename }))),
    },
  ];
}

/**
 * File icon of a download, or a generic file.
 * @param props.entry Download.
 * @returns Icon element.
 */
export function DownloadIcon({ entry }: { entry: DownloadEntry }) {
  if (entry.icon) return <img className="download-icon" src={entry.icon} alt="" />;
  return (
    <span className="download-icon">
      <Icon name="file" size={22} />
    </span>
  );
}

/**
 * Downloads panel under the top bar's download button, like Chrome's and Arc's: this session's
 * downloads (click a finished one to open it), each with its folder and "…" menu, and a link to all
 * downloads (yzo://downloads).
 * @param props.anchor Bottom-right corner of the download button, in window coordinates.
 * @param props.onClose Closes the panel.
 * @returns Panel overlay.
 */
export function DownloadsPanel({ anchor, onClose }: { anchor: { right: number; bottom: number }; onClose: () => void }) {
  const { dispatch } = useStore();
  const ui = useUi();
  const entries = useDownloads().filter((entry) => entry.thisSession);

  const openMenu = (entry: DownloadEntry, button: HTMLElement) => {
    const rect = button.getBoundingClientRect();
    ui.openMenu({ x: rect.left, y: rect.bottom + 4, entries: downloadMenuEntries(entry, ui.showToast) });
  };

  return (
    <div className="popover-layer" onMouseDown={onClose}>
      <div
        className="downloads-panel"
        style={{ top: anchor.bottom + 6, left: Math.max(8, anchor.right - PANEL_WIDTH), width: PANEL_WIDTH }}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label={t("downloads.title")}
      >
        {!entries.length && <p className="downloads-empty">{t("downloads.emptySession")}</p>}
        <div className="downloads-list">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className={"download-row" + (entry.state === "completed" && entry.exists ? " download-row-openable" : "")}
              onClick={() => {
                if (entry.state === "completed" && entry.exists) void downloadAction(entry, "open");
              }}
            >
              <DownloadIcon entry={entry} />
              <div className="download-text">
                <span className={"download-name" + (entry.exists ? "" : " download-gone")}>{entry.filename}</span>
                <span className="download-status">{downloadStatus(entry)}</span>
                {entry.state === "progressing" && (
                  <span className="download-bar">
                    <span style={{ width: `${downloadProgress(entry) * 100}%` }} />
                  </span>
                )}
              </div>
              {entry.state === "completed" && entry.exists && (
                <button
                  className="download-button"
                  title={t("downloads.showInFolder")}
                  onClick={(event) => {
                    event.stopPropagation();
                    void downloadAction(entry, "show");
                  }}
                >
                  <Icon name="folder" />
                </button>
              )}
              <button
                className="download-button"
                title={t("downloads.more")}
                aria-haspopup="menu"
                onClick={(event) => {
                  event.stopPropagation();
                  openMenu(entry, event.currentTarget);
                }}
              >
                <Icon name="more" />
              </button>
            </div>
          ))}
        </div>
        <hr />
        <button
          className="downloads-all"
          onClick={() => {
            dispatch({ type: "createTab", url: DOWNLOADS_URL, title: t("downloads.title"), target: "today", activate: true, now: Date.now() });
            onClose();
          }}
        >
          {t("downloads.showAll")}
        </button>
      </div>
    </div>
  );
}
