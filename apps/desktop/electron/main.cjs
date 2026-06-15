const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");

/**
 * BlammyTV desktop shell.
 *
 * - webSecurity:false lets the renderer call Xtream + load streams directly.
 * - Audio fix: a bundled ffmpeg transcodes the live stream locally (AC3 → AAC,
 *   video copied) into HLS, served from a tiny localhost server. The renderer
 *   plays that HLS in its normal web <video> (via hls.js) — so the video lives
 *   right in the app (mini-player, theater) and audio works.
 */

const DEV_URL = process.env.ELECTRON_START_URL || "http://localhost:1420/";
const FFMPEG_BIN =
  process.env.FFMPEG_PATH ||
  path.join(__dirname, "..", "bin", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const MPV_BIN =
  process.env.MPV_PATH ||
  path.join(__dirname, "..", "bin", process.platform === "win32" ? "mpv.exe" : "mpv");

// --- mpv popout (optional native window, instant, decodes anything) --------
let mpvProc = null;

function stopPopout() {
  if (mpvProc) {
    mpvProc.intentional = true;
    try {
      mpvProc.kill();
    } catch {
      /* gone */
    }
    mpvProc = null;
  }
}

ipcMain.handle("popout:play", (_event, url) => {
  stopPopout();
  const bin = fs.existsSync(MPV_BIN) ? MPV_BIN : "mpv";
  try {
    const proc = spawn(
      bin,
      [url, "--force-window=yes", "--title=BlammyTV", "--no-terminal"],
      { stdio: "ignore" },
    );
    proc.on("exit", () => {
      if (mpvProc === proc) mpvProc = null;
      if (!proc.intentional) {
        for (const w of BrowserWindow.getAllWindows()) {
          w.webContents.send("popout:closed");
        }
      }
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

ipcMain.handle("popout:stop", () => {
  stopPopout();
  return { ok: true };
});

const HLS_DIR = path.join(os.tmpdir(), "blammytv-hls");
let hlsServer = null;
let hlsPort = 0;
let ffmpegProc = null;

function startServer() {
  if (hlsServer) return Promise.resolve();
  fs.mkdirSync(HLS_DIR, { recursive: true });
  return new Promise((resolve) => {
    hlsServer = http.createServer((req, res) => {
      const name = path.basename((req.url || "").split("?")[0]);
      const file = path.join(HLS_DIR, name);
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, {
          "Content-Type": name.endsWith(".m3u8")
            ? "application/vnd.apple.mpegurl"
            : "video/mp2t",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache",
        });
        res.end(data);
      });
    });
    hlsServer.listen(0, "127.0.0.1", () => {
      hlsPort = hlsServer.address().port;
      resolve();
    });
  });
}

function stopTranscode() {
  if (ffmpegProc) {
    try {
      ffmpegProc.kill();
    } catch {
      /* gone */
    }
    ffmpegProc = null;
  }
}

function waitForFile(file, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (fs.existsSync(file)) return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(tick, 200);
    };
    tick();
  });
}

ipcMain.handle("transcode:start", async (_event, url) => {
  stopTranscode();
  await startServer();

  // Fresh output dir per stream.
  fs.rmSync(HLS_DIR, { recursive: true, force: true });
  fs.mkdirSync(HLS_DIR, { recursive: true });

  const bin = fs.existsSync(FFMPEG_BIN) ? FFMPEG_BIN : "ffmpeg";
  let stderr = "";
  let spawnError = null;
  try {
    ffmpegProc = spawn(
      bin,
      [
        "-hide_banner",
        "-loglevel", "warning",
        // Be resilient on flaky HTTP streams.
        "-reconnect", "1",
        "-reconnect_streamed", "1",
        "-reconnect_delay_max", "5",
        "-i", url,
        "-c:v", "copy",
        "-c:a", "aac",
        "-ac", "2",
        "-b:a", "160k",
        "-f", "hls",
        "-hls_time", "2",
        "-hls_list_size", "6",
        "-hls_flags", "delete_segments+append_list+omit_endlist",
        "-hls_segment_filename", path.join(HLS_DIR, "seg_%05d.ts"),
        path.join(HLS_DIR, "index.m3u8"),
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
  } catch (err) {
    return { ok: false, error: "Couldn't launch ffmpeg: " + String((err && err.message) || err) };
  }
  ffmpegProc.on("error", (err) => {
    spawnError = err;
  });
  ffmpegProc.stderr.on("data", (d) => {
    stderr = (stderr + d.toString()).slice(-2000);
  });

  const ready = await waitForFile(path.join(HLS_DIR, "index.m3u8"), 15000);
  if (!ready) {
    stopTranscode();
    let detail;
    if (spawnError) {
      detail =
        spawnError.code === "ENOENT"
          ? "ffmpeg not found — put ffmpeg.exe in apps/desktop/bin (or set FFMPEG_PATH)."
          : String(spawnError.message);
    } else {
      detail = stderr.trim() || "ffmpeg produced no output (no error reported).";
    }
    return { ok: false, error: detail };
  }
  return { ok: true, url: `http://127.0.0.1:${hlsPort}/index.m3u8` };
});

ipcMain.handle("transcode:stop", () => {
  stopTranscode();
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
  win.maximize();

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
  stopTranscode();
  stopPopout();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopTranscode();
  stopPopout();
});
