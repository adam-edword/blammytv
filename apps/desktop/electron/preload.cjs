const { contextBridge, ipcRenderer } = require("electron");

// Bridge the renderer to native playback (mpv) running in the main process.
contextBridge.exposeInMainWorld("blammy", {
  mpvPlay: (url) => ipcRenderer.invoke("mpv:play", url),
  mpvStop: () => ipcRenderer.invoke("mpv:stop"),
  // Called when the user closes the mpv window directly, so the app can clear
  // its "playing" state. Returns an unsubscribe fn.
  onMpvClosed: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("mpv:closed", handler);
    return () => ipcRenderer.removeListener("mpv:closed", handler);
  },
});
