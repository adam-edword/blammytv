import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Resolve the shared package straight to its TS source so types and the config
// contract are shared everywhere without a build step.
const shared = fileURLToPath(
  new URL("../../packages/shared/src/index.ts", import.meta.url),
);

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
    port: 1420,
    strictPort: false,
  },
});
