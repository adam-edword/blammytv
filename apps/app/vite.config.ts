import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** WebView2 (the only target) always picks the woff2 source, so the .woff
 * fallbacks Fontsource emits are pure dead weight (~528 KB, half the font
 * payload). Drop the emitted .woff assets and strip their src clauses from
 * the built CSS — subset-safe by construction: every woff2 stays. */
function dropWoffFallbacks(): Plugin {
  return {
    name: "drop-woff-fallbacks",
    generateBundle(_opts, bundle) {
      for (const [name, chunk] of Object.entries(bundle)) {
        if (name.endsWith(".woff") && chunk.type === "asset") {
          delete bundle[name];
        } else if (name.endsWith(".css") && chunk.type === "asset") {
          chunk.source = String(chunk.source).replace(
            /,\s*url\([^)]+\.woff\)\s*format\(["']woff["']\)/g,
            "",
          );
        }
      }
    },
  };
}

export default defineConfig({
  // GitHub Pages serves the app from a subfolder (/blammytv/), so CI sets
  // DEPLOY_BASE to that path. Local dev/build stay at root.
  base: process.env.DEPLOY_BASE ?? "/",
  plugins: [react(), dropWoffFallbacks()],
  server: {
    port: 1420,
    strictPort: false,
    // Don't let Vite's file watcher follow the Rust build output — cargo
    // churns/locks thousands of files in src-tauri/target and the watcher
    // crashes with EBUSY.
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
