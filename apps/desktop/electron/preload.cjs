const { contextBridge, ipcRenderer } = require("electron");

// Bridge the renderer to native playback (mpv embedded in a child window).
contextBridge.exposeInMainWorld("blammy", {
  mpvPlay: (url, bounds) => ipcRenderer.invoke("mpv:play", { url, bounds }),
  mpvSetBounds: (bounds) => ipcRenderer.invoke("mpv:bounds", bounds),
  mpvStop: () => ipcRenderer.invoke("mpv:stop"),
  // Fired when the user closes the mpv window; returns an unsubscribe fn.
  onMpvClosed: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("mpv:closed", handler);
    return () => ipcRenderer.removeListener("mpv:closed", handler);
  },
  // Fired when the app window moves/resizes — re-report the player region.
  onWindowGeom: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("window:geom", handler);
    return () => ipcRenderer.removeListener("window:geom", handler);
  },
});
