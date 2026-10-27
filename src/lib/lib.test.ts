import { describe, expect, it } from "vitest";
import { isArchivable, THRESHOLD_MS } from "./autoArchive";
import { dedupKey, matchScore } from "./commandBar";
import { DOWNLOADS_URL, EXTENSIONS_URL, extensionDetailsUrl, isInternalUrl, parseInternalUrl, settingsUrl, siteSettingsUrl } from "./internalPages";
import { downloadProgress, groupByDay } from "./downloads";
import { dropPlacement, dropPreview, dropSide } from "./splitDrop";
import { cursorOnTopEdge, floatingSidebarDecision, floatingTopBarDecision } from "./floatingSidebar";
import { matchShortcut, shortcutLabel } from "./shortcuts";
import { hexToRgb, relativeLuminance, resolveAppearance, rgbToHex } from "./theme";
import { displayHost, isNavigableUrl, looksLikeUrl, toNavigableUrl } from "./url";

describe("url", () => {
  it("keeps explicit http(s) URLs", () => {
    expect(toNavigableUrl("https://example.com/a?b=1", "google")).toBe("https://example.com/a?b=1");
  });

  it("adds https to bare domains and http to local hosts", () => {
    expect(toNavigableUrl("arc.net", "google")).toBe("https://arc.net");
    expect(toNavigableUrl("localhost:5173", "google")).toBe("http://localhost:5173");
    expect(toNavigableUrl("192.168.1.10:8080/x", "google")).toBe("http://192.168.1.10:8080/x");
  });

  it("turns free text into an encoded search", () => {
    expect(toNavigableUrl("arc browser & co", "duckduckgo")).toBe("https://duckduckgo.com/?q=arc%20browser%20%26%20co");
  });

  it("never lets dangerous schemes through", () => {
    for (const input of ["javascript:alert(1)", "file:///C:/Windows", "data:text/html,x", "chrome://settings"]) {
      expect(isNavigableUrl(input)).toBe(false);
      expect(toNavigableUrl(input, "google").startsWith("https://www.google.com/search?q=")).toBe(true);
    }
  });

  it("allows extension pages (options, extension tabs)", () => {
    const options = "chrome-extension://cjpalhdlnbpafiamejdnhcphjbkeiagm/options.html";
    expect(isNavigableUrl(options)).toBe(true);
    expect(toNavigableUrl(options, "google")).toBe(options);
  });

  it("detects URLs without treating sentences as hosts", () => {
    expect(looksLikeUrl("github.com/user/repo")).toBe(true);
    expect(looksLikeUrl("café.fr")).toBe(true);
    expect(looksLikeUrl("hello world.com")).toBe(false);
    expect(looksLikeUrl("version 1.2")).toBe(false);
    expect(looksLikeUrl("")).toBe(false);
  });

  it("shows hosts without www", () => {
    expect(displayHost("https://www.youtube.com/watch?v=1")).toBe("youtube.com");
    expect(displayHost("not a url")).toBe("not a url");
  });
});

describe("internal pages", () => {
  it("recognizes yzo:// addresses", () => {
    expect(isInternalUrl("yzo://settings/sites/twitch.tv")).toBe(true);
    expect(isInternalUrl("https://twitch.tv")).toBe(false);
  });

  it("round-trips a site settings address, port included", () => {
    expect(parseInternalUrl(siteSettingsUrl("Twitch.tv"))).toEqual({ kind: "siteSettings", host: "twitch.tv" });
    expect(parseInternalUrl(siteSettingsUrl("localhost:5173"))).toEqual({ kind: "siteSettings", host: "localhost:5173" });
  });

  it("rejects unknown pages and odd hosts", () => {
    expect(parseInternalUrl("yzo://settings/sites/a b")).toEqual({ kind: "notFound" });
    expect(parseInternalUrl("yzo://settings/sites/x.com/../y")).toEqual({ kind: "notFound" });
  });

  it("routes the extensions page and an extension's details", () => {
    const id = "cjpalhdlnbpafiamejdnhcphjbkeiagm";
    expect(parseInternalUrl(EXTENSIONS_URL)).toEqual({ kind: "extensions" });
    expect(parseInternalUrl(extensionDetailsUrl(id))).toEqual({ kind: "extensionDetails", id });
    expect(parseInternalUrl("yzo://extensions/not-an-id")).toEqual({ kind: "notFound" });
  });

  it("opens the first settings section for yzo://settings and rejects unknown ones", () => {
    expect(parseInternalUrl("yzo://settings")).toEqual({ kind: "settings", section: "account" });
    expect(parseInternalUrl(settingsUrl("downloads"))).toEqual({ kind: "settings", section: "downloads" });
    expect(parseInternalUrl("yzo://settings/nope")).toEqual({ kind: "notFound" });
    expect(parseInternalUrl(siteSettingsUrl("x.com"))).toEqual({ kind: "siteSettings", host: "x.com" });
    expect(parseInternalUrl(DOWNLOADS_URL)).toEqual({ kind: "downloads" });
  });

  it("shows the whole address of a Yzo page", () => {
    expect(displayHost("yzo://settings/sites/twitch.tv")).toBe("yzo://settings/sites/twitch.tv");
  });
});

describe("downloads", () => {
  it("measures progress, 0 when the size is unknown", () => {
    expect(downloadProgress({ receivedBytes: 50, totalBytes: 200 })).toBe(0.25);
    expect(downloadProgress({ receivedBytes: 50, totalBytes: 0 })).toBe(0);
    expect(downloadProgress({ receivedBytes: 300, totalBytes: 200 })).toBe(1);
  });

  it("groups downloads by day, keeping their order", () => {
    const at = (iso: string, id: string) => ({ id, startTime: new Date(iso).getTime() }) as Parameters<typeof groupByDay>[0][number];
    const groups = groupByDay([at("2026-10-27T15:00:00", "a"), at("2026-10-27T09:00:00", "b"), at("2026-10-25T12:00:00", "c")], "en-US");
    expect(groups.map((g) => g.entries.map((e) => e.id))).toEqual([["a", "b"], ["c"]]);
    expect(groups[0].day).toBe("October 27, 2026");
  });
});

describe("split drop", () => {
  const rect = { left: 0, top: 0, width: 400, height: 200 };

  it("picks the nearest side of a single page, and only sides along a split", () => {
    expect(dropSide(20, 100, rect)).toBe("left");
    expect(dropSide(390, 100, rect)).toBe("right");
    expect(dropSide(200, 10, rect)).toBe("top");
    expect(dropSide(200, 190, rect)).toBe("bottom");
    expect(dropSide(200, 10, rect, "horizontal")).toBe("right");
    expect(dropSide(20, 150, rect, "vertical")).toBe("bottom");
  });

  it("places the dropped tab before or after the pane, with the side's orientation", () => {
    expect(dropPlacement("left", 1)).toEqual({ index: 1, orientation: "horizontal" });
    expect(dropPlacement("bottom", 1)).toEqual({ index: 2, orientation: "vertical" });
  });

  it("previews the half of the page on the drop side", () => {
    expect(dropPreview("right", rect)).toEqual({ left: 200, top: 0, width: 200, height: 200 });
    expect(dropPreview("top", rect)).toEqual({ left: 0, top: 0, width: 400, height: 100 });
  });
});

describe("autoArchive", () => {
  it("archives exactly at the threshold", () => {
    const now = 1_000_000_000_000;
    expect(isArchivable(now - THRESHOLD_MS.twelveHours, "twelveHours", now)).toBe(true);
    expect(isArchivable(now - THRESHOLD_MS.twelveHours + 1, "twelveHours", now)).toBe(false);
  });

  it("never archives with the never threshold", () => {
    expect(isArchivable(0, "never", Number.MAX_SAFE_INTEGER)).toBe(false);
  });
});

describe("theme", () => {
  it("round-trips colors", () => {
    expect(rgbToHex(1, 0.5, 0)).toBe("#ff8000");
    expect(hexToRgb("#ff8000")).toEqual([255, 128, 0]);
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
    expect(hexToRgb("blue")).toBeNull();
  });

  it("computes WCAG luminance bounds", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1);
    expect(relativeLuminance("#000000")).toBe(0);
  });

  it("picks readable text for auto themes", () => {
    expect(resolveAppearance({ colors: ["#ffffff", "#eeeeee"], mode: "auto" })).toBe("light");
    expect(resolveAppearance({ colors: ["#101010", "#202040"], mode: "auto" })).toBe("dark");
    expect(resolveAppearance({ colors: ["#ffffff", "#ffffff"], mode: "dark" })).toBe("dark");
  });
});

describe("shortcuts", () => {
  it("distinguishes modifiers exactly", () => {
    expect(matchShortcut({ key: "t", ctrl: true, shift: false, alt: false })).toBe("newTab");
    expect(matchShortcut({ key: "T", ctrl: true, shift: true, alt: false })).toBe("reopenClosed");
    expect(matchShortcut({ key: "t", ctrl: false, shift: false, alt: false })).toBeNull();
  });

  it("handles named keys and the split binding variants", () => {
    expect(matchShortcut({ key: "ArrowLeft", ctrl: false, shift: false, alt: true })).toBe("back");
    expect(matchShortcut({ key: "+", ctrl: true, shift: true, alt: false })).toBe("addSplit");
    expect(matchShortcut({ key: "3", ctrl: true, shift: false, alt: false })).toBe("switchSpace3");
  });

  it("formats labels", () => {
    expect(shortcutLabel("reopenClosed")).toBe("Ctrl+Shift+T");
    expect(shortcutLabel("back")).toBe("Alt+Left");
  });
});

describe("floating sidebar hover zone", () => {
  const window = { width: 1400, height: 900 };
  const zone = 252;
  const topBar = 38;

  it("stays open in the left column below the top bar, including its bottom and left margins", () => {
    for (const [x, y] of [[120, 40], [120, 897], [1, 400], [249, 400]]) {
      expect(floatingSidebarDecision({ x, y, ...window }, zone, topBar)).toBe("keep");
    }
  });

  it("stays open when the cursor leaves the window by the bottom or left", () => {
    for (const [x, y] of [[600, 950], [-40, 400]]) {
      expect(floatingSidebarDecision({ x, y, ...window }, zone, topBar)).toBe("keep");
    }
  });

  it("closes when the cursor reaches the top bar or leaves the window by the top", () => {
    for (const [x, y] of [[120, 20], [10, 0], [120, -30]]) {
      expect(floatingSidebarDecision({ x, y, ...window }, zone, topBar)).toBe("hide");
    }
  });

  it("closes when the cursor goes right, onto the page or out of the window on that side", () => {
    expect(floatingSidebarDecision({ x: 252, y: 400, ...window }, zone, topBar)).toBe("hide");
    expect(floatingSidebarDecision({ x: 1500, y: 400, ...window }, zone, topBar)).toBe("hide");
  });
});

describe("floating top bar hover zone", () => {
  const window = { width: 1400, height: 900 };

  it("stays open on the bar, a little below it, and above the window", () => {
    for (const [x, y] of [[700, 10], [5, 35], [1390, -20]]) expect(floatingTopBarDecision({ x, y, ...window }, 32)).toBe("keep");
  });

  it("closes below the bar or out of the window on the sides", () => {
    for (const [x, y] of [[700, 60], [-10, 10], [1500, 10]]) expect(floatingTopBarDecision({ x, y, ...window }, 32)).toBe("hide");
  });

  it("reveals the hidden top bar from the top edge only, inside the window", () => {
    for (const [x, y] of [[700, 0], [5, 7]]) expect(cursorOnTopEdge({ x, y, ...window }, 8)).toBe(true);
    for (const [x, y] of [[700, 8], [700, -1], [-1, 2], [1400, 2]]) expect(cursorOnTopEdge({ x, y, ...window }, 8)).toBe(false);
  });

  it("lets the floating sidebar stay open above the window when the top bar is hidden", () => {
    expect(floatingSidebarDecision({ x: 100, y: -10, ...window }, 252, 0)).toBe("keep");
    expect(floatingSidebarDecision({ x: 100, y: 5, ...window }, 252, 0)).toBe("keep");
    expect(floatingSidebarDecision({ x: 100, y: 5, ...window }, 252, 32)).toBe("hide");
  });
});

describe("commandBar helpers", () => {
  it("dedups listed hosts by title and others by URL", () => {
    expect(dedupKey("https://www.figma.com/file/abc?node=1", "Design")).toBe(dedupKey("https://figma.com/file/abc?node=2", "design"));
    expect(dedupKey("https://example.com/a#x", "A")).toBe("https://example.com/a");
    expect(dedupKey("https://example.com/a", "A")).not.toBe(dedupKey("https://example.com/b", "A"));
  });

  it("requires every token to match and favors hosts", () => {
    expect(matchScore(["git", "repo"], "My repo", "https://github.com/x")).toBeGreaterThan(0);
    expect(matchScore(["git", "zzz"], "My repo", "https://github.com/x")).toBe(0);
    expect(matchScore(["you"], "Video", "https://youtube.com")).toBeGreaterThan(matchScore(["you"], "Is it you", "https://a.com"));
  });
});
