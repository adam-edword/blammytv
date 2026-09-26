// Copy one shinchiro build of ffmpeg and libmpv into a release on this
// repo, and pin both archives' SHA-256 in scripts/deps.json (plan 018, N5).
// fetch-ffmpeg.mjs and fetch-libmpv.mjs then download from here and refuse
// anything else. See deps.mjs for why the copy.
//
// Runs in the "Mirror bundled binaries" workflow (.github/workflows/deps.yml),
// which commits the deps.json it writes. It needs GH_TOKEN with contents:
// write, the gh CLI, and GITHUB_REPOSITORY, all of which Actions provides.
//
// Which build: TAG_INPUT (the workflow's input), else the first line of
// scripts/deps-request.txt, else the latest. A shinchiro release tag, like
// "20260926", or "latest".
//
// THE RELEASE IS A PRERELEASE AND NEVER "LATEST". The app's updater reads
// releases/latest/download/latest.json and the site's download button links
// to releases/latest: a deps release there would break both.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PINS, download, sha256 } from "./deps.mjs";

const SOURCE = "shinchiro/mpv-winbuild-cmake";
const HERE = process.env.GITHUB_REPOSITORY;
const REQUEST = join(dirname(fileURLToPath(import.meta.url)), "deps-request.txt");

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
if (!HERE || !process.env.GH_TOKEN) fail("run this from the workflow: it needs GITHUB_REPOSITORY and GH_TOKEN");

const requested =
  process.env.TAG_INPUT?.trim() ||
  (existsSync(REQUEST) ? readFileSync(REQUEST, "utf8").split("\n")[0].trim() : "") ||
  "latest";
if (requested !== "latest" && !/^\d{8}$/.test(requested)) fail(`not a shinchiro tag: "${requested}"`);

const headers = { "user-agent": "blammytv-build", authorization: `Bearer ${process.env.GH_TOKEN}` };
const path = requested === "latest" ? "releases/latest" : `releases/tags/${requested}`;
const rel = await fetch(`https://api.github.com/repos/${SOURCE}/${path}`, { headers })
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  .catch((e) => fail(`${SOURCE} ${requested}: ${e.message}`));

// Plain x86_64 builds, as the fetch scripts always took: not -v3 (a newer
// CPU) or the clang variants.
const want = {
  ffmpeg: /^ffmpeg-x86_64-git-[0-9a-f]+\.7z$/,
  libmpv: /^mpv-dev-x86_64-\d{8}-git-[0-9a-f]+\.7z$/,
};
const dir = mkdtempSync(join(tmpdir(), "blammytv-deps-"));
const pins = { repo: HERE, release: `deps-${rel.tag_name}`, source: `${SOURCE} ${rel.tag_name}` };
const files = [];
for (const [which, re] of Object.entries(want)) {
  const asset = rel.assets.find((a) => re.test(a.name));
  if (!asset) fail(`no ${which} archive in ${SOURCE} ${rel.tag_name}`);
  const buf = await download(asset.browser_download_url).catch((e) => fail(e.message));
  const file = join(dir, asset.name);
  writeFileSync(file, buf);
  files.push(file);
  pins[which] = { asset: asset.name, sha256: sha256(buf) };
  console.log(`${which}: ${asset.name} (${(buf.length / 1e6).toFixed(1)}MB) ${pins[which].sha256}`);
}

const notes = [
  `The ffmpeg and libmpv BlammyTV bundles, copied from [${SOURCE} ${rel.tag_name}](${rel.html_url}) so the pinned build stays downloadable: shinchiro keeps only its latest builds.`,
  "",
  "Not a BlammyTV release. `scripts/fetch-ffmpeg.mjs` and `scripts/fetch-libmpv.mjs` download these and check them against `scripts/deps.json`:",
  "",
  ...Object.entries(want).map(([w]) => `- ${w}: \`${pins[w].asset}\`, SHA-256 \`${pins[w].sha256}\``),
  "",
  "ffmpeg is GPL; its source is at https://ffmpeg.org, and the build's at the link above.",
].join("\n");
const notesFile = join(dir, "notes.md");
writeFileSync(notesFile, notes);

const gh = (...args) => execFileSync("gh", args, { stdio: "inherit", env: process.env });
let exists = true;
try {
  execFileSync("gh", ["release", "view", pins.release, "--repo", HERE], { stdio: "ignore", env: process.env });
} catch {
  exists = false;
}
if (exists) {
  gh("release", "upload", pins.release, ...files, "--repo", HERE, "--clobber");
  gh("release", "edit", pins.release, "--repo", HERE, "--notes-file", notesFile, "--prerelease", "--latest=false");
} else {
  gh(
    "release", "create", pins.release, ...files,
    "--repo", HERE,
    "--title", `Bundled binaries: ${SOURCE} ${rel.tag_name}`,
    "--notes-file", notesFile,
    "--prerelease",
    "--latest=false",
    ...(process.env.GITHUB_SHA ? ["--target", process.env.GITHUB_SHA] : []),
  );
}

writeFileSync(PINS, JSON.stringify(pins, null, 2) + "\n");
console.log(`✓ ${pins.release} on ${HERE}, pinned in scripts/deps.json`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, notes + "\n");
