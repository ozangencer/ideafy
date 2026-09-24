// OS-level notifications (macOS banners) shared by the updater and AI-run
// completions.
//
// The in-app surfaces — the background-process toast and the activity bell —
// only help while the window is in view. Ideafy is routinely hidden behind
// Cmd+K, so anything that finishes while it is away needs a banner to be seen
// at all. A focused window gets nothing: the toast is already on screen and a
// banner on top of it is just noise.

const { app, Notification } = require("electron");

let resolveWindow = () => null;

function initNotifications({ getWindow }) {
  resolveWindow = getWindow;
}

function liveWindow() {
  const win = resolveWindow();
  return win && !win.isDestroyed() ? win : null;
}

function showWindowAndSend(channel, payload) {
  const win = liveWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (channel && win.webContents && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

/**
 * Raises a banner unless the window is focused. Clicking it brings the window
 * forward and sends `payload` to the renderer on `onClickChannel`.
 *
 * Returns whether a banner was actually raised, so callers can record it.
 * When the user denied permission or Do Not Disturb is on, `show()` drops the
 * banner silently — there is no way to tell from here.
 */
function showNotification({ title, body, onClickChannel, payload }) {
  if (!Notification.isSupported()) return false;
  const win = liveWindow();
  if (win && win.isFocused()) return false;

  const notification = new Notification({ title, body, silent: false });
  notification.on("click", () => showWindowAndSend(onClickChannel, payload));
  notification.show();

  // One bounce, not a loop: "informational" stops as soon as the app is
  // activated, and never repeats on its own.
  if (process.platform === "darwin" && app.dock) {
    app.dock.bounce("informational");
  }
  return true;
}

module.exports = { initNotifications, showNotification };
