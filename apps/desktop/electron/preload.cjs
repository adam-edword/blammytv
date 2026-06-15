const { contextBridge, ipcRenderer } = require("electron");

// Bridge the renderer to native playback (mpv) running in the main process.
contextBridge.exposeInMainWorld("blammy", {
  mpvPlay: (url) => ipcRenderer.invoke("mpv:play", url),
  mpvStop: () => ipcRenderer.invoke("mpv:stop"),
});
