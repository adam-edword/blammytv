// Loads the compiled libmpv addon (Phase 1 spike).
//
// Built against Electron's ABI, so it only loads inside the Electron main
// process. main.cjs requires this behind a try/catch, so the app runs fine
// whether or not the addon has been built yet.
const path = require("path");

// On Windows the addon implicitly links the libmpv dll, but Windows doesn't
// search the .node's own directory for dependent DLLs, so the load fails with a
// cryptic ERR_DLOPEN_FAILED. Put both the (git-ignored, rebuild-safe) vendor dir
// and the build output dir on the DLL search path before requiring the addon —
// vendor/ survives `node-gyp rebuild` (which wipes build/), so the dll there
// keeps the addon loadable across rebuilds.
const releaseDir = path.join(__dirname, "build", "Release");
const vendorDir = path.join(__dirname, "vendor");
if (process.platform === "win32") {
  process.env.PATH =
    vendorDir + path.delimiter + releaseDir + path.delimiter + process.env.PATH;
}

module.exports = require(path.join(releaseDir, "mpv_addon.node"));
