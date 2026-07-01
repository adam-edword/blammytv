import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages serves the app from a subfolder (/blammytv/), so CI sets
  // DEPLOY_BASE to that path. Local dev/build stay at root.
  base: process.env.DEPLOY_BASE ?? "/",
  plugins: [react()],
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
