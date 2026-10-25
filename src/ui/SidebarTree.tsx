import { useState, type DragEvent, type MouseEvent } from "react";
import { t } from "../lib/i18n";
import { canMove } from "../state/reducer";
import { useStore } from "../state/store";
import { isFolder, isInToday, isSplit, isTab, rootContainerOf } from "../state/tree";
import type { ID, SidebarItem, SplitData, TabData } from "../state/types";
import { Favicon } from "./Favicon";
import { Icon } from "./Icon";
import { useUi, type MenuEntry } from "./UiContext";

export const DRAG_TYPE = "application/x-yzo-item";

type DropZone = "before" | "after" | "inside" | null;

/**
 * Computes where a drop lands relative to a row: upper/lower half for leaves, and a middle band
 * that drops inside for folders.
 * @param event Drag event over the row.
 * @param acceptsInside Whether the row is a folder.
 * @returns Drop zone.
 */
function zoneFor(event: DragEvent<HTMLElement>, acceptsInside: boolean): DropZone {
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / rect.height;
  if (acceptsInside) return ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
  return ratio < 0.5 ? "before" : "after";
}

/**
 * Shared drag & drop behavior of sidebar rows: drag the row's item, drop before/after it or inside
 * a folder. Invalid moves (cycles, splits into favorites…) are rejected by the reducer's canMove.
 * @param item Row item.
 * @returns Props to spread on the row and the current drop indicator.
 */
function useRowDnd(item: SidebarItem) {
  const { state, dispatch } = useStore();
  const [zone, setZone] = useState<DropZone>(null);
  const folder = isFolder(item);

  const target = (z: DropZone, dragged: ID): { parentId: ID; index?: number } | null => {
    if (z === "inside") return canMove(state, dragged, item.id) ? { parentId: item.id } : null;
    if (!item.parentId) return null;
    const index = state.items[item.parentId].childrenIds.indexOf(item.id) + (z === "after" ? 1 : 0);
    return canMove(state, dragged, item.parentId) ? { parentId: item.parentId, index } : null;
  };

  return {
    zone,
    props: {
      draggable: true,
      onDragStart: (event: DragEvent<HTMLElement>) => {
        event.stopPropagation();
        event.dataTransfer.setData(DRAG_TYPE, item.id);
        event.dataTransfer.effectAllowed = "move";
      },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        event.stopPropagation();
        setZone(zoneFor(event, folder));
      },
      onDragLeave: () => setZone(null),
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const dragged = event.dataTransfer.getData(DRAG_TYPE);
        const destination = dragged && dragged !== item.id ? target(zoneFor(event, folder), dragged) : null;
        setZone(null);
        if (destination) dispatch({ type: "moveItem", id: dragged, ...destination });
        if (destination && folder && isFolder(item) && item.data.collapsed) dispatch({ type: "toggleFolder", id: item.id });
      },
    },
  };
}

/**
 * Renders the children of a container, folder or split, plus an end drop zone for containers.
 * @param props.parentId Parent item.
 * @param props.depth Indentation level.
 * @returns Item rows.
 */
export function ItemList({ parentId, depth = 0 }: { parentId: ID; depth?: number }) {
  const { state, dispatch } = useStore();
  const parent = state.items[parentId];
  const [over, setOver] = useState(false);
  if (!parent) return null;
  return (
    <div className="item-list">
      {parent.childrenIds.map((id) => (
        <ItemRow key={id} id={id} depth={depth} />
      ))}
      {depth === 0 && (
        <div
          className={"drop-tail" + (over ? " drop-tail-active" : "")}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(false);
            const dragged = event.dataTransfer.getData(DRAG_TYPE);
            if (dragged && canMove(state, dragged, parentId)) dispatch({ type: "moveItem", id: dragged, parentId });
          }}
        />
      )}
    </div>
  );
}

/**
 * Dispatches to the row component matching the item kind.
 * @param props.id Item id.
 * @param props.depth Indentation level.
 * @returns Row element.
 */
function ItemRow({ id, depth }: { id: ID; depth: number }) {
  const { state } = useStore();
  const item = state.items[id];
  if (isTab(item)) return <TabRow item={item} depth={depth} />;
  if (isFolder(item)) return <FolderRow id={id} depth={depth} />;
  if (isSplit(item)) return <SplitRow item={item} depth={depth} />;
  return null;
}

/**
 * Inline title editor used by tab and folder rows.
 * @param props.initial Current title.
 * @param props.onDone Called with the new title, or null when cancelled.
 * @returns Text input.
 */
function RenameInput({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
  return (
    <input
      className="rename-input"
      autoFocus
      defaultValue={initial}
      onClick={(event) => event.stopPropagation()}
      onBlur={(event) => onDone(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onDone(event.currentTarget.value);
        if (event.key === "Escape") onDone(null);
        event.stopPropagation();
      }}
    />
  );
}

/**
 * Builds the context menu of a tab row.
 * @param item Tab item.
 * @returns Menu entries.
 */
function useTabMenu(item: SidebarItem<TabData>) {
  const { state, dispatch } = useStore();
  const ui = useUi();
  return (rename: () => void): (MenuEntry | "separator")[] => {
    const now = Date.now();
    const selection = state.window.selection[state.window.focusedSpaceId];
    const focusedTab = selection?.focusedTabId;
    const role = rootContainerOf(state, item.id)?.data.role;
    const entries: (MenuEntry | "separator")[] = [];
    if (focusedTab && focusedTab !== item.id && role !== "favorites" && rootContainerOf(state, focusedTab)?.data.role !== "favorites") {
      entries.push({ label: t("tab.openInSplit"), onSelect: () => dispatch({ type: "splitWithTab", tabId: focusedTab, otherTabId: item.id, now }) });
    }
    entries.push({ label: t("common.peek"), onSelect: () => ui.openPeek(item.data.url) });
    if (role !== "favorites") {
      entries.push({ label: isInToday(state, item.id) ? t("tab.pin") : t("tab.unpin"), hint: "Ctrl+D", onSelect: () => dispatch({ type: "togglePin", id: item.id }) });
      entries.push({ label: t("tab.addToFavorites"), onSelect: () => dispatch({ type: "addToFavorites", id: item.id }) });
    } else {
      entries.push({ label: t("sidebar.removeFromFavorites"), onSelect: () => dispatch({ type: "moveItem", id: item.id, parentId: state.spaces[state.window.focusedSpaceId].todayId, index: 0 }) });
    }
    entries.push(
      { label: t("common.rename"), onSelect: rename },
      {
        label: t("common.copyLink"),
        onSelect: () => {
          void navigator.clipboard.writeText(item.data.url);
          ui.showToast(t("toast.linkCopied"));
        },
      },
      "separator",
      { label: isInToday(state, item.id) ? t("tab.archive") : t("tab.unload"), hint: "Ctrl+W", danger: true, onSelect: () => dispatch({ type: "closeItem", id: item.id, now }) },
    );
    return entries;
  };
}

/**
 * Sidebar row for one tab.
 * @param props.item Tab item.
 * @param props.depth Indentation level.
 * @returns Row element.
 */
function TabRow({ item, depth }: { item: SidebarItem<TabData>; depth: number }) {
  const { state, dispatch } = useStore();
  const ui = useUi();
  const { zone, props } = useRowDnd(item);
  const [renaming, setRenaming] = useState(false);
  const menu = useTabMenu(item);
  const selection = state.window.selection[state.window.focusedSpaceId];
  const active = selection?.itemId === item.id;
  const loaded = state.loadedTabIds.includes(item.id);
  const pinnedSide = !isInToday(state, item.id);

  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    ui.openMenu({ x: event.clientX, y: event.clientY, entries: menu(() => setRenaming(true)) });
  };

  return (
    <div
      {...props}
      className={`row tab-row${active ? " row-active" : ""}${zone ? " drop-" + zone : ""}${pinnedSide && !loaded ? " row-unloaded" : ""}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => dispatch({ type: "activate", id: item.id, now: Date.now() })}
      onAuxClick={(event) => event.button === 1 && dispatch({ type: "closeItem", id: item.id, now: Date.now() })}
      onDoubleClick={() => setRenaming(true)}
      onContextMenu={onContextMenu}
      title={item.data.url}
    >
      <Favicon src={item.data.favicon} url={item.data.url} />
      {renaming ? (
        <RenameInput
          initial={item.data.title}
          onDone={(title) => {
            setRenaming(false);
            if (title !== null) dispatch({ type: "renameItem", id: item.id, title });
          }}
        />
      ) : (
        <span className="row-title">{item.data.title || item.data.url}</span>
      )}
      {(!pinnedSide || loaded) && (
        <button
          className="row-close"
          title={pinnedSide ? t("sidebar.unloadTab") : t("common.close")}
          onClick={(event) => {
            event.stopPropagation();
            dispatch({ type: "closeItem", id: item.id, now: Date.now() });
          }}
        >
          <Icon name={pinnedSide ? "minimize" : "close"} size={14} />
        </button>
      )}
    </div>
  );
}

/**
 * Sidebar row for a folder and, when expanded, its children.
 * @param props.id Folder id.
 * @param props.depth Indentation level.
 * @returns Folder block.
 */
function FolderRow({ id, depth }: { id: ID; depth: number }) {
  const { state, dispatch } = useStore();
  const ui = useUi();
  const item = state.items[id];
  const { zone, props } = useRowDnd(item);
  const [renaming, setRenaming] = useState(false);
  if (!isFolder(item)) return null;

  return (
    <div className="folder">
      <div
        {...props}
        className={`row folder-row${zone ? " drop-" + zone : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => dispatch({ type: "toggleFolder", id })}
        onDoubleClick={() => setRenaming(true)}
        onContextMenu={(event) => {
          event.preventDefault();
          ui.openMenu({
            x: event.clientX,
            y: event.clientY,
            entries: [
              { label: t("common.rename"), onSelect: () => setRenaming(true) },
              "separator",
              { label: t("folder.delete"), danger: true, onSelect: () => dispatch({ type: "deleteFolder", id, now: Date.now() }) },
            ],
          });
        }}
      >
        <span className={"chevron" + (item.data.collapsed ? "" : " chevron-open")}>
          <Icon name="chevron" size={14} />
        </span>
        <Icon name="folder" size={17} />
        {renaming ? (
          <RenameInput
            initial={item.data.title}
            onDone={(title) => {
              setRenaming(false);
              if (title !== null) dispatch({ type: "renameItem", id, title });
            }}
          />
        ) : (
          <span className="row-title">{item.data.title}</span>
        )}
      </div>
      {!item.data.collapsed && <ItemList parentId={id} depth={depth + 1} />}
    </div>
  );
}

/**
 * Sidebar row for a split view: one rounded block showing its panes side by side.
 * @param props.item Split item.
 * @param props.depth Indentation level.
 * @returns Split block.
 */
function SplitRow({ item, depth }: { item: SidebarItem<SplitData>; depth: number }) {
  const { state, dispatch } = useStore();
  const ui = useUi();
  const { zone, props } = useRowDnd(item);
  const active = state.window.selection[state.window.focusedSpaceId]?.itemId === item.id;
  const vertical = item.data.orientation === "vertical";

  return (
    <div
      {...props}
      className={`row split-row${active ? " row-active" : ""}${zone ? " drop-" + zone : ""}`}
      style={{ marginLeft: depth * 14 }}
      onContextMenu={(event) => {
        event.preventDefault();
        ui.openMenu({
          x: event.clientX,
          y: event.clientY,
          entries: [
            {
              label: vertical ? t("split.sideBySide") : t("split.stacked"),
              onSelect: () => dispatch({ type: "setSplitOrientation", id: item.id, orientation: vertical ? "horizontal" : "vertical" }),
            },
            { label: t("split.separate"), onSelect: () => dispatch({ type: "unsplit", id: item.id }) },
            "separator",
            { label: t("split.closeActive"), hint: "Ctrl+W", danger: true, onSelect: () => dispatch({ type: "closeItem", id: item.id, now: Date.now() }) },
          ],
        });
      }}
    >
      <Icon name={vertical ? "splitVertical" : "split"} size={15} />
      <div className="split-panes">
        {item.childrenIds.map((childId) => {
          const child = state.items[childId];
          if (!isTab(child)) return null;
          const focused = active && item.data.focusedChildId === childId;
          return (
            <button
              key={childId}
              className={"split-chip" + (focused ? " split-chip-focused" : "")}
              title={child.data.title || child.data.url}
              onClick={(event) => {
                event.stopPropagation();
                dispatch({ type: "activate", id: childId, now: Date.now() });
              }}
            >
              <Favicon src={child.data.favicon} url={child.data.url} size={14} />
              <span className="row-title">{child.data.title || child.data.url}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
