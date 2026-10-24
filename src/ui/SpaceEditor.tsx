import { useRef, useState } from "react";
import { DEFAULT_THEME, PALETTES, sidebarBackground } from "../lib/theme";
import { useStore } from "../state/store";
import type { ID, SpaceTheme, ThemeMode } from "../state/types";
import { Icon } from "./Icon";

const ICONS = ["🪐", "🏠", "💼", "🎨", "📚", "🎮", "🧪", "🎵", "✈️", "💡", "🔥", "🌿"];
const MODES: [ThemeMode, string][] = [
  ["light", "Clair"],
  ["dark", "Sombre"],
  ["auto", "Auto"],
];

/**
 * Creates or edits a space: name, emoji icon and a two-color gradient picked from the palettes
 * recovered from Arc's style editor, with light/dark/auto appearance.
 * @param props.spaceId Space to edit, or "new".
 * @param props.onClose Closes the editor.
 * @returns Modal overlay.
 */
export function SpaceEditor({ spaceId, onClose }: { spaceId: ID | "new"; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const existing = spaceId === "new" ? undefined : state.spaces[spaceId];
  const [name, setName] = useState(existing?.name ?? "");
  const [icon, setIcon] = useState(existing?.icon ?? ICONS[(state.spaceOrder.length + 1) % ICONS.length]);
  const [theme, setTheme] = useState<SpaceTheme>(existing?.theme ?? DEFAULT_THEME);
  const [slot, setSlot] = useState<0 | 1>(0);
  const slotRef = useRef<0 | 1>(0);

  const save = () => {
    if (existing) dispatch({ type: "updateSpace", id: existing.id, name, icon, theme });
    else dispatch({ type: "createSpace", name: name || "Nouvel espace", icon, theme, now: Date.now() });
    onClose();
  };

  // Functional updates so quick successive clicks never overwrite each other with stale state.
  const pick = (color: string) => {
    const target = slotRef.current;
    setTheme((current) => {
      const colors: [string, string] = [...current.colors];
      colors[target] = color;
      return { ...current, colors };
    });
    slotRef.current = target === 0 ? 1 : 0;
    setSlot(slotRef.current);
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="panel space-editor" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-label="Espace">
        <header className="panel-header">
          <h2>{existing ? "Modifier l'espace" : "Nouvel espace"}</h2>
          <button title="Fermer" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>

        <div className="space-preview" style={{ background: sidebarBackground(theme) }}>
          <span>{icon}</span>
          <strong>{name || "Nouvel espace"}</strong>
        </div>

        <input
          className="panel-search"
          placeholder="Nom de l'espace"
          value={name}
          autoFocus
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && save()}
        />

        <div className="icon-grid">
          {ICONS.map((emoji) => (
            <button key={emoji} className={emoji === icon ? "picked" : ""} onClick={() => setIcon(emoji)}>
              {emoji}
            </button>
          ))}
        </div>

        <div className="gradient-slots">
          {theme.colors.map((color, i) => (
            <button
              key={i}
              className={"slot" + (slot === i ? " slot-active" : "")}
              style={{ background: color }}
              onClick={() => {
                slotRef.current = i as 0 | 1;
                setSlot(slotRef.current);
              }}
            >
              {i === 0 ? "Couleur 1" : "Couleur 2"}
            </button>
          ))}
        </div>
        {Object.entries(PALETTES).map(([paletteName, colors]) => (
          <div key={paletteName} className="palette">
            {colors.map((color) => (
              <button key={color} className="swatch" style={{ background: color }} title={color} onClick={() => pick(color)} />
            ))}
          </div>
        ))}

        <div className="mode-toggle">
          {MODES.map(([mode, label]) => (
            <button key={mode} className={theme.mode === mode ? "picked" : ""} onClick={() => setTheme((current) => ({ ...current, mode }))}>
              {label}
            </button>
          ))}
        </div>

        <footer className="panel-footer">
          {existing && state.spaceOrder.length > 1 && (
            <button
              className="danger"
              onClick={() => {
                dispatch({ type: "deleteSpace", id: existing.id, now: Date.now() });
                onClose();
              }}
            >
              Supprimer
            </button>
          )}
          <button className="primary" onClick={save}>
            {existing ? "Enregistrer" : "Créer"}
          </button>
        </footer>
      </div>
    </div>
  );
}
