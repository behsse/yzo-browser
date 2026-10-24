import { describe, expect, it } from "vitest";
import { isArchivable, THRESHOLD_MS } from "./autoArchive";
import { dedupKey, matchScore } from "./commandBar";
import { floatingSidebarDecision } from "./floatingSidebar";
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

  it("stays open in the left column, including its top, bottom and left margins", () => {
    for (const [x, y] of [[120, 2], [120, 897], [1, 400], [249, 400]]) {
      expect(floatingSidebarDecision({ x, y, ...window }, zone)).toBe("keep");
    }
  });

  it("stays open when the cursor leaves the window by the top, bottom or left", () => {
    for (const [x, y] of [[120, -30], [600, -5], [600, 950], [-40, 400]]) {
      expect(floatingSidebarDecision({ x, y, ...window }, zone)).toBe("keep");
    }
  });

  it("closes when the cursor goes right, onto the page or out of the window on that side", () => {
    expect(floatingSidebarDecision({ x: 252, y: 400, ...window }, zone)).toBe("hide");
    expect(floatingSidebarDecision({ x: 900, y: 10, ...window }, zone)).toBe("hide");
    expect(floatingSidebarDecision({ x: 1500, y: 400, ...window }, zone)).toBe("hide");
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
