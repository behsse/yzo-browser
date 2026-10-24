import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { ICON_PATHS } from "../ui/Icon";

// Only the pure validation is tested here; require("electron") outside Electron yields a path string,
// which menu-popup.cjs does not touch until createMenuPopup() is called.
const require = createRequire(import.meta.url);
const { sanitizeEntries } = require("../../electron/menu-popup.cjs");

describe("popup menu entries", () => {
  it("keeps labels, flags, separators and the original index of each entry", () => {
    const entries = sanitizeEntries([
      { label: "New Tab", hint: "Ctrl+T", icon: ICON_PATHS.tab },
      "separator",
      { label: "Delete", danger: true },
      { label: "Soon", disabled: true },
    ]);
    expect(entries).toEqual([
      { index: 0, label: "New Tab", hint: "Ctrl+T", icon: ICON_PATHS.tab, danger: false, disabled: false },
      { separator: true },
      { index: 2, label: "Delete", hint: undefined, icon: undefined, danger: true, disabled: false },
      { index: 3, label: "Soon", hint: undefined, icon: undefined, danger: false, disabled: true },
    ]);
  });

  it("accepts every icon path the UI can send", () => {
    const entries = sanitizeEntries(Object.values(ICON_PATHS).map((icon) => ({ label: "x", icon })));
    expect(entries.every((entry: { icon?: string }) => entry.icon)).toBe(true);
  });

  it("drops icons that are not plain path data", () => {
    const [entry] = sanitizeEntries([{ label: "x", icon: '"/><script>alert(1)</script>' }]);
    expect(entry.icon).toBeUndefined();
  });

  it("rejects malformed menus", () => {
    expect(sanitizeEntries([])).toBeNull();
    expect(sanitizeEntries("menu")).toBeNull();
    expect(sanitizeEntries([{ icon: "M0 0" }])).toBeNull();
    expect(sanitizeEntries(Array.from({ length: 65 }, () => ({ label: "x" })))).toBeNull();
  });

  it("truncates oversized labels", () => {
    const [entry] = sanitizeEntries([{ label: "a".repeat(500) }]);
    expect(entry.label).toHaveLength(200);
  });
});
