const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("node:path");
const { spawn } = require("node:child_process");

// --- Native playback (mpv) -------------------------------------------------
// Step 1: prove mpv decodes the user's streams (incl. AC3 audio) by playing in
// its own window. Embedding into the app's player region comes next.
let mpvProc = null;

function stopMpv() {
  if (mpvProc) {
    try {
      mpvProc.kill();
    } catch {
      /* already gone */
    }
    mpvProc = null;
  }
}

// mpv binary: explicit path via MPV_PATH, else a bundled copy, else PATH.
const MPV_BIN =
  process.env.MPV_PATH ||
  path.join(__dirname, "..", "bin", process.platform === "win32" ? "mpv.exe" : "mpv");

ipcMain.handle("mpv:play", (_event, url) => {
  stopMpv();
  const bin = require("node:fs").existsSync(MPV_BIN) ? MPV_BIN : "mpv";
  try {
    mpvProc = spawn(bin, [url, "--force-window=yes", "--title=BlammyTV"], {
      stdio: "ignore",
    });
    mpvProc.on("exit", () => {
      mpvProc = null;
    });
    mpvProc.on("error", () => {
      mpvProc = null;
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle("mpv:stop", () => {
  stopMpv();
  return { ok: true };
});

/**
 * BlammyTV desktop shell.
 *
 * The single deliberate choice here is `webSecurity: false`: this is a trusted,
 * single-purpose client, and turning off web security lets the renderer call
 * the Xtream API and play remote live streams directly — no CORS, no proxy.
 *
 * Dev loads the running Vite server; a packaged build loads the bundled app.
 */

const DEV_URL = process.env.ELECTRON_START_URL || "http://localhost:1420/";

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#0b0b0e",
    autoHideMenuBar: true,
    webPreferences: {
      webSecurity: false,
      // Don't gate stream audio behind a user gesture (video would otherwise
      // auto-start silently).
      autoplayPolicy: "no-user-gesture-required",
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  // Open maximized — it's a TV app, give it the whole screen.
  win.maximize();

  // External links open in the system browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  } else {
    win.loadURL(DEV_URL);
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopMpv();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", stopMpv);
