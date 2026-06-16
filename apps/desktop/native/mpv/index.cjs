// Loads the compiled libmpv addon (Phase 1 spike).
//
// Built against Electron's ABI, so it only loads inside the Electron main
// process. main.cjs requires this behind a try/catch, so the app runs fine
// whether or not the addon has been built yet.
const path = require("path");

// On Windows the addon implicitly links libmpv-2.dll, but Windows doesn't
// search the .node's own directory for dependent DLLs — so even though the dll
// sits next to mpv_addon.node, the load fails with a cryptic error. Put the
// Release dir on the DLL search path before requiring the addon.
const releaseDir = path.join(__dirname, "build", "Release");
if (process.platform === "win32") {
  process.env.PATH = releaseDir + path.delimiter + process.env.PATH;
}

module.exports = require(path.join(releaseDir, "mpv_addon.node"));
