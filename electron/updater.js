// App auto-update over GitHub Releases (electron-updater / Squirrel.Mac).
//
// Deliberately notify-first, matching Sparkle's default: we check in the
// background, tell the renderer a build is waiting, and only download or
// install when the user asks. A 220 MB silent download — or a relaunch that
// kills in-flight Claude sessions without warning — is not something to do
// behind someone's back.
//
// Feed config comes from Resources/app-update.yml, which electron-builder
// generates from the `publish` block in scripts/electron-builder-config.mjs.
// Both release repos are public, so no token is involved.

const { app, ipcMain } = require("electron");

const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let autoUpdater = null;
let resolveWindow = () => null;
let intervalTimer = null;
let started = false;
let installRequested = false;

// Mirrors the renderer's UpdateState shape (components/updates/types).
let state = {
  supported: false,
  currentVersion: app.getVersion(),
  status: "idle",
  latestVersion: null,
  releaseNotes: null,
  percent: 0,
  error: null,
  lastCheckedAt: null,
};

function broadcast() {
  const win = resolveWindow();
  if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
    win.webContents.send("update-state", state);
  }
}

function setState(patch) {
  state = { ...state, ...patch };
  broadcast();
}

// electron-updater hands back either a string or an array of {note} objects
// depending on how the release notes were published. Normalise to plain text
// so the renderer never has to branch on it.
function normalizeNotes(notes) {
  if (typeof notes === "string") return notes.trim() || null;
  if (Array.isArray(notes)) {
    const joined = notes
      .map((n) => (typeof n === "string" ? n : (n?.note ?? "")))
      .filter(Boolean)
      .join("\n\n")
      .trim();
    return joined || null;
  }
  return null;
}

function wireEvents() {
  autoUpdater.on("checking-for-update", () => {
    setState({ status: "checking", error: null });
  });

  autoUpdater.on("update-available", (info) => {
    setState({
      status: "available",
      latestVersion: info?.version ?? null,
      releaseNotes: normalizeNotes(info?.releaseNotes),
      percent: 0,
      error: null,
      lastCheckedAt: Date.now(),
    });
  });

  autoUpdater.on("update-not-available", () => {
    setState({
      status: "up-to-date",
      latestVersion: null,
      percent: 0,
      error: null,
      lastCheckedAt: Date.now(),
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    setState({
      status: "downloading",
      percent: Math.round(progress?.percent ?? 0),
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    setState({
      status: "ready",
      latestVersion: info?.version ?? state.latestVersion,
      percent: 100,
      error: null,
    });
  });

  autoUpdater.on("error", (err) => {
    console.error("[updater]", err);
    const message = err instanceof Error ? err.message : String(err);
    if (installRequested) {
      // The install leg failed, so no quit is coming. Undo the pre-authorised
      // quit or the user's next Cmd+Q would skip the confirmation dialog, and
      // hand them back the still-valid Install button.
      installRequested = false;
      app.isQuitting = false;
      setState({ status: "ready", error: message });
      return;
    }
    setState({ status: "error", percent: 0, error: message });
  });
}

function registerIpc() {
  ipcMain.handle("updates:get-state", () => state);

  ipcMain.handle("updates:check", async () => {
    if (!autoUpdater) return state;
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      // The 'error' event already reported this; swallow so the renderer's
      // invoke() resolves instead of rejecting with a duplicate message.
      console.error("[updater] check failed:", err);
    }
    return state;
  });

  ipcMain.handle("updates:download", async () => {
    if (!autoUpdater) return state;
    try {
      setState({ status: "downloading", percent: 0, error: null });
      await autoUpdater.downloadUpdate();
    } catch (err) {
      console.error("[updater] download failed:", err);
    }
    return state;
  });

  ipcMain.handle("updates:install", () => {
    if (!autoUpdater || state.status !== "ready") return state;
    // before-quit in main.js intercepts every quit to show the "Quit Ideafy?"
    // confirmation. quitAndInstall() goes through that same path, so flag the
    // quit as already-confirmed or the user gets a second dialog they never
    // asked for — and cancelling it would strand the installer.
    app.isQuitting = true;
    installRequested = true;
    // With autoInstallOnAppQuit off, Squirrel hasn't staged anything yet: this
    // call is what makes it pull the archive from electron-updater's localhost
    // proxy, and only then does the app quit. That gap is seconds of nothing
    // happening, so say so rather than leaving a dead-looking button.
    setState({ status: "installing", error: null });
    autoUpdater.quitAndInstall();
    return state;
  });
}

/**
 * Wires up background update checks. `getWindow` is called lazily so the
 * updater can be initialised before the window exists.
 *
 * In dev there is no signed app and no feed, so we register the IPC surface
 * (the renderer still asks for state) but never talk to the network.
 */
function initUpdater({ getWindow, enabled }) {
  if (started) return;
  started = true;
  resolveWindow = getWindow;

  if (!enabled) {
    setState({ supported: false, status: "unsupported" });
    registerIpc();
    return;
  }

  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (err) {
    console.error("[updater] electron-updater unavailable:", err);
    setState({ supported: false, status: "unsupported" });
    registerIpc();
    return;
  }

  autoUpdater.autoDownload = false;
  // We install on the user's word, not silently at the next quit — a relaunch
  // mid-session would drop running Claude work.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = console;

  wireEvents();
  registerIpc();
  setState({ supported: true, status: "idle" });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, FIRST_CHECK_DELAY_MS);

  intervalTimer = setInterval(() => {
    // Don't restart a check on top of an in-flight download or a build that is
    // already staged and waiting for the user to hit Install.
    if (state.status === "downloading" || state.status === "ready") return;
    autoUpdater.checkForUpdates().catch(() => {});
  }, CHECK_INTERVAL_MS);
}

function stopUpdater() {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
}

module.exports = { initUpdater, stopUpdater };
