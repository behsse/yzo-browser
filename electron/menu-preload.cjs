// Preload of the popup menu layer (electron/menu.html). Exposes only what the menu page needs.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("menuHost", {
  onShow: (callback) => ipcRenderer.on("menu:show", (_event, spec) => callback(spec)),
  resize: (token, width, height) => ipcRenderer.send("menu:resize", token, width, height),
  select: (token, index) => ipcRenderer.send("menu:select", token, index),
  close: (token) => ipcRenderer.send("menu:close", token),
});
