import type { SpaceTheme } from "../state/types";

/** True in a private instance: the main process loads the UI with "?private" (electron/private-mode.cjs). */
export const IS_PRIVATE = new URLSearchParams(window.location.search).has("private");

/** Dark violet look of every private window, like Zen's, whatever the space's own colors. */
export const PRIVATE_THEME: SpaceTheme = { colors: ["#8a4fd8", "#4b2391"], mode: "dark" };

/**
 * Theme to draw a space with: its own, or the private look in a private window.
 * @param theme Space theme.
 * @returns Theme to display.
 */
export function displayTheme(theme: SpaceTheme): SpaceTheme {
  return IS_PRIVATE ? PRIVATE_THEME : theme;
}
