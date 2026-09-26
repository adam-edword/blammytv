// Fetch the bundled ffmpeg: the build pinned in scripts/deps.json, from
// this repo's own copy of it (a deps-* release), its SHA-256 checked (plan
// 018, N5). The installer ships apps/app/src-tauri/ffmpeg.exe
// (tauri.windows.conf.json bundle resources; the exe itself is gitignored,
// never committed). Run it once on a dev machine and before a release
// build:
//
//   node scripts/fetch-ffmpeg.mjs
//
// A newer ffmpeg is the "Mirror bundled binaries" workflow's job (Actions
// tab, or a line in scripts/deps-request.txt): it copies a shinchiro build
// here and pins it, for this and fetch-libmpv.mjs together.
//
// WHY IT SHIPS. Multi-view tiles play in the webview, and WebView2 cannot
// decode HEVC without a Windows Store package. The stream proxy converts an
// HEVC stream to H.264 with this ffmpeg (src-tauri/src/mvconvert.rs).
// shinchiro's build has everything that needs: D3D11 decoding, NVIDIA,
// Intel and AMD encoders, libx264 for the CPU, and libplacebo for tone
// mapping HDR on the GPU. 26MB compressed, 107MB on disk (2026-09-25).
//
// Needs 7-Zip for extraction (`7z` on PATH, or the default install path).
// If anything fails it prints the manual steps instead of half-working.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchPinned } from "./deps.mjs";

const DEST = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "apps",
  "app",
  "src-tauri",
  "ffmpeg.exe",
);

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  console.error(
    "\nManual fallback: download the ffmpeg-x86_64-git-*.7z named in\n" +
      "scripts/deps.json from this repo's release it names, check its SHA-256\n" +
      `against the one there, extract ffmpeg.exe, and place it at:\n  ${DEST}`,
  );
  process.exit(1);
};

const { name, buf } = await fetchPinned("ffmpeg", fail);
const dir = mkdtempSync(join(tmpdir(), "blammytv-ffmpeg-"));
const archive = join(dir, name);
writeFileSync(archive, buf);

const sevenZips = ["7z", "7za", "C:\\Program Files\\7-Zip\\7z.exe", "C:\\Program Files (x86)\\7-Zip\\7z.exe"];
const sz = sevenZips.find((c) => spawnSync(c, ["i"], { stdio: "ignore" }).status === 0);
if (!sz) fail("7-Zip not found (needed to extract the .7z)");

const ex = spawnSync(sz, ["e", archive, `-o${dir}`, "ffmpeg.exe", "-r", "-y"], { stdio: "inherit" });
if (ex.status !== 0 || !existsSync(join(dir, "ffmpeg.exe"))) fail("extraction failed");

copyFileSync(join(dir, "ffmpeg.exe"), DEST);
console.log(`✓ ${name} → ${DEST} (${(statSync(DEST).size / 1e6).toFixed(0)}MB)`);
console.log("Dev runs pick it up too (mvconvert.rs looks there in debug builds, and beside the exe).");
