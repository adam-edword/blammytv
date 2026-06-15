const { contextBridge, ipcRenderer } = require("electron");

// Bridge the renderer to the local transcode (ffmpeg → HLS) in the main process.
contextBridge.exposeInMainWorld("blammy", {
  transcodeStart: (url) => ipcRenderer.invoke("transcode:start", url),
  transcodeStop: () => ipcRenderer.invoke("transcode:stop"),
});
