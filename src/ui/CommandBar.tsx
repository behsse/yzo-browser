import { useMemo, useState } from "react";
import { buildSuggestions, type Suggestion } from "../lib/commandBar";
import { displayHost } from "../lib/url";
import { tabCommand } from "../lib/tabs";
import { useStore } from "../state/store";
import { isTab } from "../state/tree";
import { Favicon } from "./Favicon";
import { Icon, type IconName } from "./Icon";
import type { CommandBarMode } from "./UiContext";

const KIND_ICON: Record<Suggestion["kind"], IconName> = { tab: "tab", history: "clock", url: "globe", search: "search" };
const KIND_HINT: Record<Suggestion["kind"], string> = {
  tab: "Basculer vers l'onglet",
  history: "Historique",
  url: "Ouvrir",
  search: "Rechercher",
};
const PLACEHOLDER: Record<CommandBarMode, string> = {
  new: "Rechercher ou saisir une URL…",
  current: "Modifier l'adresse…",
  split: "Ouvrir dans un nouveau panneau…",
};

/**
 * Arc-style command bar: one input for URLs, searches and switching to open tabs. In "current" mode
 * it navigates the focused tab, in "split" mode it opens the result in a new split pane.
 * @param props.mode What a validated suggestion does.
 * @param props.onClose Closes the bar.
 * @returns Modal overlay.
 */
export function CommandBar({ mode, onClose }: { mode: CommandBarMode; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const selection = state.window.selection[state.window.focusedSpaceId];
  const focusedTab = selection?.focusedTabId ? state.items[selection.focusedTabId] : undefined;
  const [query, setQuery] = useState(mode === "current" && isTab(focusedTab) ? focusedTab.data.url : "");
  const [index, setIndex] = useState(0);
  const suggestions = useMemo(() => buildSuggestions(query, state), [query, state]);

  const choose = (s: Suggestion) => {
    const now = Date.now();
    dispatch({ type: "rememberChoice", query, kind: s.kind });
    onClose();
    const focusedId = isTab(focusedTab) ? focusedTab.id : null;
    if (s.kind === "tab" && s.tabId) {
      if (mode === "split" && focusedId && s.tabId !== focusedId) dispatch({ type: "splitWithTab", tabId: focusedId, otherTabId: s.tabId, now });
      else dispatch({ type: "activate", id: s.tabId, now });
      return;
    }
    if (mode === "split" && focusedId) dispatch({ type: "addSplit", tabId: focusedId, url: s.url, now });
    else if (mode === "current" && focusedId) {
      // The store URL covers a page not created yet; the command navigates the live one.
      dispatch({ type: "updateTab", id: focusedId, url: s.url, now });
      void tabCommand(focusedId, "load", s.url);
    } else dispatch({ type: "createTab", url: s.url, target: "today", activate: true, now });
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="command-bar" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-label="Barre de commande">
        <div className="command-input">
          <Icon name="search" size={18} />
          <input
            autoFocus
            value={query}
            placeholder={PLACEHOLDER[mode]}
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((i) => Math.min(suggestions.length - 1, i + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (event.key === "Enter" && suggestions[index]) {
                event.preventDefault();
                choose(suggestions[index]);
              } else if (event.key === "Escape") onClose();
            }}
          />
        </div>
        {suggestions.length > 0 && (
          <ul className="suggestions" role="listbox">
            {suggestions.map((s, i) => (
              <li
                key={s.key}
                role="option"
                aria-selected={i === index}
                className={"suggestion" + (i === index ? " suggestion-active" : "")}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(s)}
              >
                <span className="suggestion-icon">
                  {s.kind === "tab" || s.kind === "history" ? <Favicon src={s.favicon} url={s.url} /> : <Icon name={KIND_ICON[s.kind]} />}
                </span>
                <span className="suggestion-title">{s.title}</span>
                {s.kind !== "search" && <span className="suggestion-host">{displayHost(s.url)}</span>}
                <span className="suggestion-hint">{KIND_HINT[s.kind]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
