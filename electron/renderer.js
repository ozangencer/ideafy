// Injected into the renderer process by main.js after page load.
// Bridges Electron IPC events to DOM CustomEvents that the React app listens for.
if (window.electronAPI) {
  if (window.electronAPI.onTriggerQuickEntry) {
    window.electronAPI.onTriggerQuickEntry(() => {
      window.dispatchEvent(new CustomEvent("trigger-quick-entry"));
    });
  }

  if (window.electronAPI.onRefreshData) {
    window.electronAPI.onRefreshData(() => {
      window.dispatchEvent(new CustomEvent("refresh-data"));
    });
  }

  window.addEventListener("quick-entry-closed", () => {
    if (window.electronAPI.notifyQuickEntryClosed) {
      window.electronAPI.notifyQuickEntryClosed();
    }
  });

  // Restore auth tokens from OS keychain on app startup
  if (window.electronAPI.onAuthRestoreTokens) {
    window.electronAPI.onAuthRestoreTokens((tokens) => {
      window.dispatchEvent(
        new CustomEvent("auth-restore-tokens", { detail: tokens })
      );
    });
  }
}
