/**
 * How many times has the installer been downloaded?
 *
 *   node scripts/downloads.mjs
 *   node scripts/downloads.mjs --json
 *
 * GitHub counts every release-asset download for free and exposes it as
 * `download_count` on the releases API. No auth on a public repo, no
 * analytics, nothing to deploy. This adds it up.
 *
 * TWO COLUMNS, because one number was being misread. Each release carries an
 * installer AND the updater's latest.json, and they count different events:
 *
 *   installs   the .exe. A machine only fetches this when it actually
 *              installs that version, whether a person clicked Download or
 *              the updater applied it.
 *   checks     latest.json. Every running app fetches this on every update
 *              check, so it tracks how much a version was USED afterwards,
 *              not how many people got it.
 *
 * The gap is large and it matters: v0.8.0 shows 6 installs against 67 checks.
 * Reading the 67 as downloads overstates it by more than tenfold.
 *
 * Auto-updates do land in the installs column, since the updater fetches the
 * same .exe a person does, and there is no way to split them from outside. A
 * release only takes updater traffic while it is the update target, so the
 * marked row is the contaminated one and older rows have settled.
 *
 * Frontend-only updates fetch frontend.json and a separate bundle, and touch
 * neither column.
 *
 * Rate limit: unauthenticated GitHub allows 60 requests/hour per IP, and this
 * uses one per 100 releases. Set GITHUB_TOKEN if you hit it.
 */
const REPO = process.env.REPO ?? "adam-edword/blammytv";
const API = process.env.GITHUB_API ?? "https://api.github.com";
const asJson = process.argv.includes("--json");

/** Installer assets only. Counting anything else in this column would answer
 * a different question while looking like it answered this one. */
const isInstaller = (name) => name.endsWith(".exe");

/** The updater's manifest. Every app fetches it on every update CHECK, but
 * only downloads the .exe when an update actually applies, so the two columns
 * measure different things and the gap between them is informative:
 *   installs  ~ machines that ended up running this version
 *   checks    ~ how much that version was in use afterwards
 * A release with many checks and few installs was widely RUN, not widely
 * installed. That is what v0.8.0's 67 was. */
const isManifest = (name) => name === "latest.json";

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
  const assets = rel.assets ?? [];
  const exe = assets.find((a) => isInstaller(a.name));
  if (!exe) continue;
  rows.push({
    tag: rel.tag_name,
    asset: exe.name,
    downloads: exe.download_count,
    checks: assets.find((a) => isManifest(a.name))?.download_count ?? null,
    published: rel.published_at,
    prerelease: Boolean(rel.prerelease),
  });
}

// Newest first, by publish date. The API's own order is NOT this: a release
// edited later comes back out of sequence (v0.5.4 arrives last while having
// been published between v0.5.2 and v0.6.0). Without this sort the "current
// update target" mark lands on the wrong row.
rows.sort((a, b) => String(b.published).localeCompare(String(a.published)));
const total = rows.reduce((n, r) => n + r.downloads, 0);
const totalChecks = rows.reduce((n, r) => n + (r.checks ?? 0), 0);
/** The newest non-prerelease is what the updater points at, so it is the row
 * carrying auto-update traffic right now. */
const current = rows.find((r) => !r.prerelease)?.tag ?? null;

if (asJson) {
  console.log(
    JSON.stringify({ repo: REPO, total, totalChecks, current, releases: rows }, null, 2),
  );
  process.exit(0);
}

if (rows.length === 0) {
  console.log(`\nNo .exe assets found on any release of ${REPO}.\n`);
  process.exit(0);
}

const n = (x) => x.toLocaleString("en-US");
const dash = (x) => (x === null ? "-" : n(x));
const tagW = Math.max(3, ...rows.map((r) => r.tag.length));
const dlW = Math.max(8, ...rows.map((r) => n(r.downloads).length));
const ckW = Math.max(6, ...rows.map((r) => dash(r.checks).length));

console.log(`\nBlammyTV downloads: ${REPO}\n`);
console.log(`  ${"tag".padEnd(tagW)}  ${"installs".padStart(dlW)}  ${"checks".padStart(ckW)}`);
console.log(`  ${"-".repeat(tagW)}  ${"-".repeat(dlW)}  ${"-".repeat(ckW)}`);
for (const r of rows) {
  const mark = r.tag === current ? "   <- current update target" : "";
  console.log(
    `  ${r.tag.padEnd(tagW)}  ${n(r.downloads).padStart(dlW)}  ${dash(r.checks).padStart(ckW)}${mark}`,
  );
}
console.log(`  ${"-".repeat(tagW)}  ${"-".repeat(dlW)}  ${"-".repeat(ckW)}`);
console.log(
  `  ${"total".padEnd(tagW)}  ${n(total).padStart(dlW)}  ${n(totalChecks).padStart(ckW)}\n`,
);
console.log(
  [
    "  installs  the .exe, so one per machine that ran that version's setup.",
    "            Includes native auto-updates, which fetch the same file.",
    "  checks    latest.json, fetched on every update check by every running",
    "            app. It measures USE after release, not downloads.",
    "",
  ].join("\n"),
);
