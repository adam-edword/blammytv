import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Resolve the shared package straight to its TS source so types and the config
// contract are shared everywhere without a build step.
const shared = fileURLToPath(
  new URL("../../packages/shared/src/index.ts", import.meta.url),
);

export default defineConfig({
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
