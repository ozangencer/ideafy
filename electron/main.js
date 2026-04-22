const {
  app,
  BrowserWindow,
  globalShortcut,
  Menu,
  ipcMain,
  nativeImage,
  screen,
} = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const http = require("http");
const net = require("net");

// Paths differ between `npm run electron` in the repo and the packaged DMG.
// In the DMG, __dirname is inside app.asar; PROJECT_ROOT makes no sense.
// Branch on app.isPackaged and keep two code paths.
// Renaming the dev Electron bundle makes `app.isPackaged` unreliable when
// launched via `electron .` on macOS. `process.defaultApp` stays true in dev.
const isPackaged = app.isPackaged && !process.defaultApp;
const REPO_ROOT = path.resolve(__dirname, "..");
const packageJson = require(path.join(REPO_ROOT, "package.json"));
const APP_NAME = packageJson.build?.productName || "Ideafy";

const HOST = "127.0.0.1";
let PORT = null; // resolved at startup via get-port
let DEV_URL = null;

let mainWindow = null;
let quickEntryWindow = null;
let nextProcess = null;

// ── Env + port helpers ────────────────────────────────────────────────

// In packaged mode only pass the env vars the Next server actually needs.
// Stripping the rest keeps shell-exported dev secrets (API keys, DEBUG
// flags) from leaking into the production runtime.
function buildChildEnv(extra) {
  const base = {};
  if (isPackaged) {
    const allow = ["HOME", "PATH", "USER", "LANG", "LC_ALL", "SHELL", "TMPDIR"];
    for (const k of allow) {
      if (process.env[k]) base[k] = process.env[k];
    }
  } else {
    Object.assign(base, process.env);
  }
  return { ...base, ...extra };
}

// get-port is ESM-only; import it dynamically from CommonJS.
async function pickPort() {
  const preferred = Number(process.env.PORT || 3030);
  try {
    const { default: getPort } = await import("get-port");
    return getPort({ port: [preferred, 3031, 3032, 3033, 3034, 3035] });
  } catch {
    // Fallback: test the preferred port manually, then walk forward.
    for (let p = preferred; p < preferred + 20; p++) {
      const free = await new Promise((resolve) => {
        const s = net.createServer();
        s.once("error", () => resolve(false));
        s.once("listening", () => s.close(() => resolve(true)));
        s.listen(p, HOST);
      });
      if (free) return p;
    }
    return preferred;
  }
}

// ── Server lifecycle ──────────────────────────────────────────────────

function ensureUserDataDir() {
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveStandaloneServer() {
  // Standalone lives OUTSIDE asar (as extraResources → app-next/) because
  // (a) spawn() can't execute files inside an asar archive (ENOTDIR), and
  // (b) Next's standalone/node_modules gets pruned as "duplicate" if placed
  // in asar, leaving better-sqlite3 unreachable at runtime.
  return path.join(process.resourcesPath, "app-next", "server.js");
}

async function startNextServer() {
  PORT = String(await pickPort());
  DEV_URL = `http://${HOST}:${PORT}`;

  const userData = ensureUserDataDir();

  if (!isPackaged) {
    // Dev: spawn `next dev` exactly as before so hot-reload and TS
    // source-rewrite stay intact.
    nextProcess = spawn("npx", ["next", "dev", "-H", HOST, "-p", PORT], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: buildChildEnv({
        PORT,
        HOSTNAME: HOST,
        IDEAFY_USER_DATA: userData,
        IDEAFY_APP_RESOURCES: REPO_ROOT,
      }),
    });
  } else {
    // Packaged: run the standalone server under Electron's bundled Node.
    // ELECTRON_RUN_AS_NODE disables Chromium init for this child process.
    const serverPath = resolveStandaloneServer();
    // Drizzle migrations + skills are small, read-only files — bundle them
    // alongside the server outside asar so fs.readFileSync just works.
    const packagedResources = path.join(process.resourcesPath, "app-next");
    nextProcess = spawn(process.execPath, [serverPath], {
      cwd: path.dirname(serverPath),
      stdio: "inherit",
      env: buildChildEnv({
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production",
        PORT,
        HOSTNAME: HOST,
        IDEAFY_USER_DATA: userData,
        IDEAFY_APP_RESOURCES: packagedResources,
        // Explicit marker so server code can branch on packaged vs dev
        // without relying on asar-suffix heuristics.
        IDEAFY_PACKAGED: "1",
        // Absolute path to the Electron binary + the compiled MCP server,
        // used when we generate MCP invocation config for Claude Desktop.
        // Paths are stable: Electron is at Contents/MacOS/, MCP at
        // Contents/Resources/mcp-server/dist/index.js.
        IDEAFY_ELECTRON_EXEC: process.execPath,
        IDEAFY_MCP_ENTRY: path.join(process.resourcesPath, "mcp-server", "dist", "index.js"),
      }),
    });
  }

  nextProcess.on("error", (err) => {
    console.error("Failed to start Next.js server:", err.message);
  });

  await waitForServerReady();
}

function waitForServerReady() {
  const deadline = Date.now() + 60_000;
  return new Promise((resolve, reject) => {
    const poll = setInterval(() => {
      if (Date.now() > deadline) {
        clearInterval(poll);
        reject(new Error("Next.js server did not start within 60s"));
        return;
      }
      http
        .get(`${DEV_URL}/api/cards`, (res) => {
          if (res.statusCode && res.statusCode < 500) {
            clearInterval(poll);
            console.log(`Next.js server ready on ${DEV_URL}`);
            resolve();
          }
        })
        .on("error", () => {});
    }, 500);
  });
}

function killNextServer() {
  if (nextProcess) {
    nextProcess.kill("SIGTERM");
    nextProcess = null;
  }
}

// ── Skills mirror (packaged only) ─────────────────────────────────────

// The bundled skills/ dir ships inside asar (read-only). Users need to be
// able to drop their own skills in, so on first launch mirror the bundle
// into userData/skills and let the Next server resolve against that.
async function mirrorSkillsToUserData() {
  if (!isPackaged) return;
  // Bundled skills live in extraResources (app-next/skills — same layout
  // the standalone server sees under IDEAFY_APP_RESOURCES). Copy to
  // userData on first launch so users can edit/add their own.
  const src = path.join(process.resourcesPath, "app-next", "skills");
  const dst = path.join(app.getPath("userData"), "skills");
  if (!fs.existsSync(src)) return;
  if (fs.existsSync(dst)) return;
  await fsp.mkdir(dst, { recursive: true });
  await fsp.cp(src, dst, { recursive: true });
  console.log(`Mirrored skills/ to ${dst}`);
}

// ── Main Window ───────────────────────────────────────────────────────

function iconPath(relative) {
  if (isPackaged) {
    // public/ is bundled into extraResources (app-next/public/…) so the
    // dock icon is reachable via a real filesystem path at runtime.
    return path.join(process.resourcesPath, "app-next", relative);
  }
  return path.join(REPO_ROOT, relative);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon: iconPath(path.join("public", "icon-512-dock.png")),
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 12 },
    backgroundColor: "#16140f",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadURL(DEV_URL);

  mainWindow.webContents.on("dom-ready", () => {
    mainWindow.webContents.setZoomFactor(0.9);
  });

  mainWindow.webContents.on("did-finish-load", () => {
    const rendererCode = fs.readFileSync(
      path.join(__dirname, "renderer.js"),
      "utf-8"
    );
    mainWindow.webContents.executeJavaScript(rendererCode);

    // Titlebar drag region + styling
    mainWindow.webContents.executeJavaScript(`
      if (!document.getElementById('electron-titlebar')) {
        const titlebar = document.createElement('div');
        titlebar.id = 'electron-titlebar';
        titlebar.style.cssText = [
          'position: fixed',
          'top: 0',
          'left: 0',
          'right: 0',
          'height: 40px',
          'background: hsl(40 13% 8%)',
          '-webkit-app-region: drag',
          'z-index: 9999',
          'pointer-events: auto',
        ].join(';');
        document.body.prepend(titlebar);
      }
    `);

    mainWindow.webContents.insertCSS(`
      body { margin-top: 40px !important; overflow: hidden !important; }
      html { overflow: hidden !important; }
      body > div:first-of-type > .h-screen,
      body .h-screen {
        height: calc(100vh - 40px) !important;
      }
      #electron-titlebar {
        background: hsl(var(--background)) !important;
        z-index: 9999 !important;
      }
      [class*="fixed"], [class*="z-["] {
        -webkit-app-region: no-drag;
      }
      .fixed.inset-0 {
        top: 40px !important;
      }
    `);
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function showAndFocusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ── Quick Entry Window (Spotlight-style) ──────────────────────────────

function createQuickEntryWindow() {
  const { width: screenW, height: screenH } =
    screen.getPrimaryDisplay().workAreaSize;

  const winW = 520;
  const winH = 160;

  quickEntryWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x: Math.round((screenW - winW) / 2),
    y: Math.round(screenH * 0.25),
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload-quick-entry.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  quickEntryWindow.loadURL(`${DEV_URL}/quick-entry`);

  quickEntryWindow.webContents.on("did-finish-load", () => {
    quickEntryWindow.webContents.insertCSS(`
      html, body { background: transparent !important; }
    `);
  });

  quickEntryWindow.on("blur", () => {
    hideQuickEntry();
  });

  quickEntryWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      quickEntryWindow.hide();
    }
  });
}

function showQuickEntry() {
  if (!quickEntryWindow) return;

  // Center on the display where the cursor currently is
  const cursorPoint = screen.getCursorScreenPoint();
  const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);
  const { x: dX, y: dY, width: dW, height: dH } = currentDisplay.workArea;
  const winW = 520;
  quickEntryWindow.setPosition(
    Math.round(dX + (dW - winW) / 2),
    Math.round(dY + dH * 0.25)
  );

  quickEntryWindow.show();
  quickEntryWindow.focus();

  // Reset form state
  setTimeout(() => {
    quickEntryWindow.webContents.executeJavaScript(`
      window.dispatchEvent(new CustomEvent('reset-quick-entry'));
    `);
  }, 50);
}

function hideQuickEntry() {
  if (quickEntryWindow && quickEntryWindow.isVisible()) {
    quickEntryWindow.hide();
  }
}

// IPC: quick entry window requests to close
ipcMain.on("close-quick-entry-window", () => {
  hideQuickEntry();
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send("refresh-data");
  }
});

// IPC: quick entry window requests resize
ipcMain.on("resize-quick-entry", (_event, height) => {
  if (quickEntryWindow) {
    const [w] = quickEntryWindow.getSize();
    quickEntryWindow.setSize(w, Math.min(Math.max(height, 100), 600));
  }
});

// ── Global Shortcut ───────────────────────────────────────────────────

function registerGlobalShortcut() {
  // Cmd+K → Toggle kanban main window
  const regMain = globalShortcut.register("CommandOrControl+K", () => {
    if (mainWindow && mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide();
    } else {
      showAndFocusMainWindow();
    }
  });

  if (!regMain) {
    console.warn("Warning: Could not register global shortcut Cmd+K");
  }

  // Cmd+Shift+K → Toggle quick entry
  const regQuick = globalShortcut.register(
    "CommandOrControl+Shift+K",
    () => {
      if (quickEntryWindow && quickEntryWindow.isVisible()) {
        hideQuickEntry();
      } else {
        showQuickEntry();
      }
    }
  );

  if (!regQuick) {
    console.warn("Warning: Could not register global shortcut Cmd+Shift+K");
  }
}

// ── App Lifecycle ─────────────────────────────────────────────────────

app.on("ready", async () => {
  // Set dock icon to ideafy logo
  if (process.platform === "darwin") {
    const dockIconPath = iconPath(path.join("public", "icon-512-dock.png"));
    if (fs.existsSync(dockIconPath)) {
      app.dock.setIcon(nativeImage.createFromPath(dockIconPath));
    }
  }

  if (process.platform === "darwin") {
    app.setName(APP_NAME);
  }

  // Suppress Electron's default app menu so the desktop app has no menubar.
  Menu.setApplicationMenu(null);

  try {
    await mirrorSkillsToUserData();
    await startNextServer();
  } catch (err) {
    console.error("Failed to boot:", err);
    app.quit();
    return;
  }

  createMainWindow();
  createQuickEntryWindow();
  registerGlobalShortcut();
});

app.on("activate", () => {
  showAndFocusMainWindow();
});

app.on("before-quit", () => {
  app.isQuitting = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  killNextServer();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
