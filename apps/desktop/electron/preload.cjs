const { ipcRenderer } = require("electron");
const path = require("node:path");

// Load the native libmpv addon HERE, in the renderer process, so the canvas
// player's per-frame readback never crosses the process boundary. With
// contextIsolation disabled we assign the bridges straight onto window (instead
// of contextBridge), so the frame buffer is handed to the renderer with no
// structured-clone copy — the JS-side hot path. Audio plays natively from mpv.
let mpvAddon = null;
function getMpv() {
  if (mpvAddon) return mpvAddon;
  try {
    mpvAddon = require(path.join(__dirname, "..", "native", "mpv"));
  } catch (err) {
    console.error("[mpv] preload failed to load native addon:", err);
    mpvAddon = null;
  }
  return mpvAddon;
}

globalThis.blammyMpv = {
  start: (url) => {
    const m = getMpv();
    if (!m || typeof m.playerStart !== "function") {
      return { ok: false, error: "libmpv addon (player) not built" };
    }
    try {
      m.playerStart(url);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  },
  // Returns RGBA bytes for the current frame (or null). Synchronous + no clone.
  frame: (w, h) => {
    const m = getMpv();
    if (!m || typeof m.playerRenderFrame !== "function") return null;
    try {
      return m.playerRenderFrame(w, h);
    } catch {
      return null;
    }
  },
  stop: () => {
    try {
      getMpv()?.playerStop?.();
    } catch {
      /* already gone */
    }
  },
  stats: () => {
    try {
      return getMpv()?.playerStats?.() ?? "";
    } catch {
      return "";
    }
  },
  setPause: (paused) => {
    try {
      getMpv()?.playerSetPause?.(paused);
    } catch {
      /* not started */
    }
  },
  setMute: (muted) => {
    try {
      getMpv()?.playerSetMute?.(muted);
    } catch {
      /* not started */
    }
  },
  setVolume: (vol) => {
    try {
      getMpv()?.playerSetVolume?.(vol);
    } catch {
      /* not started */
    }
  },
  seek: (delta) => {
    try {
      getMpv()?.playerSeek?.(delta);
    } catch {
      /* not started */
    }
  },
};

globalThis.blammy = {
  // In-app player: local ffmpeg → HLS transcode.
  transcodeStart: (url) => ipcRenderer.invoke("transcode:start", url),
  transcodeStop: () => ipcRenderer.invoke("transcode:stop"),
  // Popout: play the stream in a native mpv window (instant, decodes anything).
  popoutPlay: (url) => ipcRenderer.invoke("popout:play", url),
  popoutStop: () => ipcRenderer.invoke("popout:stop"),
  // libmpv spike (Phase 1): play via the native addon's own mpv window.
  mpvSpike: (url) => ipcRenderer.invoke("mpv:spike", url),
  // libmpv render probe (Phase 2 step 1): render one frame offscreen → BMP.
  mpvRenderProbe: (url) => ipcRenderer.invoke("mpv:renderProbe", url),
  // Native theater: mpv fullscreen + transparent HTML overlay.
  nativeTheaterOpen: (url, meta) =>
    ipcRenderer.invoke("theater:open", url, meta),
  nativeTheaterMeta: (meta) => ipcRenderer.invoke("theater:setMeta", meta),
  onPopoutClosed: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("popout:closed", handler);
    return () => ipcRenderer.removeListener("popout:closed", handler);
  },
};
