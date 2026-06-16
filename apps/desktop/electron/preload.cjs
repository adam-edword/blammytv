const { contextBridge, ipcRenderer } = require("electron");
const path = require("node:path");

// Load the native libmpv addon HERE, in the renderer process, so the canvas
// player's per-frame readback never crosses the process boundary. The frame
// pull is exposed synchronously: the renderer's rAF loop calls it directly and
// gets the pixels back with no IPC and no async round-trip (the choke point of
// the main-process version). Audio plays natively from mpv.
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

contextBridge.exposeInMainWorld("blammyMpv", {
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
  // Returns RGBA bytes for the current frame (or null). Synchronous on purpose.
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
});

contextBridge.exposeInMainWorld("blammy", {
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
  // libmpv live canvas player (Phase 2 step 2).
  mpvPlayerStart: (url) => ipcRenderer.invoke("mpv:playerStart", url),
  mpvPlayerFrame: (w, h) => ipcRenderer.invoke("mpv:playerFrame", w, h),
  mpvPlayerStop: () => ipcRenderer.invoke("mpv:playerStop"),
  onPopoutClosed: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("popout:closed", handler);
    return () => ipcRenderer.removeListener("popout:closed", handler);
  },
});
