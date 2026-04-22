const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  onTriggerQuickEntry: (callback) => {
    ipcRenderer.on("trigger-quick-entry", () => callback());
  },
  onRefreshData: (callback) => {
    ipcRenderer.on("refresh-data", () => callback());
  },
});
