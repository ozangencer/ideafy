const {
  app,
  BrowserWindow,
  globalShortcut,
  Tray,
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
const isPackaged = app.isPackaged;
const REPO_ROOT = path.resolve(__dirname, "..");

const HOST = "127.0.0.1";
let PORT = null; // resolved at startup via get-port
let DEV_URL = null;

let mainWindow = null;
let quickEntryWindow = null;
let tray = null;
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
  // Packaged layout: Resources/app.asar/.next/standalone/server.js
  // electron-builder sets process.resourcesPath correctly in production.
  return path.join(
    process.resourcesPath,
    "app.asar",
    ".next",
    "standalone",
    "server.js"
  );
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
    nextProcess = spawn(process.execPath, [serverPath], {
      cwd: path.dirname(serverPath),
      stdio: "inherit",
      env: buildChildEnv({
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production",
        PORT,
        HOSTNAME: HOST,
        IDEAFY_USER_DATA: userData,
        IDEAFY_APP_RESOURCES: path.join(process.resourcesPath, "app.asar"),
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
  const src = path.join(process.resourcesPath, "app.asar", "skills");
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
    return path.join(process.resourcesPath, "app.asar", relative);
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

// ── Tray ──────────────────────────────────────────────────────────────

function createTray() {
  const trayPath = path.join(__dirname, "icons", "tray-iconTemplate.png");

  let trayIcon;
  if (fs.existsSync(trayPath)) {
    trayIcon = nativeImage.createFromPath(trayPath);
    trayIcon.setTemplateImage(true);
  } else {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip("ideafy");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show ideafy",
      click: () => showAndFocusMainWindow(),
    },
    {
      label: "Quick Entry",
      accelerator: "CommandOrControl+Shift+K",
      click: () => showQuickEntry(),
    },
    { type: "separator" },
    {
      label: "Quit",
      accelerator: "CommandOrControl+Q",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    showAndFocusMainWindow();
  });
}

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

  // Set app name and menu bar
  if (process.platform === "darwin") {
    app.setName("ideafy");
    const appMenu = Menu.buildFromTemplate([
      {
        label: "ideafy",
        submenu: [
          { role: "about", label: "About ideafy" },
          { type: "separator" },
          { role: "hide", label: "Hide ideafy" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          {
            label: "Quit ideafy",
            accelerator: "CmdOrCtrl+Q",
            click: () => {
              app.isQuitting = true;
              app.quit();
            },
          },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]);
    Menu.setApplicationMenu(appMenu);
  }

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
  createTray();
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
