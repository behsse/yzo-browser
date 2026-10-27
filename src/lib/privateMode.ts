/** True in a private instance: the main process loads the UI with "?private" (electron/private-mode.cjs). */
export const IS_PRIVATE = new URLSearchParams(window.location.search).has("private");
