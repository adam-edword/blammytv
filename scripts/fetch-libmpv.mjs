// Fetch the bundled libmpv: the build pinned in scripts/deps.json, from
// this repo's own copy of it (a deps-* release), its SHA-256 checked (plan
// 018, N5). The installer ships apps/app/src-tauri/libmpv-2.dll
// (tauri.windows.conf.json bundle resources; the DLL itself is gitignored,
// never committed). Run this before a release build:
//
//   node scripts/fetch-libmpv.mjs
//
// For current mpv, run the "Mirror bundled binaries" workflow first (Actions
// tab, or a line in scripts/deps-request.txt): it copies a shinchiro build
// here and pins it, for this and fetch-ffmpeg.mjs together. It used to take
// shinchiro's latest here, unchecked, so what shipped was whatever was
// newest on the day.
//
// Needs 7-Zip for extraction (`7z` on PATH, or the default install path).
// If anything fails it prints the manual steps instead of half-working.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
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
  "libmpv-2.dll",
);
const API =
  "https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/latest";

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  console.error(
    "\nManual fallback: download the mpv-dev-x86_64-*.7z named in\n" +
      "scripts/deps.json from this repo's release it names, check its SHA-256\n" +
      `against the one there, extract libmpv-2.dll, and place it at:\n  ${DEST}`,
  );
  process.exit(1);
};

// The pinned build. Only before anything is pinned (the first mirror), the
// latest shinchiro build, as this script always took; that goes once
// scripts/deps.json exists.
let asset;
let buf;
const pinned = await fetchPinned("libmpv", fail);
if (pinned) {
  asset = { name: pinned.name };
  buf = pinned.buf;
} else {
  console.warn("nothing pinned yet (scripts/deps.json): taking shinchiro's latest, unchecked");
  const rel = await fetch(API, {
    headers: { "user-agent": "blammytv-build" },
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .catch((e) => fail(`GitHub API: ${e.message}`));
  // Plain x86_64 build (skip the -v3 / clang variants).
  asset = rel.assets.find((a) => /^mpv-dev-x86_64-\d{8}-git-[0-9a-f]+\.7z$/.test(a.name));
  if (!asset) fail(`no mpv-dev-x86_64 asset in release "${rel.tag_name}"`);
  console.log(`latest: ${asset.name} (${(asset.size / 1e6).toFixed(1)}MB)`);
  buf = Buffer.from(
    await fetch(asset.browser_download_url, {
      headers: { "user-agent": "blammytv-build" },
    })
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch((e) => fail(`download: ${e.message}`)),
  );
}
const dir = mkdtempSync(join(tmpdir(), "blammytv-libmpv-"));
const archive = join(dir, asset.name);
writeFileSync(archive, buf);

const sevenZips = [
  "7z",
  "7za",
  "C:\\Program Files\\7-Zip\\7z.exe",
  "C:\\Program Files (x86)\\7-Zip\\7z.exe",
];
const sz = sevenZips.find(
  (c) => spawnSync(c, ["i"], { stdio: "ignore" }).status === 0,
);
if (!sz) fail("7-Zip not found (needed to extract the .7z)");

const ex = spawnSync(sz, ["e", archive, `-o${dir}`, "libmpv-2.dll", "-y"], {
  stdio: "inherit",
});
if (ex.status !== 0 || !existsSync(join(dir, "libmpv-2.dll")))
  fail("extraction failed");

copyFileSync(join(dir, "libmpv-2.dll"), DEST);
console.log(`✓ ${asset.name} → ${DEST}`);
console.log(
  "Dev runs pick it up too (mpv.rs probes next-to-exe, resources/, PATH).",
);
