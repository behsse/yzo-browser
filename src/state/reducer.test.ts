import { describe, expect, it } from "vitest";
import { buildSuggestions } from "../lib/commandBar";
import { THRESHOLD_MS } from "../lib/autoArchive";
import { parseState, serializeState } from "./persistence";
import { createInitialState, MAX_SPLIT_PANES, reducer, type Action } from "./reducer";
import { isSplit, isTab } from "./tree";
import type { AppState, ID } from "./types";

const T0 = 1_700_000_000_000;

/**
 * Applies actions in order.
 * @param state Start state.
 * @param actions Actions to apply.
 * @returns Final state.
 */
function run(state: AppState, ...actions: Action[]): AppState {
  return actions.reduce(reducer, state);
}

/**
 * Opens a today tab in the focused space and returns its id.
 * @param state Start state.
 * @param url Tab URL.
 * @param now Time of creation.
 * @returns New state and the tab id.
 */
function openTab(state: AppState, url: string, now = T0): [AppState, ID] {
  const next = reducer(state, { type: "createTab", url, target: "today", activate: true, now });
  return [next, next.window.selection[next.window.focusedSpaceId].focusedTabId!];
}

const space = (s: AppState) => s.spaces[s.window.focusedSpaceId];

describe("initial state", () => {
  it("has one space, three favorites and valid containers", () => {
    const s = createInitialState(T0);
    expect(s.spaceOrder).toHaveLength(1);
    expect(s.items[s.favoritesId].childrenIds).toHaveLength(3);
    expect(s.items[space(s).pinnedId].data).toMatchObject({ kind: "container", role: "pinned" });
    expect(s.settings.autoArchive).toBe("twelveHours");
  });
});

describe("tabs", () => {
  it("creates today tabs at the top and activates them", () => {
    let [s, a] = openTab(createInitialState(T0), "https://a.com");
    let b: ID;
    [s, b] = openTab(s, "https://b.com");
    expect(s.items[space(s).todayId].childrenIds).toEqual([b, a]);
    expect(s.loadedTabIds).toEqual([a, b]);
  });

  it("archives a closed today tab and selects its neighbour", () => {
    let [s, a] = openTab(createInitialState(T0), "https://a.com");
    let b: ID;
    [s, b] = openTab(s, "https://b.com");
    s = reducer(s, { type: "closeItem", id: b, now: T0 + 1 });
    expect(s.items[b]).toBeUndefined();
    expect(s.archive[0]).toMatchObject({ url: "https://b.com", reason: "manual" });
    expect(s.window.selection[space(s).id].itemId).toBe(a);
  });

  it("reopens the last closed tab", () => {
    let [s, a] = openTab(createInitialState(T0), "https://a.com");
    s = run(s, { type: "closeItem", id: a, now: T0 }, { type: "reopenClosed", now: T0 + 5 });
    const reopened = s.window.selection[space(s).id].itemId!;
    expect(s.archive).toHaveLength(0);
    expect(isTab(s.items[reopened]) && s.items[reopened].data.url).toBe("https://a.com");
  });

  it("unloads instead of deleting a pinned tab and resets its URL", () => {
    let [s, a] = openTab(createInitialState(T0), "https://a.com");
    s = run(
      s,
      { type: "togglePin", id: a },
      { type: "updateTab", id: a, url: "https://a.com/deep", now: T0 },
      { type: "closeItem", id: a, now: T0 },
    );
    const tab = s.items[a];
    expect(isTab(tab) && tab.data.url).toBe("https://a.com");
    expect(s.loadedTabIds).not.toContain(a);
    expect(s.archive).toHaveLength(0);
  });

  it("creates extension-requested tabs with the imposed id, loaded even in background", () => {
    const s = reducer(createInitialState(T0), { type: "createTab", url: "https://ext.example/", target: "today", activate: false, load: true, id: "ext-tab-1", now: T0 });
    expect(s.items["ext-tab-1"]).toBeDefined();
    expect(s.loadedTabIds).toContain("ext-tab-1");
    expect(s.window.selection[space(s).id].itemId).toBeNull();
    expect(reducer(s, { type: "createTab", url: "https://x/", target: "today", activate: true, id: "ext-tab-1", now: T0 })).toBe(s);
  });

  it("toggles pin between sections", () => {
    let [s, a] = openTab(createInitialState(T0), "https://a.com");
    s = reducer(s, { type: "togglePin", id: a });
    expect(s.items[space(s).pinnedId].childrenIds).toContain(a);
    s = reducer(s, { type: "togglePin", id: a });
    expect(s.items[space(s).todayId].childrenIds[0]).toBe(a);
  });

  it("does not mutate the previous state", () => {
    const [s0, a] = openTab(createInitialState(T0), "https://a.com");
    const snapshot = JSON.stringify(s0);
    reducer(s0, { type: "closeItem", id: a, now: T0 });
    expect(JSON.stringify(s0)).toBe(snapshot);
  });
});

describe("folders and moves", () => {
  it("moves tabs into folders and refuses cycles", () => {
    let [s, a] = openTab(createInitialState(T0), "https://a.com");
    s = reducer(s, { type: "createFolder", spaceId: space(s).id, title: "Work", now: T0 });
    const folder = s.items[space(s).pinnedId].childrenIds[0];
    s = reducer(s, { type: "moveItem", id: a, parentId: folder });
    expect(s.items[folder].childrenIds).toEqual([a]);
    expect(reducer(s, { type: "moveItem", id: folder, parentId: folder })).toBe(s);
  });

  it("only accepts tabs in favorites", () => {
    let s = createInitialState(T0);
    s = reducer(s, { type: "createFolder", spaceId: space(s).id, title: "F", now: T0 });
    const folder = s.items[space(s).pinnedId].childrenIds[0];
    expect(reducer(s, { type: "moveItem", id: folder, parentId: s.favoritesId })).toBe(s);
  });

  it("reorders within the same parent", () => {
    let [s, a] = openTab(createInitialState(T0), "https://a.com");
    let b: ID, c: ID;
    [s, b] = openTab(s, "https://b.com");
    [s, c] = openTab(s, "https://c.com");
    // Order is [c, b, a]; drop c after a.
    s = reducer(s, { type: "moveItem", id: c, parentId: space(s).todayId, index: 3 });
    expect(s.items[space(s).todayId].childrenIds).toEqual([b, a, c]);
  });

  it("archives the tabs of a deleted folder", () => {
    let [s, a] = openTab(createInitialState(T0), "https://a.com");
    s = reducer(s, { type: "createFolder", spaceId: space(s).id, title: "F", now: T0 });
    const folder = s.items[space(s).pinnedId].childrenIds[0];
    s = run(s, { type: "moveItem", id: a, parentId: folder }, { type: "deleteFolder", id: folder, now: T0 });
    expect(s.items[folder]).toBeUndefined();
    expect(s.items[a]).toBeUndefined();
    expect(s.archive[0].url).toBe("https://a.com");
  });
});

describe("split view", () => {
  it("wraps the tab and a new pane in a split", () => {
    let [s, a] = openTab(createInitialState(T0), "https://a.com");
    s = reducer(s, { type: "addSplit", tabId: a, url: "https://b.com", now: T0 });
    const splitId = s.items[space(s).todayId].childrenIds[0];
    const split = s.items[splitId];
    expect(isSplit(split) && split.childrenIds).toHaveLength(2);
    expect(isSplit(split) && split.data.widthFactors).toEqual([0.5, 0.5]);
    expect(s.window.selection[space(s).id].itemId).toBe(splitId);
  });

  it("caps panes and collapses back to a tab when one pane closes", () => {
    let [s, a] = openTab(createInitialState(T0), "https://a.com");
    for (let i = 0; i < MAX_SPLIT_PANES + 2; i++) s = reducer(s, { type: "addSplit", tabId: a, url: `https://p${i}.com`, now: T0 });
    const splitId = s.items[space(s).todayId].childrenIds[0];
    expect(s.items[splitId].childrenIds).toHaveLength(MAX_SPLIT_PANES);
    for (const pane of s.items[splitId].childrenIds.slice(1)) s = reducer(s, { type: "closeItem", id: pane, now: T0 });
    expect(s.items[splitId]).toBeUndefined();
    expect(s.items[space(s).todayId].childrenIds).toEqual([a]);
    expect(s.window.selection[space(s).id].itemId).toBe(a);
  });

  it("normalizes resized factors", () => {
    let [s, a] = openTab(createInitialState(T0), "https://a.com");
    s = reducer(s, { type: "addSplit", tabId: a, url: "https://b.com", now: T0 });
    const splitId = s.items[space(s).todayId].childrenIds[0];
    s = reducer(s, { type: "setSplitFactors", id: splitId, factors: [3, 1] });
    const split = s.items[splitId];
    expect(isSplit(split) && split.data.widthFactors).toEqual([0.75, 0.25]);
  });

  it("splits a tab dropped on another one, at the drop side and orientation", () => {
    let [s, a] = openTab(createInitialState(T0), "https://a.com");
    let b: ID;
    [s, b] = openTab(s, "https://b.com");
    s = reducer(s, { type: "splitWithTab", tabId: a, otherTabId: b, index: 0, orientation: "vertical", now: T0 });
    const split = s.items[space(s).todayId].childrenIds.map((id) => s.items[id]).find(isSplit);
    expect(split?.childrenIds).toEqual([b, a]);
    expect(split?.data.orientation).toBe("vertical");
  });

  it("keeps favorites out of splits", () => {
    const [s, a] = openTab(createInitialState(T0), "https://a.com");
    const favorite = s.items[s.favoritesId].childrenIds[0];
    expect(reducer(s, { type: "splitWithTab", tabId: a, otherTabId: favorite, now: T0 })).toBe(s);
  });

  it("reorders panes with their widths, also when a pane is dropped on its own split", () => {
    let [s, a] = openTab(createInitialState(T0), "https://a.com");
    s = reducer(s, { type: "addSplit", tabId: a, url: "https://b.com", now: T0 });
    s = reducer(s, { type: "addSplit", tabId: a, url: "https://c.com", now: T0 });
    const splitId = s.items[space(s).todayId].childrenIds[0];
    const [, b, c] = s.items[splitId].childrenIds;
    s = reducer(s, { type: "setSplitFactors", id: splitId, factors: [2, 1, 1] });
    s = reducer(s, { type: "moveSplitPane", id: a, index: 2 });
    let split = s.items[splitId];
    expect(split.childrenIds).toEqual([b, c, a]);
    expect(isSplit(split) && split.data.widthFactors).toEqual([0.25, 0.25, 0.5]);
    s = reducer(s, { type: "splitWithTab", tabId: b, otherTabId: a, index: 0, now: T0 });
    split = s.items[splitId];
    expect(split.childrenIds).toEqual([a, b, c]);
  });

  it("detaches a pane next to its split and collapses a split left with one pane", () => {
    let [s, a] = openTab(createInitialState(T0), "https://a.com");
    s = reducer(s, { type: "addSplit", tabId: a, url: "https://b.com", now: T0 });
    const splitId = s.items[space(s).todayId].childrenIds[0];
    const b = s.items[splitId].childrenIds[1];
    s = reducer(s, { type: "detachSplitPane", id: b, now: T0 });
    expect(s.items[splitId]).toBeUndefined();
    expect(s.items[space(s).todayId].childrenIds).toEqual([a, b]);
    expect(s.window.selection[space(s).id].itemId).toBe(b);
  });

  it("unsplits in place", () => {
    let [s, a] = openTab(createInitialState(T0), "https://a.com");
    s = reducer(s, { type: "addSplit", tabId: a, url: "https://b.com", now: T0 });
    const splitId = s.items[space(s).todayId].childrenIds[0];
    s = reducer(s, { type: "unsplit", id: splitId });
    expect(s.items[splitId]).toBeUndefined();
    expect(s.items[space(s).todayId].childrenIds).toHaveLength(2);
  });
});

describe("auto-archive", () => {
  it("archives inactive today tabs but keeps pinned and selected ones", () => {
    let [s, old] = openTab(createInitialState(T0), "https://old.com", T0);
    let pinned: ID, current: ID;
    [s, pinned] = openTab(s, "https://pinned.com", T0);
    s = reducer(s, { type: "togglePin", id: pinned });
    [s, current] = openTab(s, "https://current.com", T0);
    s = reducer(s, { type: "runAutoArchive", now: T0 + THRESHOLD_MS.twelveHours });
    expect(s.items[old]).toBeUndefined();
    expect(s.archive[0]).toMatchObject({ url: "https://old.com", reason: "auto" });
    expect(s.items[pinned]).toBeDefined();
    expect(s.items[current]).toBeDefined();
  });

  it("does nothing with the never threshold", () => {
    let [s] = openTab(createInitialState(T0), "https://a.com");
    s = run(s, { type: "updateSettings", settings: { autoArchive: "never" } }, { type: "createTab", url: "https://b.com", target: "today", activate: true, now: T0 });
    expect(reducer(s, { type: "runAutoArchive", now: T0 * 2 })).toBe(s);
  });
});

describe("spaces", () => {
  it("creates, switches and deletes spaces, archiving today tabs", () => {
    let s = createInitialState(T0);
    const first = s.window.focusedSpaceId;
    s = reducer(s, { type: "createSpace", name: "Work", icon: "💼", theme: space(s).theme, now: T0 });
    const second = s.window.focusedSpaceId;
    expect(second).not.toBe(first);
    [s] = openTab(s, "https://work.com");
    s = reducer(s, { type: "deleteSpace", id: second, now: T0 });
    expect(s.spaces[second]).toBeUndefined();
    expect(s.window.focusedSpaceId).toBe(first);
    expect(s.archive[0]).toMatchObject({ url: "https://work.com", reason: "spaceDeleted" });
  });

  it("loads the selected page when switching back to a space or restoring the app", () => {
    let [s, a] = openTab(createInitialState(T0), "https://a.com");
    const first = s.window.focusedSpaceId;
    s = reducer(s, { type: "createSpace", name: "B", icon: "🅱", theme: space(s).theme, now: T0 });
    s = { ...s, loadedTabIds: [] };
    s = reducer(s, { type: "switchSpace", id: first });
    expect(s.loadedTabIds).toEqual([a]);
    const restored = reducer(s, { type: "hydrate", state: parseState(serializeState(s))! });
    expect(restored.loadedTabIds).toEqual([a]);
  });

  it("refuses to delete the last space", () => {
    const s = createInitialState(T0);
    expect(reducer(s, { type: "deleteSpace", id: s.window.focusedSpaceId, now: T0 })).toBe(s);
  });

  it("focuses the owning space when activating a tab from another space", () => {
    let [s, a] = openTab(createInitialState(T0), "https://a.com");
    const first = s.window.focusedSpaceId;
    s = run(s, { type: "createSpace", name: "B", icon: "🅱", theme: space(s).theme, now: T0 }, { type: "activate", id: a, now: T0 });
    expect(s.window.focusedSpaceId).toBe(first);
  });
});

describe("history and command bar", () => {
  it("counts navigations, not title updates", () => {
    let s = createInitialState(T0);
    s = run(
      s,
      { type: "recordVisit", url: "https://a.com", title: "", now: T0 },
      { type: "recordVisit", url: "https://a.com", title: "A", now: T0 },
      { type: "recordVisit", url: "https://a.com", title: "", now: T0 },
    );
    expect(s.history).toHaveLength(1);
    expect(s.history[0]).toMatchObject({ title: "A", visitCount: 2 });
  });

  it("ignores non-http history", () => {
    const s = createInitialState(T0);
    expect(reducer(s, { type: "recordVisit", url: "about:blank", title: "", now: T0 })).toBe(s);
  });

  it("puts open tabs first, offers search, and honours the remembered kind", () => {
    let [s] = openTab(createInitialState(T0), "https://github.com/me");
    s = reducer(s, { type: "updateTab", id: s.window.selection[space(s).id].focusedTabId!, title: "My GitHub", now: T0 });
    let suggestions = buildSuggestions("git", s);
    expect(suggestions[0].kind).toBe("tab");
    expect(suggestions.some((x) => x.kind === "search")).toBe(true);
    s = reducer(s, { type: "rememberChoice", query: "git", kind: "search" });
    suggestions = buildSuggestions("git", s);
    expect(suggestions[0].kind).toBe("search");
  });

  it("offers a direct URL first for address-like input", () => {
    const suggestions = buildSuggestions("arc.net", createInitialState(T0));
    expect(suggestions[0]).toMatchObject({ kind: "url", url: "https://arc.net" });
  });
});

describe("persistence", () => {
  it("round-trips without session data", () => {
    let [s] = openTab(createInitialState(T0), "https://a.com");
    const json = serializeState(s);
    expect(json).not.toContain("loadedTabIds");
    const parsed = parseState(json)!;
    expect(parsed.items).toEqual(s.items);
    expect(parsed.loadedTabIds).toEqual([]);
  });

  it("rejects corrupt or foreign files", () => {
    const s = createInitialState(T0);
    expect(parseState(null)).toBeNull();
    expect(parseState("{not json")).toBeNull();
    expect(parseState(JSON.stringify({ ...JSON.parse(serializeState(s)), version: 2 }))).toBeNull();
    const broken = JSON.parse(serializeState(s));
    broken.items[broken.favoritesId].childrenIds.push("missing-id");
    expect(parseState(JSON.stringify(broken))).toBeNull();
  });
});
