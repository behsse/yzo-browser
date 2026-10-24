import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THRESHOLD_MS, THRESHOLDS } from "./autoArchive";
import { DICTIONARIES, resolveLocale, translate, type Locale, type MessageKey } from "./i18n";

const ROOT = join(__dirname, "../..");

/**
 * Lists the `{name}` placeholders of a message, sorted.
 * @param text Message template.
 * @returns Placeholder names.
 */
function placeholdersOf(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

/**
 * Collects the literal keys passed to t("…") in the source files of a directory tree.
 * @param dir Directory relative to the repository root.
 * @param extensions File extensions to scan.
 * @returns Keys found.
 */
function usedKeys(dir: string, extensions: string[]): string[] {
  const keys: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })) {
    if (!extensions.some((ext) => entry.endsWith(ext)) || entry.endsWith(".test.ts") || entry.includes("generated")) continue;
    const source = readFileSync(join(ROOT, dir, entry), "utf8");
    for (const match of source.matchAll(/\bt\("([^"]+)"\s*[,)]/g)) keys.push(match[1]);
  }
  return keys;
}

describe("i18n", () => {
  it("resolves French tags to fr and everything else to en", () => {
    expect(resolveLocale("fr")).toBe("fr");
    expect(resolveLocale("fr-CA")).toBe("fr");
    expect(resolveLocale("FR_fr")).toBe("fr");
    expect(resolveLocale("en-US")).toBe("en");
    expect(resolveLocale("de-DE")).toBe("en");
    expect(resolveLocale("")).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
  });

  it("translates and fills placeholders", () => {
    expect(translate("en", "space.new")).toBe("New space");
    expect(translate("fr", "space.new")).toBe("Nouvel espace");
    expect(translate("en", "extensions.removed", { name: "uBlock" })).toBe("uBlock removed");
    expect(translate("fr", "space.color", { n: 2 })).toBe("Couleur 2");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(translate("en", "extensions.removed", {})).toBe("{name} removed");
  });

  it("falls back to English, then to the key", () => {
    const fr = DICTIONARIES.fr;
    const saved = fr["space.new"];
    delete fr["space.new"];
    try {
      expect(translate("fr", "space.new")).toBe("New space");
    } finally {
      fr["space.new"] = saved;
    }
    expect(translate("en", "does.not.exist" as MessageKey)).toBe("does.not.exist");
  });

  it("has the same keys in every locale", () => {
    const reference = Object.keys(DICTIONARIES.en).sort();
    for (const locale of Object.keys(DICTIONARIES) as Locale[]) {
      expect(Object.keys(DICTIONARIES[locale]).sort(), locale).toEqual(reference);
    }
  });

  it("has the same placeholders and no empty message in every locale", () => {
    for (const [key, english] of Object.entries(DICTIONARIES.en)) {
      for (const locale of Object.keys(DICTIONARIES) as Locale[]) {
        const text = DICTIONARIES[locale][key as MessageKey] ?? "";
        expect(text.trim(), `${locale} ${key}`).not.toBe("");
        expect(placeholdersOf(text), `${locale} ${key}`).toEqual(placeholdersOf(english));
      }
    }
  });

  it("defines every key used by the UI and the main process", () => {
    const keys = [...usedKeys("src", [".ts", ".tsx"]), ...usedKeys("electron", [".cjs"])];
    expect(keys.length).toBeGreaterThan(50);
    expect(keys.filter((key) => !(key in DICTIONARIES.en))).toEqual([]);
  });

  it("labels every permission the extension install prompt describes", () => {
    const source = readFileSync(join(ROOT, "electron/extensions.cjs"), "utf8");
    const block = source.match(/LABELLED_PERMISSIONS = new Set\(\[([^\]]+)\]/)?.[1] ?? "";
    const permissions = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(permissions).toContain("<all_urls>");
    for (const permission of permissions) expect(DICTIONARIES.en).toHaveProperty([`permission.${permission}`]);
  });

  it("labels every auto-archive threshold", () => {
    expect([...THRESHOLDS].sort()).toEqual(Object.keys(THRESHOLD_MS).sort());
    for (const value of THRESHOLDS) expect(DICTIONARIES.en).toHaveProperty([`autoArchive.${value}`]);
  });
});
