const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  onTriggerQuickEntry: (callback) => {
    ipcRenderer.on("trigger-quick-entry", () => callback());
  },
  onRefreshData: (callback) => {
    ipcRenderer.on("refresh-data", () => callback());
  },
  notifyQuickEntryClosed: () => {
    ipcRenderer.send("quick-entry-closed");
  },
  // Secure auth token persistence
  onAuthRestoreTokens: (callback) => {
    ipcRenderer.on("auth-restore-tokens", (_event, tokens) => callback(tokens));
  },
  updateAuthTokens: (tokens) => {
    ipcRenderer.send("auth-token-update", tokens);
  },
  signOut: () => {
    ipcRenderer.send("auth-sign-out");
  },
});
