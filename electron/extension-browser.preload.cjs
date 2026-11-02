// Extension pages and service workers: `browser` is the same object as `chrome`.
//
// Chromium now exposes a native `browser` namespace to extensions, separate from `chrome`.
// electron-chrome-extensions adds the APIs Electron lacks (permissions, commands, tabs, windows…) to
// `chrome` only, and extensions that prefer `browser` (uBlock Origin Lite) crash on the missing ones:
// its service worker stops at startup and its popup shows "No website".
const { contextBridge } = require("electron");

if (process.type === "service-worker" || location.href.startsWith("chrome-extension://")) {
  contextBridge.executeInMainWorld({
    func: () => {
      if (typeof chrome === "object" && chrome !== null) {
        Object.defineProperty(globalThis, "browser", { value: chrome, configurable: true, writable: true, enumerable: true });
      }
    },
  });
}
