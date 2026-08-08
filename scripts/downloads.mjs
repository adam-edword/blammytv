/**
 * How many times has the installer been downloaded?
 *
 *   node scripts/downloads.mjs
 *   node scripts/downloads.mjs --json
 *
 * GitHub counts every release-asset download for free and exposes it as
 * `download_count` on the releases API. No auth needed for a public repo, no
 * analytics, nothing to deploy. This just adds it up.
 *
 * THE CAVEAT THIS SCRIPT EXISTS TO MAKE UNMISSABLE: the auto-updater fetches
 * the SAME .exe a person downloads. releases/*\/latest.json points at
 *   https://github.com/<repo>/releases/download/<tag>/BlammyTV_<v>_x64-setup.exe
 * which is the asset counted here. So a release's number is
 *   people who chose to download it  +  every native auto-update onto it
 * with no way to separate them from outside.
 *
 * What rescues it: a release only receives updater traffic while it is the
 * update target. Once a newer one ships, its count stops moving except for
 * humans deliberately fetching that version. So the LATEST row is the most
 * contaminated and older rows are the cleaner human signal, which is why the
 * report marks the latest rather than just printing a total.
 *
 * Frontend-only updates fetch a different bundle and never touch these.
 *
 * Rate limit: unauthenticated GitHub allows 60 requests/hour per IP, and this
 * uses one per 100 releases. Set GITHUB_TOKEN if you hit it.
 */

const REPO = process.env.REPO ?? "adam-edword/blammytv";
const API = process.env.GITHUB_API ?? "https://api.github.com";
const asJson = process.argv.includes("--json");

/** Installer assets only. A release also carries latest.json, the .sig files
 * and the frontend bundle; counting those would answer a different question
 * (update CHECKS, not installs) while looking like it answered this one. */
const isInstaller = (name) => name.endsWith(".exe");

async function fetchReleases() {
  const headers = { accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const out = [];
  // Paginate to the end rather than assuming one page: this repo is well past
  // 100 releases' worth of tags, and a silent truncation here would read as a
  // real drop in downloads.
  for (let page = 1; page <= 20; page++) {
    const url = `${API}/repos/${REPO}/releases?per_page=100&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const hint =
        res.status === 403 || res.status === 429
          ? "  (rate limited? set GITHUB_TOKEN)"
          : res.status === 404
            ? "  (wrong REPO, or the repo is private and needs GITHUB_TOKEN)"
            : "";
      throw new Error(`GitHub returned HTTP ${res.status} for ${url}${hint}`);
    }
    const batch = await res.json();
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

const rows = [];
let releases;
try {
  releases = await fetchReleases();
} catch (err) {
  console.error(`\ndownloads: ${err.message}\n`);
  process.exit(1);
}

for (const rel of releases) {
  for (const a of rel.assets ?? []) {
    if (!isInstaller(a.name)) continue;
    rows.push({
      tag: rel.tag_name,
      asset: a.name,
      downloads: a.download_count,
      published: rel.published_at,
      prerelease: Boolean(rel.prerelease),
    });
  }
}

// Newest first, by publish date. The API's default order is already this, but
// sorting explicitly means the "current update target" mark below can't be
// pinned on the wrong row if that ever changes.
rows.sort((a, b) => String(b.published).localeCompare(String(a.published)));
const total = rows.reduce((n, r) => n + r.downloads, 0);
/** The newest non-prerelease is what the updater points at, so it is the row
 * carrying auto-update traffic right now. */
const current = rows.find((r) => !r.prerelease)?.tag ?? null;

if (asJson) {
  console.log(JSON.stringify({ repo: REPO, total, current, releases: rows }, null, 2));
  process.exit(0);
}

if (rows.length === 0) {
  console.log(`\nNo .exe assets found on any release of ${REPO}.\n`);
  process.exit(0);
}

const n = (x) => x.toLocaleString("en-US");
const tagW = Math.max(3, ...rows.map((r) => r.tag.length));
const numW = Math.max(9, ...rows.map((r) => n(r.downloads).length));

console.log(`\nInstaller downloads: ${REPO}\n`);
console.log(`  ${"tag".padEnd(tagW)}  ${"downloads".padStart(numW)}`);
console.log(`  ${"-".repeat(tagW)}  ${"-".repeat(numW)}`);
for (const r of rows) {
  const mark = r.tag === current ? "   <- current update target" : "";
  console.log(`  ${r.tag.padEnd(tagW)}  ${n(r.downloads).padStart(numW)}${mark}`);
}
console.log(`  ${"-".repeat(tagW)}  ${"-".repeat(numW)}`);
console.log(`  ${"total".padEnd(tagW)}  ${n(total).padStart(numW)}\n`);
console.log(
  [
    "  These count humans AND native auto-updates: the updater fetches the",
    "  same .exe a person does. The current update target is the most",
    "  contaminated row. Older releases have stopped receiving updater",
    "  traffic, so their numbers are the cleaner human signal.",
    "",
  ].join("\n"),
);
