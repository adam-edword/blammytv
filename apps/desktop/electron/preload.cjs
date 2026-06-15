const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("blammy", {
  // In-app player: local ffmpeg → HLS transcode.
  transcodeStart: (url) => ipcRenderer.invoke("transcode:start", url),
  transcodeStop: () => ipcRenderer.invoke("transcode:stop"),
  // Popout: play the stream in a native mpv window (instant, decodes anything).
  popoutPlay: (url) => ipcRenderer.invoke("popout:play", url),
  popoutStop: () => ipcRenderer.invoke("popout:stop"),
  onPopoutClosed: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("popout:closed", handler);
    return () => ipcRenderer.removeListener("popout:closed", handler);
  },
});
