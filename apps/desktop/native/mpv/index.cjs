// Loads the compiled libmpv addon (Phase 1 spike).
//
// Built against Electron's ABI, so it only loads inside the Electron main
// process. main.cjs requires this behind a try/catch, so the app runs fine
// whether or not the addon has been built yet.
module.exports = require("./build/Release/mpv_addon.node");
