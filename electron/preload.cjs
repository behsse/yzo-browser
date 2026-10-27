// Preload for the browser UI. Exposes a narrow, typed bridge; web pages never get this preload.
const { contextBridge, ipcRenderer } = require("electron");

/**
 * Subscribes to a main-process channel and returns an unsubscribe function.
 * @param {string} channel IPC channel.
 * @param {(payload: unknown) => void} callback Listener receiving the payload only.
 * @returns {() => void} Unsubscribe function.
 */
function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("yzo", {
  loadState: () => ipcRenderer.invoke("state:load"),
  saveState: (json) => ipcRenderer.invoke("state:save", json),
  windowControl: (action) => ipcRenderer.send("window:control", action),
  windowDrag: () => ipcRenderer.send("window:drag"),
  onWindowMoved: (callback) => subscribe("window:moved", callback),
  isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  isFullScreen: () => ipcRenderer.invoke("window:isFullScreen"),
  cursorPosition: () => ipcRenderer.invoke("window:cursor"),
  checkForUpdates: () => ipcRenderer.invoke("app:checkForUpdates"),
  openPrivateWindow: () => ipcRenderer.send("app:openPrivate"),
  site: {
    info: (webContentsId, url) => ipcRenderer.invoke("site:info", webContentsId, url),
    setShield: (url, enabled) => ipcRenderer.invoke("site:setShield", url, enabled),
    showCertificate: (host) => ipcRenderer.invoke("site:certificate", host),
    clear: (url, kind) => ipcRenderer.invoke("site:clear", url, kind),
  },
  importArc: () => ipcRenderer.invoke("arc:import"),
  resolveFavicon: (url) => ipcRenderer.invoke("favicon:resolve", url),
  showMenu: (entries, x, y) => ipcRenderer.invoke("menu:popup", entries, x, y),
  syncViews: (payload) => ipcRenderer.send("views:sync", payload),
  tabCommand: (tabId, command, arg) => ipcRenderer.invoke("tab:command", tabId, command, arg),
  onTabEvent: (callback) => subscribe("tab:event", callback),
  // Tab requests coming from extensions (chrome.tabs.create / update / remove).
  onTabCreate: (callback) => subscribe("tab:create", callback),
  onTabActivate: (callback) => subscribe("tab:activate", callback),
  onTabClose: (callback) => subscribe("tab:close", callback),
  listExtensions: () => ipcRenderer.invoke("extensions:list"),
  // Yzo account and sync. Keys and the session token stay in the main process.
  account: {
    status: () => ipcRenderer.invoke("account:status"),
    signUp: (serverUrl, email, password) => ipcRenderer.invoke("account:signUp", serverUrl, email, password),
    signIn: (serverUrl, email, password) => ipcRenderer.invoke("account:signIn", serverUrl, email, password),
    signOut: () => ipcRenderer.invoke("account:signOut"),
    deleteAccount: () => ipcRenderer.invoke("account:delete"),
    push: (records) => ipcRenderer.invoke("sync:push", records),
    pull: (since) => ipcRenderer.invoke("sync:pull", since),
  },
  uninstallExtension: (id) => ipcRenderer.invoke("extensions:uninstall", id),
  setExtensionEnabled: (id, enabled) => ipcRenderer.invoke("extensions:setEnabled", id, enabled),
  onMaximized: (callback) => subscribe("window:maximized", callback),
  onFullScreen: (callback) => subscribe("window:fullscreen", callback),
  onShortcut: (callback) => subscribe("shortcut", callback),
  onPeek: (callback) => subscribe("peek:open", callback),
  onOpenTab: (callback) => subscribe("tab:open", callback),
});
