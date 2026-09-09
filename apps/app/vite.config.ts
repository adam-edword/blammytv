import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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
            // The FORMAT is what says this clause is woff, not the file
            // extension. Six subsets are small enough that Vite base64
            // inlines them, so they arrive as url(data:font/woff;base64,...)
            // and the old pattern, which required a path ending .woff,
            // walked straight past them: 20.5 kB of exactly the dead weight
            // this plugin exists to remove. format("woff2") is untouched,
            // because the quote after woff has to be a quote.
            /,\s*url\([^)]+\)\s*format\(["']woff["']\)/g,
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
  // Tailwind BEFORE react(): the plugin is a CSS transform and wants to see
  // the stylesheet before anything else touches the graph. Its scanner reads
  // the source for class names on its own, so there is no content globbing
  // to configure and no config file at all (v4 keeps the theme in CSS; see
  // styles/theme.css).
  plugins: [tailwindcss(), react(), dropWoffFallbacks()],
  resolve: {
    // `@/...` is what shadcn's generated components import themselves by,
    // and it is not optional: its CLI writes those paths into every file it
    // emits. Mirrored in tsconfig.json so the editor and tsc agree.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
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
