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
});
