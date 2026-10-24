import type { SpaceTheme, ThemeMode } from "../state/types";

/**
 * Color picker palettes. The sRGB components come from the color assets shipped in Arc's space
 * style editor (re/ARC-REVERSE-ENGINEERING.md §4.5), converted to hex.
 */
export const PALETTES: Record<"pastel" | "drab" | "greyscale", string[]> = {
  pastel: [
    rgbToHex(0.994, 0.984, 0.981),
    rgbToHex(0.985, 0.917, 0.951),
    rgbToHex(0.924, 0.825, 0.918),
    rgbToHex(0.968, 0.804, 0.822),
    rgbToHex(0.98, 0.882, 0.834),
    rgbToHex(0.996, 0.977, 0.906),
    rgbToHex(0.894, 0.988, 0.926),
    rgbToHex(0.88, 0.95, 0.984),
    rgbToHex(0.774, 0.776, 0.888),
  ],
  drab: [
    rgbToHex(0.294, 0.231, 0.345),
    rgbToHex(0.384, 0.22, 0.337),
    rgbToHex(0.522, 0.267, 0.267),
    rgbToHex(0.655, 0.439, 0.282),
    rgbToHex(0.82, 0.706, 0.416),
    rgbToHex(0.804, 0.8, 0.659),
    rgbToHex(0.518, 0.659, 0.522),
    rgbToHex(0.204, 0.376, 0.294),
    rgbToHex(0.176, 0.267, 0.408),
  ],
  greyscale: [1, 0.9, 0.8, 0.7, 0.5, 0.4, 0.2, 0.1, 0].map((v) => rgbToHex(v, v, v)),
};

export const DEFAULT_THEME: SpaceTheme = {
  colors: [PALETTES.pastel[7], PALETTES.pastel[8]],
  mode: "auto",
};

/**
 * Converts 0–1 sRGB components to a #rrggbb string.
 * @param r Red component in [0, 1].
 * @param g Green component in [0, 1].
 * @param b Blue component in [0, 1].
 * @returns Lowercase hex color.
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const part = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/**
 * Parses a #rgb or #rrggbb color.
 * @param hex Color string.
 * @returns Components in [0, 255], or null for an invalid color.
 */
export function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((c) => c + c).join("") : match[1];
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * Relative luminance as defined by WCAG 2.x.
 * @param hex Color string.
 * @returns Luminance in [0, 1]; 0 for an invalid color.
 */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Picks the sidebar appearance for a space: an explicit light/dark mode wins, "auto" follows the
 * gradient brightness so text always contrasts with the background.
 * @param theme Space theme.
 * @returns "light" when dark text should be used, "dark" for light text.
 */
export function resolveAppearance(theme: SpaceTheme): Exclude<ThemeMode, "auto"> {
  if (theme.mode !== "auto") return theme.mode;
  const average = (relativeLuminance(theme.colors[0]) + relativeLuminance(theme.colors[1])) / 2;
  return average > 0.4 ? "light" : "dark";
}

/**
 * Builds the CSS background of a space's sidebar. Dark mode darkens the gradient so the sidebar
 * keeps the space's hue without glaring.
 * @param theme Space theme.
 * @returns CSS background value.
 */
export function sidebarBackground(theme: SpaceTheme): string {
  const [from, to] = theme.colors;
  if (theme.mode === "dark") {
    return `linear-gradient(160deg, color-mix(in srgb, ${from} 35%, #111) 0%, color-mix(in srgb, ${to} 35%, #111) 100%)`;
  }
  return `linear-gradient(160deg, ${from} 0%, ${to} 100%)`;
}
