import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { shortcutLabel } from "../lib/shortcuts";
import { resolveAppearance, sidebarBackground } from "../lib/theme";
import { displayHost } from "../lib/url";
import { tabCommand } from "../lib/tabs";
import { canMove } from "../state/reducer";
import { useStore } from "../state/store";
import { isTab } from "../state/tree";
import { Favicon } from "./Favicon";
import { Icon } from "./Icon";
import { PARTITION as TABS_PARTITION } from "../lib/tabs";
import { DRAG_TYPE, ItemList } from "./SidebarTree";
import { useUi, type MenuEntry } from "./UiContext";
import { useViewHost } from "./ViewHost";
import { useSync } from "../sync/SyncProvider";

const CHROME_WEB_STORE_URL = "https://chromewebstore.google.com/category/extensions";

/**
 * Minimize / maximize / close buttons of the frameless window, in the Windows order.
 * @returns Button group.
 */
function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    window.yzo?.isMaximized().then(setMaximized);
    return window.yzo?.onMaximized(setMaximized);
  }, []);
  if (!window.yzo) return null;
  return (
    <div className="window-controls no-drag">
      <button title="Réduire" onClick={() => window.yzo?.windowControl("minimize")}>
        <Icon name="minimize" />
      </button>
      <button title={maximized ? "Restaurer" : "Agrandir"} onClick={() => window.yzo?.windowControl("maximize")}>
        <Icon name={maximized ? "restore" : "maximize"} />
      </button>
      <button className="window-close" title="Fermer" onClick={() => window.yzo?.windowControl("close")}>
        <Icon name="close" />
      </button>
    </div>
  );
}

/**
 * Favorites grid shared by every space (Arc's "top apps" container).
 * @returns Tile grid accepting dropped tabs.
 */
function Favorites() {
  const { state, dispatch } = useStore();
  const ui = useUi();
  const [over, setOver] = useState(false);
  const container = state.items[state.favoritesId];
  const activeId = state.window.selection[state.window.focusedSpaceId]?.itemId;
  return (
    <div
      className={"favorites" + (over ? " favorites-over" : "") + (container.childrenIds.length ? "" : " favorites-empty")}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const id = event.dataTransfer.getData(DRAG_TYPE);
        if (id && canMove(state, id, state.favoritesId)) dispatch({ type: "addToFavorites", id });
      }}
    >
      {container.childrenIds.map((id) => {
        const tab = state.items[id];
        if (!isTab(tab)) return null;
        return (
          <button
            key={id}
            className={"favorite-tile" + (activeId === id ? " favorite-active" : "")}
            title={tab.data.title || tab.data.url}
            draggable
            onDragStart={(event) => event.dataTransfer.setData(DRAG_TYPE, id)}
            onClick={() => dispatch({ type: "activate", id, now: Date.now() })}
            onContextMenu={(event) => {
              event.preventDefault();
              ui.openMenu({
                x: event.clientX,
                y: event.clientY,
                entries: [
                  { label: "Aperçu (Peek)", onSelect: () => ui.openPeek(tab.data.url) },
                  {
                    label: "Retirer des favoris",
                    onSelect: () => dispatch({ type: "moveItem", id, parentId: state.spaces[state.window.focusedSpaceId].todayId, index: 0 }),
                  },
                  "separator",
                  { label: "Décharger", onSelect: () => dispatch({ type: "closeItem", id, now: Date.now() }) },
                ],
              });
            }}
          >
            <Favicon src={tab.data.favicon} url={tab.data.url} size={20} />
          </button>
        );
      })}
      {!container.childrenIds.length && <span className="favorites-hint">Glissez un onglet ici</span>}
    </div>
  );
}

/**
 * Bottom dock: archive button, one icon per space and the new-space button.
 * @returns Dock element.
 */
function SpaceDock() {
  const { state, dispatch } = useStore();
  const ui = useUi();
  const sync = useSync();
  return (
    <div className="space-dock">
      <button className="dock-button" title={`Archive et réglages (${shortcutLabel("openArchive")})`} onClick={ui.openArchive}>
        <Icon name="archive" size={15} />
      </button>
      <button className={"dock-button" + (sync.status?.signedIn ? " dock-account-on" : "")} title={sync.status?.signedIn ? `Compte : ${sync.status.email}` : "Compte Yzo et synchronisation"} onClick={ui.openAccount}>
        <Icon name={sync.syncing ? "sync" : "user"} size={15} />
      </button>
      <div className="dock-spaces">
        {state.spaceOrder.map((id, index) => {
          const space = state.spaces[id];
          return (
            <button
              key={id}
              className={"dock-space" + (id === state.window.focusedSpaceId ? " dock-space-active" : "")}
              title={`${space.name} (Ctrl+${index + 1})`}
              onClick={() => dispatch({ type: "switchSpace", id })}
              onDoubleClick={() => ui.openSpaceEditor(id)}
              onContextMenu={(event) => {
                event.preventDefault();
                ui.openMenu({
                  x: event.clientX,
                  y: event.clientY,
                  entries: [
                    { label: "Modifier l'espace…", onSelect: () => ui.openSpaceEditor(id) },
                    ...(state.spaceOrder.length > 1
                      ? [{ label: "Supprimer l'espace", danger: true, onSelect: () => dispatch({ type: "deleteSpace", id, now: Date.now() }) }]
                      : []),
                  ],
                });
              }}
            >
              {space.icon}
            </button>
          );
        })}
      </div>
      <button className="dock-button" title="Nouvel espace" onClick={() => ui.openSpaceEditor("new")}>
        <Icon name="plus" size={15} />
      </button>
    </div>
  );
}

/**
 * The Arc-style vertical sidebar: window chrome, navigation, URL pill, favorites, the focused
 * space's pinned and today sections, and the space dock.
 * @param props.floating True when shown as an overlay while the sidebar is hidden.
 * @returns Sidebar element.
 */
export function Sidebar({ floating = false }: { floating?: boolean }) {
  const { state, dispatch } = useStore();
  const ui = useUi();
  const space = state.spaces[state.window.focusedSpaceId];
  const selection = state.window.selection[space.id];
  const focusedTab = selection?.focusedTabId ? state.items[selection.focusedTabId] : undefined;
  const url = isTab(focusedTab) ? focusedTab.data.url : "";
  const appearance = resolveAppearance(space.theme);
  const resizing = useRef(false);
  const host = useViewHost();

  // Lists installed extensions with their actions, plus the way to add more.
  const openExtensionsMenu = async (anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const installed = (await window.yzo?.listExtensions()) ?? [];
    const openTab = (url: string) => dispatch({ type: "createTab", url, target: "today", activate: true, now: Date.now() });
    const entries: (MenuEntry | "separator")[] = installed.length
      ? installed.flatMap((ext) => [
          { label: `${ext.name} ${ext.version}`, disabled: true, onSelect: () => {} },
          ...(ext.optionsUrl ? [{ label: "Options", onSelect: () => openTab(ext.optionsUrl!) }] : []),
          {
            label: "Supprimer",
            danger: true,
            onSelect: async () => {
              const removed = await window.yzo?.uninstallExtension(ext.id);
              ui.showToast(removed ? `${ext.name} supprimée` : "Suppression impossible");
            },
          },
          "separator" as const,
        ])
      : [{ label: "Aucune extension installée", disabled: true, onSelect: () => {} }, "separator" as const];
    entries.push({ label: "Ajouter depuis le Chrome Web Store", onSelect: () => openTab(CHROME_WEB_STORE_URL) });
    ui.openMenu({ x: rect.left, y: rect.bottom + 4, entries });
  };
  const todayCount = state.items[space.todayId].childrenIds.length;

  // The page view next to the handle swallows the pointer: freeze it while resizing.
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    resizing.current = true;
    host.setDragging(true);
    document.body.classList.add("resizing-sidebar");
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const stopResize = () => {
    if (!resizing.current) return;
    resizing.current = false;
    host.setDragging(false);
    document.body.classList.remove("resizing-sidebar");
  };
  const onResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizing.current) return;
    if (event.buttons === 0) return stopResize();
    dispatch({ type: "setSidebarWidth", width: event.clientX });
  };

  return (
    <aside
      className={`sidebar sidebar-${appearance}${floating ? " sidebar-floating" : ""}`}
      style={{ width: state.window.sidebarWidth, background: floating ? sidebarBackground(space.theme) : undefined }}
    >
      {/* No drag region while floating: Electron drag regions swallow mouse events, which would fire
          mouseleave on the floating host and close it as soon as the pointer reaches the top. */}
      <div className={"sidebar-top" + (floating ? "" : " drag")}>
        <div className="sidebar-top-row sidebar-brand-row">
          {/* Placeholder mark until the real logo exists. */}
          <span className="brand-mark" role="img" aria-label="Yzo">
            <Icon name="brand" />
          </span>
          <WindowControls />
        </div>
        <div className="sidebar-top-row nav-buttons">
          <button title={`Barre latérale (${shortcutLabel("toggleSidebar")})`} onClick={() => ui.runAction("toggleSidebar")}>
            <Icon name="sidebar" />
          </button>
          <button title="Précédent (Alt+Gauche)" onClick={() => void tabCommand(selection?.focusedTabId ?? null, "back")}>
            <Icon name="back" />
          </button>
          <button title="Suivant (Alt+Droite)" onClick={() => void tabCommand(selection?.focusedTabId ?? null, "forward")}>
            <Icon name="forward" />
          </button>
          <button title={`Recharger (${shortcutLabel("reload")})`} onClick={() => ui.runAction("reload")}>
            <Icon name="reload" />
          </button>
          {/* Extension action buttons (icons, popups, badges) rendered by electron-chrome-extensions. */}
          {window.yzo && (
            <browser-action-list
              className="extension-actions no-drag"
              partition={TABS_PARTITION}
              alignment="bottom right"
              tab={host.webContentsIdOf(selection?.focusedTabId ?? null)}
            />
          )}
          <button className="extensions-button" title="Extensions" onClick={(event) => void openExtensionsMenu(event.currentTarget)}>
            <Icon name="extensions" />
          </button>
        </div>
      </div>

      <button className="url-pill" onClick={() => ui.openCommandBar(url ? "current" : "new")} title={url || "Rechercher ou saisir une URL"}>
        <span className="url-text">{url ? displayHost(url) : "Rechercher ou saisir une URL"}</span>
        {url && (
          <span
            className="url-copy"
            role="button"
            title={`Copier le lien (${shortcutLabel("copyUrl")})`}
            onClick={(event) => {
              event.stopPropagation();
              ui.runAction("copyUrl");
            }}
          >
            <Icon name="copy" size={13} />
          </span>
        )}
      </button>

      <Favorites />

      <div className="sidebar-scroll">
        <div className="space-title" onDoubleClick={() => ui.openSpaceEditor(space.id)}>
          <span className="space-icon">{space.icon}</span>
          <span className="space-name">{space.name}</span>
          <button
            className="space-action"
            title={`Nouveau dossier (${shortcutLabel("newFolder")})`}
            onClick={() => dispatch({ type: "createFolder", spaceId: space.id, title: "Nouveau dossier", now: Date.now() })}
          >
            <Icon name="folder" size={13} />
          </button>
        </div>

        <ItemList parentId={space.pinnedId} />

        <div className="today-divider">
          <span />
          {todayCount > 0 && (
            <button title={`Tout archiver (${shortcutLabel("clearToday")})`} onClick={() => dispatch({ type: "clearToday", spaceId: space.id, now: Date.now() })}>
              Effacer
            </button>
          )}
        </div>

        <button className="row new-tab-row" onClick={() => ui.openCommandBar("new")}>
          <Icon name="plus" size={15} />
          <span className="row-title">Nouvel onglet</span>
          <kbd>{shortcutLabel("newTab")}</kbd>
        </button>

        <ItemList parentId={space.todayId} />
      </div>

      <SpaceDock />
      {!floating && <div className="resize-handle" onPointerDown={startResize} onPointerMove={onResize} onPointerUp={stopResize} onPointerCancel={stopResize} />}
    </aside>
  );
}
