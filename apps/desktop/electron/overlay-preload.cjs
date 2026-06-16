const { ipcRenderer } = require("electron");

// Bridge for the transparent theater overlay window (Milestone 1). With
// contextIsolation off we assign straight onto the global.
globalThis.overlayApi = {
  close: () => ipcRenderer.invoke("theater:close"),
  setPause: (paused) => ipcRenderer.invoke("theater:pause", paused),
  // Toggle click-through: false while the cursor is over a control (so clicks
  // land), true otherwise (so the rest passes through and mpv keeps foreground).
  setMouseIgnore: (ignore) => ipcRenderer.invoke("overlay:setIgnore", ignore),
};
