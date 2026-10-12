// Fetch the Vulkan loader the installer ships as a fallback: LunarG's Vulkan
// Runtime, the build pinned in scripts/deps.json, its SHA-256 checked. The
// installer ships apps/app/src-tauri/vulkan/vulkan-1.dll and
// VulkanRT-License.txt (tauri.windows.conf.json bundle resources; both are
// gitignored, never committed). Run it once on a dev machine and before a
// release build:
//
//   node scripts/fetch-vulkan.mjs
//
// WHY IT SHIPS. The pinned libmpv imports vulkan-1.dll, so a Windows machine
// with no Vulkan loader (some VMs, a basic display driver) cannot load the
// player at all. mpv.rs loads this copy by full path, ahead of libmpv, and
// only when Windows has none of its own: a driver's loader always wins (see
// mpvvulkan.rs). The licence file travels with the DLL.
//
// A DIRECT DOWNLOAD, not this repo's deps-* mirror (deps.mjs): mirroring it
// would mean adding to that release. Everything else is fetch-libmpv.mjs's
// shape: the pin is checked, 7-Zip extracts, and it prints the manual steps
// instead of half-working. It fails CLOSED: a download that doesn't match
// the pin, or an archive without the two files, writes nothing.
//
// FOR TESTS (scripts/verify-fetchvulkan.mjs): BLAMMYTV_VULKAN_PINS points at
// a copy of deps.json, and BLAMMYTV_VULKAN_DEST at the folder to write to.

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PINS, fetchPinnedUrl } from "./deps.mjs";

const pinFile = process.env.BLAMMYTV_VULKAN_PINS ?? PINS;
const DEST =
  process.env.BLAMMYTV_VULKAN_DEST ??
  join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "apps",
    "app",
    "src-tauri",
    "vulkan",
  );

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  console.error(
    "\nManual fallback: download the Vulkan Runtime components zip named in\n" +
      "scripts/deps.json (the url there is LunarG's), check its SHA-256 against\n" +
      "the one there, extract vulkan-1.dll (from the x64 folder) and\n" +
      `VulkanRT-License.txt, and place both in:\n  ${DEST}\n` +
      "\nTo keep building on a PC with its own Vulkan loader (any normal GPU\n" +
      "driver) in the meantime, two EMPTY files of those names there will do:\n" +
      "the app only loads ours when Windows has none. Not for a release.",
  );
  process.exit(1);
};

const { name, buf } = await fetchPinnedUrl("vulkan", fail, pinFile);

const dir = mkdtempSync(join(tmpdir(), "blammytv-vulkan-"));
const archive = join(dir, name);
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
if (!sz) fail("7-Zip not found (needed to extract the .zip)");

// The whole archive, with its folders, and then a search for the two files.
// Nobody here has seen the real archive (sdk.lunarg.com was unreachable when
// this was written), so it doesn't lean on the top folder's name or on how
// 7-Zip takes a `/` in a filter. The x64 folder is the one rule: the zip also
// holds a 32-bit loader under the same name.
const out = join(dir, "out");
const ex = spawnSync(sz, ["x", archive, `-o${out}`, "-y"], {
  stdio: ["ignore", "ignore", "inherit"],
});
if (ex.status !== 0) fail(`extraction failed: 7-Zip reported an error`);
const all = readdirSync(out, { recursive: true }).map((p) => join(out, p));
const is = (p, file) => basename(p).toLowerCase() === file.toLowerCase();
const dlls = all.filter(
  (p) => is(p, "vulkan-1.dll") && basename(dirname(p)).toLowerCase() === "x64",
);
const licences = all
  .filter((p) => is(p, "VulkanRT-License.txt"))
  .sort((a, b) => a.length - b.length);
const missing = [
  ...(dlls.length ? [] : ["x64/vulkan-1.dll"]),
  ...(licences.length ? [] : ["VulkanRT-License.txt"]),
];
if (missing.length) fail(`extraction failed: ${missing.join(" and ")} not in ${name}`);
if (dlls.length > 1)
  fail(`extraction failed: ${name} has ${dlls.length} x64/vulkan-1.dll, not one`);

// Only now, with both in hand, does anything reach the destination.
mkdirSync(DEST, { recursive: true });
copyFileSync(dlls[0], join(DEST, "vulkan-1.dll"));
copyFileSync(licences[0], join(DEST, "VulkanRT-License.txt"));
console.log(`✓ ${name} → ${DEST}`);
console.log(
  "Dev runs pick it up too (mpv.rs probes vulkan/ beside the exe and in resources/).",
);
