const {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  Menu,
  screen,
  globalShortcut,
} = require("electron");

// Let Chromium hardware-decode HEVC/H.265 in the in-app <video> (4K sports
// channels are HEVC; without this it falls back to software and drops frames).
app.commandLine.appendSwitch("enable-features", "PlatformHEVCDecoderSupport");

// Kill the application menu entirely so the Alt key can't pop the (File/Edit/
// View…) menu bar. autoHideMenuBar alone still lets Alt toggle it.
Menu.setApplicationMenu(null);
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
const FFPROBE_BIN =
  process.env.FFPROBE_PATH ||
  path.join(__dirname, "..", "bin", process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
const MPV_BIN =
  process.env.MPV_PATH ||
  path.join(__dirname, "..", "bin", process.platform === "win32" ? "mpv.exe" : "mpv");

// Detect whether a stream's video is HDR (PQ / HLG), so we only pay the cost of
// tone-mapping when it's actually needed. Resolves false on any error (no
// ffprobe, timeout, SDR) — the caller then takes the fast copy path.
// Probe a stream's video/audio details (and whether it's HDR) with ffprobe in
// one shot. Resolves null on any error (no ffprobe, timeout) — callers then
// take the safe/fast path and the stats panel just shows what it can.
function probeStreams(url) {
  return new Promise((resolve) => {
    const bin = fs.existsSync(FFPROBE_BIN) ? FFPROBE_BIN : "ffprobe";
    let proc;
    try {
      proc = spawn(
        bin,
        [
          "-v", "error",
          "-show_entries",
          "stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,bit_rate,color_transfer,sample_rate,channels",
          "-of", "json",
          url,
        ],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
    } catch {
      return resolve(null);
    }
    let out = "";
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* gone */
      }
      resolve(null);
    }, 6000);
    proc.stdout.on("data", (d) => {
      out += d.toString();
    });
    proc.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    proc.on("close", () => {
      clearTimeout(timer);
      try {
        const streams = (JSON.parse(out).streams || []);
        const v = streams.find((s) => s.codec_type === "video") || {};
        const a = streams.find((s) => s.codec_type === "audio") || {};
        const transfer = (v.color_transfer || "").toLowerCase();
        resolve({
          video: {
            width: v.width ?? null,
            height: v.height ?? null,
            codec: v.codec_name ?? null,
            pixFmt: v.pix_fmt ?? null,
            frameRate: v.r_frame_rate ?? null,
            bitRate: v.bit_rate ? Number(v.bit_rate) : null,
          },
          audioSampleRate: a.sample_rate ? Number(a.sample_rate) : null,
          hdr: transfer === "smpte2084" || transfer === "arib-std-b67",
        });
      } catch {
        resolve(null);
      }
    });
  });
}

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
      [
        url,
        "--force-window=yes",
        "--title=BlammyTV",
        "--no-terminal",
        // PiP feel: small, borderless, always-on-top, parked bottom-right.
        "--no-border",
        "--ontop=yes",
        "--autofit=480x270",
        "--geometry=-24-48",
        // Start faster: hardware decode + low-latency cache profile so it
        // doesn't sit buffering for several seconds before showing video.
        "--hwdec=auto-safe",
        "--profile=low-latency",
        "--cache=yes",
      ],
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

// --- libmpv spike (Phase 1) ------------------------------------------------
// Loaded lazily + guarded: the app runs fine whether or not the native addon
// has been built (see apps/desktop/native/mpv/README.md).
let mpvNative = null;
function loadMpvNative() {
  if (mpvNative) return mpvNative;
  try {
    mpvNative = require("../native/mpv");
  } catch (err) {
    console.error("[mpv] failed to load native addon:", err);
    mpvNative = null;
  }
  return mpvNative;
}

ipcMain.handle("mpv:spike", (_event, url) => {
  const native = loadMpvNative();
  if (!native) {
    return {
      ok: false,
      error:
        "libmpv addon not built — see apps/desktop/native/mpv/README.md",
    };
  }
  try {
    native.play(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// Phase 2 step 1: render one frame offscreen via mpv's render API into our own
// FBO, write it to a BMP, and open it so we can eyeball that the GL spine works.
ipcMain.handle("mpv:renderProbe", async (_event, url) => {
  const native = loadMpvNative();
  if (!native || typeof native.renderProbe !== "function") {
    return { ok: false, error: "libmpv addon (renderProbe) not built" };
  }
  try {
    const out = path.join(os.tmpdir(), `blammy-mpv-frame-${Date.now()}.bmp`);
    const written = native.renderProbe(url, out);
    await shell.openPath(written);
    return { ok: true, path: written };
  } catch (err) {
    console.error("[mpv] renderProbe failed:", err);
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// Phase 2 step 2: live libmpv → canvas player. start/stop manage the native
// player; renderFrame returns the current frame's RGBA bytes for the renderer
// to upload to a <canvas>. Audio plays natively from mpv.
ipcMain.handle("mpv:playerStart", (_event, url) => {
  const native = loadMpvNative();
  if (!native || typeof native.playerStart !== "function") {
    return { ok: false, error: "libmpv addon (player) not built" };
  }
  try {
    native.playerStart(url);
    return { ok: true };
  } catch (err) {
    console.error("[mpv] playerStart failed:", err);
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle("mpv:playerFrame", (_event, w, h) => {
  const native = loadMpvNative();
  if (!native || typeof native.playerRenderFrame !== "function") return null;
  try {
    return native.playerRenderFrame(w, h); // Buffer (RGBA) or null
  } catch (err) {
    console.error("[mpv] playerRenderFrame failed:", err);
    return null;
  }
});

ipcMain.handle("mpv:playerStop", () => {
  const native = loadMpvNative();
  try {
    native?.playerStop?.();
  } catch {
    /* already gone */
  }
  return { ok: true };
});

// --- Native theater (Milestone 1): mpv fullscreen native surface + a
// transparent always-on-top Electron overlay window for our HTML controls.
let theaterOverlay = null;
let theaterMeta = null;

function closeTheater() {
  const native = loadMpvNative();
  try {
    native?.playerStop?.();
  } catch {
    /* gone */
  }
  if (theaterOverlay && !theaterOverlay.isDestroyed()) theaterOverlay.close();
  theaterOverlay = null;
  try {
    globalShortcut.unregister("Escape");
  } catch {
    /* not registered */
  }
  // Bring the app back and tell it the native theater closed (resume mini).
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.webContents.send("theater:closed");
  }
}

ipcMain.handle("theater:open", (_event, url, meta) => {
  const native = loadMpvNative();
  if (!native || typeof native.playerStartWindow !== "function") {
    return { ok: false, error: "libmpv addon (native window) not built" };
  }
  try {
    native.playerStartWindow(url);
  } catch (err) {
    console.error("[theater] playerStartWindow failed:", err);
    return { ok: false, error: String((err && err.message) || err) };
  }
  theaterMeta = meta ?? null;

  // Hide the app shell so the only layers are mpv (bottom) + transparent
  // overlay (top) — otherwise the app's dark background shows through.
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  globalShortcut.register("Escape", closeTheater);

  const { x, y, width, height } = screen.getPrimaryDisplay().bounds;
  theaterOverlay = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    // No backgroundColor: on Windows it forces the transparent window opaque.
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    thickFrame: false,
    // Non-focusable so mpv stays the active foreground window (occluded +
    // unfocused DWM content can get throttled/dimmed).
    focusable: false,
    fullscreenable: false,
    // Allow covering the taskbar (Windows otherwise clamps to the work area).
    enableLargerThanScreen: true,
    webPreferences: {
      preload: path.join(__dirname, "overlay-preload.cjs"),
      sandbox: false,
      contextIsolation: false,
    },
  });
  // Force full display bounds (incl. the taskbar strip) — Windows clamps the
  // initial size to the work area, leaving the controls short of the bottom.
  theaterOverlay.setBounds({ x, y, width, height });
  // Sit above mpv's borderless-fullscreen window (and the taskbar).
  theaterOverlay.setAlwaysOnTop(true, "screen-saver");
  // Click-through: input passes to mpv, the overlay never steals focus.
  theaterOverlay.setIgnoreMouseEvents(true, { forward: true });
  // Load the real React app in overlay mode (renders only the theater chrome).
  if (app.isPackaged) {
    theaterOverlay.loadFile(path.join(__dirname, "..", "renderer", "index.html"), {
      query: { overlay: "1" },
    });
  } else {
    theaterOverlay.loadURL(DEV_URL + "?overlay=1");
  }
  theaterOverlay.on("closed", () => {
    theaterOverlay = null;
  });
  return { ok: true };
});

ipcMain.handle("theater:close", () => {
  closeTheater();
  return { ok: true };
});

ipcMain.handle("theater:pause", (_event, paused) => {
  try {
    loadMpvNative()?.playerSetPause?.(paused);
  } catch {
    /* gone */
  }
  return { ok: true };
});

ipcMain.handle("overlay:setIgnore", (_event, ignore) => {
  if (theaterOverlay && !theaterOverlay.isDestroyed())
    theaterOverlay.setIgnoreMouseEvents(!!ignore, { forward: true });
  return { ok: true };
});

ipcMain.handle("theater:seek", (_event, delta) => {
  try {
    loadMpvNative()?.playerSeek?.(delta);
  } catch {
    /* gone */
  }
  return { ok: true };
});

ipcMain.handle("theater:volume", (_event, vol) => {
  try {
    loadMpvNative()?.playerSetVolume?.(vol);
  } catch {
    /* gone */
  }
  return { ok: true };
});

ipcMain.handle("theater:mute", (_event, muted) => {
  try {
    loadMpvNative()?.playerSetMute?.(muted);
  } catch {
    /* gone */
  }
  return { ok: true };
});

// Theater meta (channel / show / progress) for the overlay to render.
ipcMain.handle("theater:getMeta", () => theaterMeta);
ipcMain.handle("theater:setMeta", (_event, meta) => {
  theaterMeta = meta ?? null;
  if (theaterOverlay && !theaterOverlay.isDestroyed())
    theaterOverlay.webContents.send("theater:meta", theaterMeta);
  return { ok: true };
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

  // Probe once: feeds the Stats panel (HDR flag, codec, resolution, …).
  const probe = await probeStreams(url);
  const hdr = probe?.hdr ?? false;
  // Tone-mapping is disabled for now — copy the video stream untouched.
  const videoArgs = ["-c:v", "copy"];

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
        ...videoArgs,
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
  return {
    ok: true,
    url: `http://127.0.0.1:${hlsPort}/index.m3u8`,
    stats: {
      source: probe?.video ?? null,
      audioSampleRate: probe?.audioSampleRate ?? null,
      hdr,
      // What we actually deliver to the player (see ffmpeg args above).
      delivered: { audioCodec: "aac", audioChannels: 2, audioBitrateKbps: 160 },
    },
  };
});

ipcMain.handle("transcode:stop", () => {
  stopTranscode();
  return { ok: true };
});

let mainWindow = null;

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
      // sandbox off so the preload can load the native libmpv addon and render
      // frames in-renderer (no cross-process IPC for the canvas hot path).
      // contextIsolation off so the preload hands the renderer the frame buffer
      // directly (window.blammyMpv) — no per-frame structured-clone copy.
      sandbox: false,
      contextIsolation: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  win.maximize();
  mainWindow = win;

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
  // We null the app menu (Alt-key fix), which also drops the DevTools
  // accelerator — re-add it as a global shortcut on the focused window.
  const toggleDevTools = () => {
    const w = BrowserWindow.getFocusedWindow();
    if (w) w.webContents.toggleDevTools();
  };
  globalShortcut.register("CommandOrControl+Shift+I", toggleDevTools);
  globalShortcut.register("F12", toggleDevTools);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function stopMpvNative() {
  try {
    mpvNative?.stop();
  } catch {
    /* gone */
  }
  try {
    mpvNative?.playerStop?.();
  } catch {
    /* gone */
  }
}

app.on("window-all-closed", () => {
  stopTranscode();
  stopPopout();
  stopMpvNative();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopTranscode();
  stopPopout();
  stopMpvNative();
});
