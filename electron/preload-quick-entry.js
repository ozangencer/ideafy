const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  closeQuickEntryWindow: () => {
    ipcRenderer.send("close-quick-entry-window");
  },
  resizeWindow: (height) => {
    ipcRenderer.send("resize-quick-entry", height);
  },
});
