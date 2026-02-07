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
const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const PORT = process.env.PORT || "3030";
const DEV_URL = `http://localhost:${PORT}`;

let mainWindow = null;
let quickEntryWindow = null;
let tray = null;
let nextProcess = null;

// ── Server lifecycle ──────────────────────────────────────────────────

function ensureDataDir() {
  const dataDir = path.join(PROJECT_ROOT, "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log("Created data/ directory");
  }
}

function runDbPush() {
  console.log("Setting up database...");
  try {
    execSync("npx drizzle-kit push", {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
    });
    console.log("Database ready.");
  } catch {
    console.error("Warning: Database setup failed. Continuing anyway...");
  }
}

function startNextServer() {
  return new Promise((resolve) => {
    nextProcess = spawn("npx", ["next", "dev", "-p", PORT], {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      env: { ...process.env, PORT },
    });

    nextProcess.on("error", (err) => {
      console.error("Failed to start Next.js server:", err.message);
    });

    // Poll the API endpoint (not just root) to ensure routes are compiled
    const poll = setInterval(() => {
      http
        .get(`${DEV_URL}/api/cards`, (res) => {
          if (res.statusCode === 200) {
            clearInterval(poll);
            console.log("Next.js server and API ready.");
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

// ── Main Window ───────────────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 12 },
    backgroundColor: "#0a0a0b",
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
          'background: hsl(0 0% 5%)',
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
  // Tell main window to refresh data immediately
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
  const iconPath = path.join(__dirname, "icons", "tray-iconTemplate.png");

  let trayIcon;
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
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
    const dockIcon = nativeImage.createFromPath(
      path.join(PROJECT_ROOT, "public", "icon-512.png")
    );
    app.dock.setIcon(dockIcon);
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
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]);
    Menu.setApplicationMenu(appMenu);
  }

  ensureDataDir();
  runDbPush();
  await startNextServer();

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
