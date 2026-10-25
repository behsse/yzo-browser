import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { createInitialState, reducer } from "../state/reducer";
import { isFolder, isSplit, isTab } from "../state/tree";
import type { ArcImportData } from "../state/types";

// electron/arc-import.cjs is plain Node (fs only), so its parser is tested directly.
const require = createRequire(import.meta.url);
const { parseArcSidebar, countTabs } = require("../../electron/arc-import.cjs");

/** Minimal StorableSidebar.json with the shapes observed in Arc (flat [key, value…] dictionaries). */
const arcFile = {
  version: 1,
  sidebar: {
    containers: [
      { global: {} },
      {
        spaces: [
          "s1",
          { id: "s1", customInfo: { iconType: { icon: "planet" } }, newContainerIDs: [{ pinned: {} }, "p1", { unpinned: { _0: { shared: {} } } }, "u1"] },
          "s2",
          { id: "s2", title: "Work", customInfo: { iconType: { emoji_v2: "💼" } }, newContainerIDs: [{ unpinned: { _0: { shared: {} } } }, "u2", { pinned: {} }, "p2"] },
        ],
        items: [
          "p1", { id: "p1", data: { itemContainer: {} }, childrenIds: ["f1", "t1"] },
          "f1", { id: "f1", title: "Docs", data: { list: {} }, childrenIds: ["t2", "bad"] },
          "t2", { id: "t2", title: null, data: { tab: { savedURL: "https://docs.example.com/", savedTitle: "Docs home" } }, childrenIds: [] },
          "bad", { id: "bad", data: { tab: { savedURL: "file:///C:/secret.txt" } }, childrenIds: [] },
          "t1", { id: "t1", title: "Mail", data: { tab: { savedURL: "https://mail.example.com/" } }, childrenIds: [] },
          "u1", { id: "u1", data: { itemContainer: {} }, childrenIds: ["sv"] },
          "sv", { id: "sv", data: { splitView: { layoutOrientation: "vertical", itemWidthFactors: [0.3, 0.7] } }, childrenIds: ["t3", "t4"] },
          "t3", { id: "t3", data: { tab: { savedURL: "https://a.example.com/" } }, childrenIds: [] },
          "t4", { id: "t4", data: { tab: { savedURL: "https://b.example.com/" } }, childrenIds: [] },
          "p2", { id: "p2", data: { itemContainer: {} }, childrenIds: ["t5"] },
          "t5", { id: "t5", data: { tab: { savedURL: "http://intranet.local/" } }, childrenIds: [] },
          "u2", { id: "u2", data: { itemContainer: {} }, childrenIds: [] },
          "top", { id: "top", data: { itemContainer: {} }, childrenIds: ["fav"] },
          "fav", { id: "fav", title: "Search", data: { tab: { savedURL: "https://search.example.com/" } }, childrenIds: [] },
        ],
        topAppsContainerIDs: [{ default: true }, "top"],
      },
    ],
  },
};

describe("Arc sidebar parser", () => {
  const parsed = parseArcSidebar(arcFile);

  it("reads spaces in order with their name and icon", () => {
    expect(parsed.spaces.map((s: { name: string | null; icon: string | null }) => [s.name, s.icon])).toEqual([
      [null, "🪐"],
      ["Work", "💼"],
    ]);
  });

  it("keeps folders, split views and tabs, and drops non-web URLs", () => {
    const [personal] = parsed.spaces;
    expect(personal.pinned).toEqual([
      { kind: "folder", title: "Docs", children: [{ kind: "tab", url: "https://docs.example.com/", title: "Docs home" }] },
      { kind: "tab", url: "https://mail.example.com/", title: "Mail" },
    ]);
    expect(personal.today[0]).toMatchObject({ kind: "split", orientation: "vertical", factors: [0.3, 0.7] });
    expect(countTabs([...personal.pinned, ...personal.today])).toBe(4);
  });

  it("reads favorites from the top apps container", () => {
    expect(parsed.favorites).toEqual([{ kind: "tab", url: "https://search.example.com/", title: "Search" }]);
  });

  it("returns nothing for files that are not Arc sidebars", () => {
    expect(parseArcSidebar({})).toEqual({ spaces: [], favorites: [] });
    expect(parseArcSidebar(null)).toEqual({ spaces: [], favorites: [] });
  });
});

describe("importArc action", () => {
  const data: ArcImportData = parseArcSidebar(arcFile);

  it("adds the spaces, their tabs, folders, split views and new favorites without touching existing ones", () => {
    const before = createInitialState(1);
    const after = reducer(before, { type: "importArc", data, now: 2 });
    expect(after.spaceOrder).toHaveLength(before.spaceOrder.length + 2);
    expect(after.spaceOrder.slice(0, before.spaceOrder.length)).toEqual(before.spaceOrder);

    const [personalId, workId] = after.spaceOrder.slice(-2);
    expect(after.window.focusedSpaceId).toBe(personalId);
    expect(after.spaces[workId]).toMatchObject({ name: "Work", icon: "💼" });

    const pinned = after.items[after.spaces[personalId].pinnedId].childrenIds.map((id) => after.items[id]);
    expect(isFolder(pinned[0]) && pinned[0].data.title).toBe("Docs");
    expect(isTab(pinned[1]) && pinned[1].data.url).toBe("https://mail.example.com/");
    const split = after.items[after.items[after.spaces[personalId].todayId].childrenIds[0]];
    expect(isSplit(split) && split.data.widthFactors).toEqual([0.3, 0.7]);

    const favorites = after.items[after.favoritesId].childrenIds.map((id) => after.items[id]);
    expect(favorites.filter((item) => isTab(item) && item.data.url === "https://search.example.com/")).toHaveLength(1);
  });

  it("does not duplicate a favorite that already exists", () => {
    const once = reducer(createInitialState(1), { type: "importArc", data, now: 2 });
    const twice = reducer(once, { type: "importArc", data, now: 3 });
    const urls = twice.items[twice.favoritesId].childrenIds.map((id) => {
      const item = twice.items[id];
      return isTab(item) ? item.data.url : "";
    });
    expect(urls.filter((url) => url === "https://search.example.com/")).toHaveLength(1);
  });
});
