const { contextBridge, ipcRenderer } = require("electron");

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
  onPopoutClosed: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("popout:closed", handler);
    return () => ipcRenderer.removeListener("popout:closed", handler);
  },
});
