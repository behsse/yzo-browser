import { useEffect, useState } from "react";
import { t } from "../lib/i18n";
import { PEEK_ID } from "../lib/tabs";
import { displayHost } from "../lib/url";
import { useStore } from "../state/store";
import { Icon } from "./Icon";
import { useViewHost } from "./ViewHost";

/**
 * Peek: previews a link in a floating card over the current page (Arc's PeekViewController). The
 * page is a dedicated native view placed over the card body; it can be promoted to a real tab or
 * dismissed with Escape or a click outside.
 * @param props.url Link to preview.
 * @param props.onClose Dismisses the preview.
 * @returns Modal overlay.
 */
export function Peek({ url, onClose }: { url: string; onClose: () => void }) {
  const { dispatch } = useStore();
  const host = useViewHost();
  const [current, setCurrent] = useState(url);
  const [title, setTitle] = useState("");

  useEffect(() => {
    return window.yzo?.onTabEvent((event) => {
      if (event.tabId !== PEEK_ID) return;
      if (event.type === "navigate" || event.type === "navigate-in-page") setCurrent(event.url);
      if (event.type === "title") setTitle(event.title);
    });
  }, []);

  const promote = () => {
    dispatch({ type: "createTab", url: current, target: "today", activate: true, now: Date.now(), title });
    onClose();
  };

  return (
    <div className="overlay peek-overlay" onMouseDown={onClose}>
      <div className="peek" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-label={t("peek.dialog")}>
        <div className="peek-bar">
          <span className="peek-host">{title || displayHost(current)}</span>
          <button title={t("peek.openInTab")} onClick={promote}>
            <Icon name="external" size={16} />
          </button>
          <button title={t("peek.close")} onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="peek-page" ref={host.peekRef} />
      </div>
    </div>
  );
}
