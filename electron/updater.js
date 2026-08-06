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

const { app, ipcMain, Notification } = require("electron");

const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
// Ideafy is an app you leave open and hide with Cmd+K, so a release published
// between two heartbeats would otherwise go unseen for hours. Coming back to
// the window is the moment you'd actually act on an update; throttled so
// flicking between apps doesn't hammer GitHub.
const FOCUS_CHECK_THROTTLE_MS = 30 * 60 * 1000;

let autoUpdater = null;
let resolveWindow = () => null;
let intervalTimer = null;
let started = false;
let installRequested = false;
let lastAttemptAt = 0;
// The version we've already raised a notification for. Without this the
// heartbeat would re-announce the same build every few hours.
let notifiedVersion = null;

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

function showWindowAndOpenUpdates() {
  const win = resolveWindow();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (win.webContents && !win.webContents.isDestroyed()) {
    win.webContents.send("open-updates");
  }
}

/**
 * Raises an OS notification for a newly-found build.
 *
 * The in-app marker is useless on its own here: the window is routinely hidden
 * behind Cmd+K, so a background check could find a release and nobody would
 * learn about it until they happened to open Settings. Skipped when the window
 * is already focused — the marker is right there and a banner would be noise.
 */
/** Returns whether a banner was actually raised, so callers can record it. */
function notify(title, body) {
  if (!Notification.isSupported()) return false;
  const win = resolveWindow();
  // Focused window: the in-app marker is already in view and a banner on top
  // of it is just noise.
  if (win && !win.isDestroyed() && win.isFocused()) return false;
  const notification = new Notification({ title, body, silent: false });
  notification.on("click", showWindowAndOpenUpdates);
  notification.show();
  return true;
}

function notifyUpdateAvailable(version) {
  if (!version || version === notifiedVersion) return;
  // Only remember it once a banner really went out; a version first seen while
  // the window was focused still deserves one the next time we're in the
  // background, which is the case where it matters.
  if (notify(
    `Ideafy ${version} is available`,
    "Open Settings → Updates to download and install it.",
  )) {
    notifiedVersion = version;
  }
}

function wireEvents() {
  autoUpdater.on("checking-for-update", () => {
    setState({ status: "checking", error: null });
  });

  autoUpdater.on("update-available", (info) => {
    const version = info?.version ?? null;
    setState({
      status: "available",
      latestVersion: version,
      releaseNotes: normalizeNotes(info?.releaseNotes),
      percent: 0,
      error: null,
      lastCheckedAt: Date.now(),
    });
    notifyUpdateAvailable(version);
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
    const version = info?.version ?? state.latestVersion;
    setState({ status: "ready", latestVersion: version, percent: 100, error: null });
    // A 220 MB download takes long enough that people switch away mid-way.
    // Say when it's done rather than making them come back to find out.
    notify(
      `Ideafy ${version} is ready to install`,
      "Open Settings → Updates to install it and relaunch.",
    );
  });

  autoUpdater.on("error", (err) => {
    console.error("[updater]", err);
    const message = err instanceof Error ? err.message : String(err);
    if (installRequested) {
      // The install leg failed, so no quit is coming. Undo the pre-authorised
      // quit or the user's next Cmd+Q would skip the confirmation dialog.
      installRequested = false;
      app.isQuitting = false;
      // Deliberately not back to "ready": the usual reason this leg fails is
      // that the archive we told the user was ready is no longer on disk — a
      // Caches sweep, or another Ideafy build sharing this cache directory
      // emptied it. Handing back the Install button then loops forever on the
      // same missing file. Dropping to "available" makes the next press
      // re-download, which is the only thing that can actually recover.
      setState({ status: "available", percent: 0, error: message });
      return;
    }
    setState({ status: "error", percent: 0, error: message });
  });
}

function registerIpc() {
  ipcMain.handle("updates:get-state", () => state);

  ipcMain.handle("updates:check", async () => {
    if (!autoUpdater) return state;
    lastAttemptAt = Date.now();
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

  setTimeout(() => backgroundCheck(), FIRST_CHECK_DELAY_MS);
  intervalTimer = setInterval(() => backgroundCheck(), CHECK_INTERVAL_MS);

  // Returning to the app is the other moment worth checking. `activate` covers
  // the dock icon and Cmd+K unhide; `focus` covers app switching.
  const win = resolveWindow();
  if (win && !win.isDestroyed()) {
    win.on("focus", () => backgroundCheck({ throttled: true }));
  }
  app.on("activate", () => backgroundCheck({ throttled: true }));
}

/**
 * A check the user did not ask for. Never runs on top of an in-flight download
 * or a staged build waiting to install, and — when throttled — not more than
 * once per FOCUS_CHECK_THROTTLE_MS.
 */
function backgroundCheck({ throttled = false } = {}) {
  if (!autoUpdater) return;
  if (state.status === "downloading" || state.status === "ready" || state.status === "installing") {
    return;
  }
  if (state.status === "checking") return;
  if (throttled && Date.now() - lastAttemptAt < FOCUS_CHECK_THROTTLE_MS) return;
  lastAttemptAt = Date.now();
  autoUpdater.checkForUpdates().catch(() => {});
}

function stopUpdater() {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
}

module.exports = { initUpdater, stopUpdater };
