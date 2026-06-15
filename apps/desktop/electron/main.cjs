const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");

/**
 * BlammyTV desktop shell.
 *
 * The single deliberate choice here is `webSecurity: false`: this is a trusted,
 * single-purpose client, and turning off web security lets the renderer call
 * the Xtream API and play remote live streams directly — no CORS, no proxy.
 *
 * Dev loads the running Vite server; a packaged build loads the bundled app.
 */

const DEV_URL = process.env.ELECTRON_START_URL || "http://localhost:1420/";

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: "#0b0b0e",
    autoHideMenuBar: true,
    webPreferences: {
      webSecurity: false,
    },
  });

  // External links open in the system browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  } else {
    win.loadURL(DEV_URL);
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
