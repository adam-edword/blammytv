const { ipcRenderer } = require("electron");

// Bridge for the transparent theater overlay window (Milestone 1). With
// contextIsolation off we assign straight onto the global.
globalThis.overlayApi = {
  close: () => ipcRenderer.invoke("theater:close"),
  setPause: (paused) => ipcRenderer.invoke("theater:pause", paused),
};
