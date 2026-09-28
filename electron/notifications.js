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

// A Notification with no JS reference left can be garbage-collected before
// macOS delivers it or before its click arrives, so every banner stays here
// until it is clicked or dismissed.
const liveNotifications = new Set();

/**
 * Raises a banner unless the window is focused (or `force` is set). Clicking
 * it brings the window forward and sends `payload` to the renderer on
 * `onClickChannel`.
 *
 * Returns what happened, so callers can record and log it:
 *   "shown"       — handed to macOS. A denied permission or Focus mode can
 *                   still drop it silently; the "show" event log line is the
 *                   only sign it actually appeared.
 *   "focused"     — skipped, the window is in front.
 *   "unsupported" — the platform has no notification support.
 */
function showNotification({ title, body, onClickChannel, payload, force = false }) {
  if (!Notification.isSupported()) return "unsupported";
  const win = liveWindow();
  if (!force && win && win.isFocused()) return "focused";

  const notification = new Notification({ title, body, silent: false });
  liveNotifications.add(notification);
  const release = () => liveNotifications.delete(notification);
  notification.on("show", () => console.log(`[notify] macOS showed "${title}"`));
  notification.on("click", () => {
    release();
    showWindowAndSend(onClickChannel, payload);
  });
  notification.on("close", release);
  notification.on("failed", (_event, error) => {
    release();
    console.warn(`[notify] macOS rejected "${title}": ${error}`);
  });
  notification.show();

  // One bounce, not a loop: "informational" stops as soon as the app is
  // activated, and never repeats on its own.
  if (process.platform === "darwin" && app.dock) {
    app.dock.bounce("informational");
  }
  return "shown";
}

module.exports = { initNotifications, showNotification };
