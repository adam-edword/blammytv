// Copy the built web app into the desktop shell's renderer folder for packaging.
import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "..", "app", "dist");
const renderer = join(here, "..", "renderer");

rmSync(renderer, { recursive: true, force: true });
cpSync(dist, renderer, { recursive: true });
console.log("synced", dist, "->", renderer);
