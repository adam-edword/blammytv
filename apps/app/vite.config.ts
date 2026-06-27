import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Resolve the shared package straight to its TS source so types and the config
// contract are shared everywhere without a build step.
const shared = fileURLToPath(
  new URL("../../packages/shared/src/index.ts", import.meta.url),
);

// On `tauri android/ios dev`, Tauri sets TAURI_DEV_HOST to the LAN IP the device
// reaches this PC on — Vite must bind to it so the device can load the dev
// server. On desktop it's unset and Vite stays on localhost.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  // GitHub Pages serves the app from a subfolder (/blammytv/), so CI sets
  // DEPLOY_BASE to that path. Local dev/build stay at root.
  base: process.env.DEPLOY_BASE ?? "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@blammytv/shared": shared,
    },
  },
  server: {
    // Bind to the LAN host on mobile dev; localhost on desktop.
    host: host || false,
    port: 1420,
    // Tauri's devUrl is fixed at :1420, so fail loudly if it's taken rather
    // than silently moving to a port Tauri can't find.
    strictPort: true,
    // When serving to a device, HMR's websocket must point back at the LAN host.
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    // Don't let Vite's file watcher follow the Rust build output — cargo
    // churns/locks thousands of files in src-tauri/target and the watcher
    // crashes with EBUSY.
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
