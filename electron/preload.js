const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  onTriggerQuickEntry: (callback) => {
    ipcRenderer.on("trigger-quick-entry", () => callback());
  },
  onRefreshData: (callback) => {
    ipcRenderer.on("refresh-data", () => callback());
  },
  onQuitConfirmRequest: (callback) => {
    ipcRenderer.on("quit-confirm-request", () => callback());
  },
  sendQuitConfirmResponse: (confirm) => {
    ipcRenderer.send("quit-confirm-response", confirm === true);
  },
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
  openPath: (filePath) => ipcRenderer.invoke("open-path", filePath),
  revealPath: (filePath) => ipcRenderer.invoke("reveal-path", filePath),
  updates: {
    getState: () => ipcRenderer.invoke("updates:get-state"),
    check: () => ipcRenderer.invoke("updates:check"),
    download: () => ipcRenderer.invoke("updates:download"),
    install: () => ipcRenderer.invoke("updates:install"),
    // Returns an unsubscribe so React effects can clean up; without it every
    // remount would stack another listener on the same channel.
    onState: (callback) => {
      const handler = (_event, state) => callback(state);
      ipcRenderer.on("update-state", handler);
      return () => ipcRenderer.removeListener("update-state", handler);
    },
    // Fired when the user clicks the "update available" OS notification.
    onOpenUpdates: (callback) => {
      ipcRenderer.on("open-updates", () => callback());
    },
  },
});
