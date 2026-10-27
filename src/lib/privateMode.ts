import type { SpaceTheme } from "../state/types";

/** True in a private instance: the main process loads the UI with "?private" (electron/private-mode.cjs). */
export const IS_PRIVATE = new URLSearchParams(window.location.search).has("private");

/** Near-black look of every private window (Twitch's dark mode greys), whatever the space's own colors. */
export const PRIVATE_THEME: SpaceTheme = { colors: ["#1f1f23", "#0e0e10"], mode: "dark" };

/**
 * Theme to draw a space with: its own, or the private look in a private window.
 * @param theme Space theme.
 * @returns Theme to display.
 */
export function displayTheme(theme: SpaceTheme): SpaceTheme {
  return IS_PRIVATE ? PRIVATE_THEME : theme;
}
