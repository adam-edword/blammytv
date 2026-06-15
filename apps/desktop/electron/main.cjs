const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

/**
 * BlammyTV desktop shell.
 *
 * - webSecurity:false lets the renderer call Xtream + load streams directly.
 * - Video plays in mpv (decodes everything, incl. AC3 audio the browser can't),
 *   embedded into a borderless child window layered over the app's player
 *   region. The renderer reports that region's screen bounds; we keep the mpv
 *   window pinned there as the main window moves/resizes.
 */

// Free the GPU surface for the embedded mpv window — Chromium's compositor
// otherwise fights mpv and the video renders black. Our UI is light, so CPU
// compositing is fine. Must be called before the app is ready.
app.disableHardwareAcceleration();

const DEV_URL = process.env.ELECTRON_START_URL || "http://localhost:1420/";
const MPV_BIN =
  process.env.MPV_PATH ||
  path.join(__dirname, "..", "bin", process.platform === "win32" ? "mpv.exe" : "mpv");

let mainWin = null;
let videoWin = null;
let mpvProc = null;

function nativeWid(win) {
  const buf = win.getNativeWindowHandle();
  return buf.length >= 8
    ? buf.readBigUInt64LE(0).toString()
    : buf.readUInt32LE(0).toString();
}

// A viewport-relative rect (left/top/width/height, DIP) becomes absolute screen
// bounds using the main window's content origin — reliable across DPI scaling.
function rectToBounds(rect) {
  const cb = mainWin ? mainWin.getContentBounds() : { x: 0, y: 0 };
  return {
    x: Math.round(cb.x + rect.left),
    y: Math.round(cb.y + rect.top),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

function ensureVideoWin() {
  if (videoWin && !videoWin.isDestroyed()) return videoWin;
  videoWin = new BrowserWindow({
    parent: mainWin || undefined,
    frame: false,
    transparent: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: "#000000",
    show: false,
  });
  videoWin.setMenu(null);
  return videoWin;
}

function notifyMpvClosed() {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send("mpv:closed");
}

function killMpv() {
  if (mpvProc) {
    mpvProc.intentional = true; // app closed it (switch/stop), not the user
    try {
      mpvProc.kill();
    } catch {
      /* gone */
    }
    mpvProc = null;
  }
}

function stopPlayback() {
  killMpv();
  if (videoWin && !videoWin.isDestroyed()) videoWin.hide();
}

ipcMain.handle("mpv:play", (_event, { url, rect }) => {
  killMpv();
  const win = ensureVideoWin();
  if (rect) win.setBounds(rectToBounds(rect));
  win.showInactive();
  const bin = fs.existsSync(MPV_BIN) ? MPV_BIN : "mpv";
  try {
    const proc = spawn(
      bin,
      [url, `--wid=${nativeWid(win)}`, "--no-terminal", "--osc=yes"],
      { stdio: "ignore" },
    );
    proc.on("exit", () => {
      if (mpvProc === proc) mpvProc = null;
      if (!proc.intentional) notifyMpvClosed();
    });
    proc.on("error", () => {
      if (mpvProc === proc) mpvProc = null;
    });
    mpvProc = proc;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle("mpv:bounds", (_event, rect) => {
  if (videoWin && !videoWin.isDestroyed() && rect) {
    videoWin.setBounds(rectToBounds(rect));
  }
  return { ok: true };
});

ipcMain.handle("mpv:stop", () => {
  stopPlayback();
  return { ok: true };
});

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
      autoplayPolicy: "no-user-gesture-required",
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  mainWin = win;
  win.maximize();

  // Tell the renderer to re-report the player region whenever the window moves
  // or resizes, so the embedded mpv window stays pinned to it.
  const sendGeom = () => win.webContents.send("window:geom");
  win.on("move", sendGeom);
  win.on("resize", sendGeom);

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
  stopPlayback();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", stopPlayback);
