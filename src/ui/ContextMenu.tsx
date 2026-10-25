import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import type { MenuState } from "./UiContext";

/**
 * Floating context menu, kept inside the window and closed on outside click, Escape or blur.
 * @param props.menu Position and entries.
 * @param props.onClose Closes the menu.
 * @returns Menu element.
 */
export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: menu.x, y: menu.y });

  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      x: Math.min(menu.x, window.innerWidth - rect.width - 8),
      y: Math.min(menu.y, window.innerHeight - rect.height - 8),
    });
  }, [menu]);

  useEffect(() => {
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof MouseEvent && ref.current?.contains(event.target as Node)) return;
      onClose();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="context-menu" style={{ left: position.x, top: position.y }} role="menu">
      {menu.entries.map((entry, i) =>
        entry === "separator" ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={entry.danger ? "danger" : ""}
            disabled={entry.disabled}
            onClick={() => {
              onClose();
              entry.onSelect();
            }}
          >
            {entry.icon && (
              <span className="menu-icon">
                <Icon name={entry.icon} size={17} />
              </span>
            )}
            <span className="menu-label">{entry.label}</span>
            {entry.hint && <kbd>{entry.hint}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
