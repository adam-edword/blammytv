const { ipcRenderer } = require("electron");

// Bridge for the transparent theater overlay window. With contextIsolation off
// we assign straight onto the global. The overlay renders the real React UI in
// "overlay mode" and drives the native mpv player through these.
globalThis.overlayApi = {
  close: () => ipcRenderer.invoke("theater:close"),
  setPause: (paused) => ipcRenderer.invoke("theater:pause", paused),
  setMute: (muted) => ipcRenderer.invoke("theater:mute", muted),
  setVolume: (vol) => ipcRenderer.invoke("theater:volume", vol),
  seek: (delta) => ipcRenderer.invoke("theater:seek", delta),
  // Toggle click-through: false while the cursor is over a control (so clicks
  // land), true otherwise (so the rest passes through and mpv keeps foreground).
  setMouseIgnore: (ignore) => ipcRenderer.invoke("overlay:setIgnore", ignore),
  // Show metadata (channel / programme / progress).
  getMeta: () => ipcRenderer.invoke("theater:getMeta"),
  onMeta: (cb) => {
    const handler = (_e, meta) => cb(meta);
    ipcRenderer.on("theater:meta", handler);
    return () => ipcRenderer.removeListener("theater:meta", handler);
  },
};
