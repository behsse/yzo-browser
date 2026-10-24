import { describe, expect, it } from "vitest";
import { createInitialState, emptySyncMeta, reducer, type Action } from "../state/reducer";
import { isTab } from "../state/tree";
import type { AppState, ID } from "../state/types";
import { collectChanges, hashString, isPristine, projectRecords, stableStringify, type RemoteRecord } from "./records";

const T0 = 1_700_000_000_000;

/**
 * In-memory stand-in for the sync server: per-record versions and optimistic concurrency,
 * same rules as yzo-cloud (planPush / pullChanges).
 */
class FakeServer {
  version = 0;
  records = new Map<string, RemoteRecord>();

  push(changes: ReturnType<typeof collectChanges>) {
    const accepted: { recordId: string; version: number }[] = [];
    for (const r of changes.records) {
      const current = this.records.get(r.recordId)?.version ?? 0;
      if (r.baseVersion !== current) continue;
      this.version += 1;
      this.records.set(r.recordId, { recordId: r.recordId, json: r.json, deleted: r.deleted, version: this.version });
      accepted.push({ recordId: r.recordId, version: this.version });
    }
    return { accepted, cursor: this.version };
  }

  pull(since: number) {
    const records = [...this.records.values()].filter((r) => r.version > since).sort((a, b) => a.version - b.version);
    return { records, cursor: records.at(-1)?.version ?? since };
  }
}

/**
 * Runs one sync cycle of a device against the server: pull everything, merge, push changes.
 * @param state Device state.
 * @param server Fake server.
 * @param now Clock.
 * @returns New device state.
 */
function syncCycle(state: AppState, server: FakeServer, now = T0): AppState {
  const pulled = server.pull(state.sync.cursor);
  let s = reducer(state, { type: "applySync", records: pulled.records, cursor: pulled.cursor, now });
  const changes = collectChanges(s, s.sync);
  if (changes.records.length) {
    const result = server.push(changes);
    s = reducer(s, { type: "syncPushed", changes, accepted: result.accepted, cursor: result.cursor, now });
  }
  return s;
}

const run = (state: AppState, ...actions: Action[]) => actions.reduce(reducer, state);
const spaceOf = (s: AppState) => s.spaces[s.window.focusedSpaceId];
const pinnedUrls = (s: AppState, spaceId: ID) =>
  s.items[s.spaces[spaceId].pinnedId].childrenIds.map((id) => {
    const item = s.items[id];
    return isTab(item) ? item.data.savedUrl : item?.data.kind;
  });

/** A device with a customized sidebar: a "Work" space with two pinned tabs and a folder. */
function customizedDevice(): AppState {
  let s = createInitialState(T0);
  s = { ...s, sync: emptySyncMeta("me@yzo.app") };
  s = reducer(s, { type: "createSpace", name: "Work", icon: "💼", theme: spaceOf(s).theme, now: T0 });
  const work = s.window.focusedSpaceId;
  for (const url of ["https://github.com/", "https://linear.app/team"]) {
    s = reducer(s, { type: "createTab", url, target: "pinned", activate: false, now: T0 });
  }
  s = reducer(s, { type: "createFolder", spaceId: work, title: "Docs", now: T0 });
  s = reducer(s, { type: "createTab", url: "https://today.example/", target: "today", activate: true, now: T0 });
  return s;
}

describe("canonical JSON and hashing", () => {
  it("ignores key order", () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(stableStringify({ a: [{ c: 3, d: 2 }], b: 1 }));
    expect(hashString("a")).not.toBe(hashString("b"));
    expect(hashString("same")).toBe(hashString("same"));
  });
});

describe("projection", () => {
  it("includes spaces, pinned items, favorites and settings, never today tabs or open-page state", () => {
    const s = customizedDevice();
    const records = projectRecords(s);
    const ids = [...records.keys()];
    expect(ids).toContain("settings");
    expect(ids).toContain("favorites");
    expect(ids.filter((id) => id.startsWith("space:"))).toHaveLength(2);
    expect([...records.values()].some((json) => json.includes("today.example"))).toBe(false);
    expect([...records.values()].some((json) => json.includes("lastActiveAt"))).toBe(false);
  });

  it("does not change when only volatile state changes", () => {
    let s = customizedDevice();
    const before = projectRecords(s);
    const pinnedTab = s.items[spaceOf(s).pinnedId].childrenIds[0];
    s = run(s, { type: "activate", id: pinnedTab, now: T0 + 1000 }, { type: "updateTab", id: pinnedTab, url: "https://github.com/deep/page", now: T0 + 2000 });
    expect(projectRecords(s)).toEqual(before);
  });
});

describe("two devices through the server", () => {
  it("brings a customized sidebar to a fresh device (pristine adoption, no duplicate space)", () => {
    const server = new FakeServer();
    const a = syncCycle(customizedDevice(), server);
    let b = createInitialState(T0 + 5);
    b = { ...b, sync: emptySyncMeta("me@yzo.app") };
    b = reducer(b, { type: "createTab", url: "https://b-today.example/", target: "today", activate: true, now: T0 });
    expect(isPristine(b)).toBe(true);
    b = syncCycle(b, server);
    expect(b.spaceOrder).toEqual(a.spaceOrder);
    for (const spaceId of a.spaceOrder) expect(pinnedUrls(b, spaceId)).toEqual(pinnedUrls(a, spaceId));
    // B's own today tab survives the adoption.
    const todays = b.spaceOrder.flatMap((id) => b.items[b.spaces[id].todayId].childrenIds);
    expect(todays.some((id) => isTab(b.items[id]) && b.items[id].data.url === "https://b-today.example/")).toBe(true);
    // Nothing left to push: both devices converge.
    expect(collectChanges(b, b.sync).records).toHaveLength(0);
  });

  it("propagates edits, moves and deletions both ways", () => {
    const server = new FakeServer();
    let a = syncCycle(customizedDevice(), server);
    let b = syncCycle({ ...createInitialState(T0), sync: emptySyncMeta("me@yzo.app") }, server);
    const work = a.spaceOrder[1];

    // A renames the space and pins a new tab; B deletes the folder.
    a = run(a, { type: "updateSpace", id: work, name: "Boulot" }, { type: "createTab", url: "https://notion.so/", target: "pinned", spaceId: work, activate: false, now: T0 });
    const folder = b.items[b.spaces[work].pinnedId].childrenIds.find((id) => b.items[id].data.kind === "folder")!;
    b = run(b, { type: "deleteFolder", id: folder, now: T0 });

    a = syncCycle(a, server);
    b = syncCycle(b, server);
    a = syncCycle(a, server);

    for (const s of [a, b]) {
      expect(s.spaces[work].name).toBe("Boulot");
      expect(pinnedUrls(s, work)).toEqual(["https://github.com/", "https://linear.app/team", "https://notion.so/"]);
    }
    expect(collectChanges(a, a.sync).records).toHaveLength(0);
    expect(collectChanges(b, b.sync).records).toHaveLength(0);
  });

  it("keeps a local change made concurrently and makes the other device converge to it", () => {
    const server = new FakeServer();
    let a = syncCycle(customizedDevice(), server);
    let b = syncCycle({ ...createInitialState(T0), sync: emptySyncMeta("me@yzo.app") }, server);
    const work = a.spaceOrder[1];
    a = reducer(a, { type: "updateSpace", id: work, name: "From A" });
    b = reducer(b, { type: "updateSpace", id: work, name: "From B" });
    a = syncCycle(a, server); // A pushes first.
    b = syncCycle(b, server); // B pulls A's change but keeps its own unpushed edit, then overwrites.
    a = syncCycle(a, server);
    expect(b.spaces[work].name).toBe("From B");
    expect(a.spaces[work].name).toBe("From B");
  });

  it("repairs a tree whose parent was deleted remotely", () => {
    const server = new FakeServer();
    let a = syncCycle(customizedDevice(), server);
    let b = syncCycle({ ...createInitialState(T0), sync: emptySyncMeta("me@yzo.app") }, server);
    const work = a.spaceOrder[1];
    const folder = a.items[a.spaces[work].pinnedId].childrenIds.find((id) => a.items[id].data.kind === "folder")!;
    const tab = a.items[a.spaces[work].pinnedId].childrenIds.find((id) => isTab(a.items[id]))!;
    // A moves a tab into the folder while B deletes that folder.
    a = run(a, { type: "moveItem", id: tab, parentId: folder });
    b = run(b, { type: "deleteFolder", id: folder, now: T0 });
    b = syncCycle(b, server);
    a = syncCycle(a, server);
    for (const item of Object.values(a.items)) {
      if (item.parentId) expect(a.items[item.parentId]?.childrenIds).toContain(item.id);
      for (const child of item.childrenIds) expect(a.items[child]?.parentId).toBe(item.id);
    }
  });

  it("does not push anything when nothing changed", () => {
    const server = new FakeServer();
    const a = syncCycle(customizedDevice(), server);
    const before = server.version;
    syncCycle(a, server);
    expect(server.version).toBe(before);
  });
});
