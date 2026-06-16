const { app, BrowserWindow, shell, ipcMain, Menu } = require("electron");

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
  } catch {
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

function stopMpvNative() {
  try {
    mpvNative?.stop();
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
