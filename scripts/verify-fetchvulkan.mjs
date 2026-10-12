// scripts/fetch-vulkan.mjs, against a local fake of LunarG (v0.11.35).
//
// The real archive can't be reached from every machine this runs on, so what
// is tested is the script's behaviour around it: a zip built here with the
// layout the pin's version implies, served from localhost, its hash in a TEST
// COPY of the pin. The real pin in scripts/deps.json is only read, for its
// shape, and the real destination (apps/app/src-tauri/vulkan) is never
// written: every run is pointed at a temp folder.
//
// The point of most of it is the refusals. fetch-vulkan fails CLOSED, so each
// bad input is followed by a look at the destination: it must not exist.
// "It exited 1" alone would pass for a script that wrote the files first.
//
//   node scripts/verify-fetchvulkan.mjs        (needs 7-Zip, as the script does)
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? `: ${extra}` : ""}`);
};
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const VERSION = "1.4.363.0";
const ROOT_DIR = `VulkanRT-X64-${VERSION}-Components`;
const work = mkdtempSync(join(tmpdir(), "verify-fetchvulkan-"));

const sevenZip = ["7z", "7za", "C:\\Program Files\\7-Zip\\7z.exe", "C:\\Program Files (x86)\\7-Zip\\7z.exe"].find(
  (c) => spawnSync(c, ["i"], { stdio: "ignore" }).status === 0,
);
if (!sevenZip) {
  check("7-Zip is installed (the script needs it, and so does this)", false);
  process.exit(1);
}

// What each file holds, so a copy can be told from the one beside it.
const X64 = Buffer.from("x64 loader " + "A".repeat(2048));
const X32 = Buffer.from("x86 loader " + "B".repeat(2048));
const LICENSE = Buffer.from("LunarG licence text\n");

/** A zip with the given files (path inside the archive → bytes). */
function zip(name, files) {
  const stage = join(work, `stage-${name}`);
  for (const [path, bytes] of Object.entries(files)) {
    const file = join(stage, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, bytes);
  }
  const out = join(work, `${name}.zip`);
  const r = spawnSync(sevenZip, ["a", "-tzip", out, ROOT_DIR], { cwd: stage, stdio: "ignore" });
  if (r.status !== 0) throw new Error(`7-Zip could not build ${name}`);
  return readFileSync(out);
}

const archives = {
  // The layout the script expects, with an x86 decoy beside the x64 loader.
  "good.zip": zip("good", {
    [`${ROOT_DIR}/x64/vulkan-1.dll`]: X64,
    [`${ROOT_DIR}/x32/vulkan-1.dll`]: X32,
    [`${ROOT_DIR}/VulkanRT-License.txt`]: LICENSE,
  }),
  // The licence is there; the x64 loader is not (only the decoy).
  "nodll.zip": zip("nodll", {
    [`${ROOT_DIR}/x32/vulkan-1.dll`]: X32,
    [`${ROOT_DIR}/VulkanRT-License.txt`]: LICENSE,
  }),
  // The loader is there; the licence is not.
  "nolicense.zip": zip("nolicense", {
    [`${ROOT_DIR}/x64/vulkan-1.dll`]: X64,
  }),
  // The same files under another top folder name: nobody here has seen the
  // real archive, so the script finds the files rather than assuming a path.
  "renamed.zip": zip("renamed", {
    [`${ROOT_DIR}/Runtime/x64/vulkan-1.dll`]: X64,
    [`${ROOT_DIR}/Runtime/x86/vulkan-1.dll`]: X32,
    [`${ROOT_DIR}/Runtime/VulkanRT-License.txt`]: LICENSE,
  }),
  // Two x64 loaders: which one ships is not a guess the script makes.
  "twox64.zip": zip("twox64", {
    [`${ROOT_DIR}/x64/vulkan-1.dll`]: X64,
    [`${ROOT_DIR}/extra/x64/vulkan-1.dll`]: X32,
    [`${ROOT_DIR}/VulkanRT-License.txt`]: LICENSE,
  }),
};

const server = createServer((req, res) => {
  const body = archives[req.url.slice(1)];
  res.statusCode = body ? 200 : 404;
  res.end(body ?? "no such file");
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let n = 0;
/**
 * Run the script against a test copy of the pin. `pin` is the vulkan entry (or
 * null for none); the destination is a fresh folder that does NOT exist yet,
 * so "nothing written" is "still not there". Async, and not spawnSync: the
 * script downloads from the server in THIS process, which a blocked event loop
 * could not answer.
 */
function run(pin) {
  const id = ++n;
  const pins = join(work, `deps-${id}.json`);
  writeFileSync(pins, JSON.stringify(pin ? { vulkan: pin } : {}));
  const dest = join(work, `dest-${id}`);
  return new Promise((resolve) => {
    const k = spawn(process.execPath, [join(ROOT, "scripts", "fetch-vulkan.mjs")], {
      env: { ...process.env, BLAMMYTV_VULKAN_PINS: pins, BLAMMYTV_VULKAN_DEST: dest },
    });
    let out = "";
    k.stdout.on("data", (d) => (out += d));
    k.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => k.kill("SIGKILL"), 30_000);
    k.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, dest });
    });
  });
}
const pinFor = (file, over = {}) => ({
  version: VERSION,
  url: `${BASE}/${file}`,
  sha256: sha256(archives[file] ?? Buffer.alloc(0)),
  ...over,
});
const same = (a, b) => existsSync(a) && readFileSync(a).equals(b);

// ---- A good archive lands both files ------------------------------------
{
  const r = await run(pinFor("good.zip"));
  check("a good archive: exits 0", r.code === 0, `exit ${r.code}`);
  check("  the x64 loader lands, and it is the x64 one, not the x86 beside it", same(join(r.dest, "vulkan-1.dll"), X64));
  check("  the licence lands beside it", same(join(r.dest, "VulkanRT-License.txt"), LICENSE));
  check("  and says it checked the hash", /SHA-256 checked/.test(r.out), r.out.split("\n")[0]);
}

// ---- A wrong hash refuses, and writes nothing ----------------------------
{
  const r = await run(pinFor("good.zip", { sha256: sha256(Buffer.from("some other file")) }));
  check("a wrong hash: refuses", r.code === 1, `exit ${r.code}`);
  check("  nothing is written: the destination was not even made", !existsSync(r.dest));
  check("  it says the file is not the one pinned, with both hashes", /not the file pinned/.test(r.out) && r.out.includes(sha256(archives["good.zip"])));
  check("  and prints the manual steps", /Manual fallback/.test(r.out) && r.out.includes(r.dest));
}

// ---- An archive missing a file refuses, and writes nothing ----------------
{
  // The pin matches these archives: it is the CONTENTS that are wrong.
  const r = await run(pinFor("nodll.zip"));
  check("an archive without the x64 loader: refuses", r.code === 1, `exit ${r.code}`);
  check("  nothing is written (the licence that was there is not left behind)", !existsSync(r.dest));
  check("  it names the missing file", /vulkan-1\.dll not in/.test(r.out), r.out.split("\n").find((l) => l.startsWith("✗")));
}
{
  const r = await run(pinFor("nolicense.zip"));
  check("an archive without the licence: refuses", r.code === 1, `exit ${r.code}`);
  check("  nothing is written (the loader that was there is not shipped without its licence)", !existsSync(r.dest));
  check("  it names the missing file", /VulkanRT-License\.txt not in/.test(r.out));
}

// ---- The other ways to fail ----------------------------------------------
{
  const r = await run(pinFor("absent.zip", { sha256: sha256(Buffer.from("x")) }));
  check("a download that 404s: refuses, writes nothing", r.code === 1 && !existsSync(r.dest) && /HTTP 404/.test(r.out), `exit ${r.code}`);
}
{
  const r = await run(null);
  check("no vulkan pin at all: refuses, writes nothing", r.code === 1 && !existsSync(r.dest) && /no vulkan/.test(r.out), `exit ${r.code}`);
}
{
  const r = await run(pinFor("renamed.zip"));
  check(
    "the files under another folder name still land, the x64 loader and not the x86",
    r.code === 0 && same(join(r.dest, "vulkan-1.dll"), X64) && same(join(r.dest, "VulkanRT-License.txt"), LICENSE),
    `exit ${r.code}`,
  );
}
{
  const r = await run(pinFor("twox64.zip"));
  check("two x64 loaders in one archive: refuses, writes nothing", r.code === 1 && !existsSync(r.dest) && /not one/.test(r.out), `exit ${r.code}`);
}
{
  const r = await run(pinFor("good.zip", { sha256: sha256(Buffer.from("x")) }));
  check("  the manual steps say how a dev PC keeps building meanwhile", /EMPTY files/.test(r.out) && /Not for a release/.test(r.out));
}

// ---- The real pin and the wiring around it --------------------------------
{
  const pin = JSON.parse(readFileSync(join(ROOT, "scripts", "deps.json"), "utf8")).vulkan;
  check(
    "scripts/deps.json pins the Vulkan Runtime: a version, LunarG's url for that version, a SHA-256",
    !!pin &&
      /^\d+\.\d+\.\d+\.\d+$/.test(pin.version) &&
      pin.url === `https://sdk.lunarg.com/sdk/download/${pin.version}/windows/VulkanRT-X64-${pin.version}-Components.zip` &&
      /^[0-9a-f]{64}$/.test(pin.sha256),
    JSON.stringify(pin),
  );
}
{
  const conf = JSON.parse(readFileSync(join(ROOT, "apps/app/src-tauri/tauri.windows.conf.json"), "utf8"));
  const res = conf.bundle?.resources ?? [];
  check(
    "the installer bundles the loader and its licence, beside libmpv and ffmpeg",
    ["libmpv-2.dll", "ffmpeg.exe", "vulkan/vulkan-1.dll", "vulkan/VulkanRT-License.txt"].every((f) => res.includes(f)),
    JSON.stringify(res),
  );
  const ignored = (f) => spawnSync("git", ["check-ignore", "-q", f], { cwd: ROOT }).status === 0;
  check(
    "  both are gitignored: nothing binary is committed",
    ignored("apps/app/src-tauri/vulkan/vulkan-1.dll") && ignored("apps/app/src-tauri/vulkan/VulkanRT-License.txt"),
  );
  const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const cr = readFileSync(join(ROOT, "scripts/check-rust.mjs"), "utf8");
  const both = (text) => text.includes("vulkan-1.dll") && text.includes("VulkanRT-License.txt");
  check("  CI's Windows job and check-rust.mjs both write placeholders for them, or the build refuses to run", both(ci) && both(cr));
}

server.close();
const fails = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
process.exit(fails.length ? 1 : 0);
