const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  onTriggerQuickEntry: (callback) => {
    ipcRenderer.on("trigger-quick-entry", () => callback());
  },
  onRefreshData: (callback) => {
    ipcRenderer.on("refresh-data", () => callback());
  },
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
});
