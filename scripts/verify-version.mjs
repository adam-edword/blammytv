/**
 * Do the six version files agree?
 *
 * A release is only correct when tauri.conf.json, Cargo.toml, Cargo.lock and
 * the three JS-side files all say the same thing — the updater compares the
 * running build against tauri.conf.json's version, so a half-bumped release
 * either never offers itself or offers itself forever.
 *
 * Between releases the three NATIVE files deliberately lag at the last
 * released version (bumping them makes every `git pull` recompile Rust), so
 * "they disagree" is the normal mid-development state. This script reports
 * which of the two shapes it is rather than just failing:
 *
 *   node scripts/verify-version.mjs            → describe the current state
 *   node scripts/verify-version.mjs --release  → REQUIRE all six to agree
 *
 * Use --release in the release commit. RELEASING.md's step 1 listed four
 * files, named one path that does not exist, and omitted the root
 * package.json and Cargo.lock — following it literally shipped an
 * under-bumped release, which is why this exists.
 */
import { readFileSync } from "node:fs";

const at = (p) => new URL(`../${p}`, import.meta.url);
const json = (p) => JSON.parse(readFileSync(at(p), "utf8"));

const JS = [
  ["package.json", () => json("package.json").version],
  ["apps/app/package.json", () => json("apps/app/package.json").version],
  [
    "apps/app/src/lib/version.ts",
    () =>
      /APP_VERSION\s*=\s*"([^"]+)"/.exec(
        readFileSync(at("apps/app/src/lib/version.ts"), "utf8"),
      )?.[1],
  ],
];

const NATIVE = [
  [
    "apps/app/src-tauri/tauri.conf.json",
    () => json("apps/app/src-tauri/tauri.conf.json").version,
  ],
  [
    "apps/app/src-tauri/Cargo.toml",
    () =>
      /^version\s*=\s*"([^"]+)"/m.exec(
        readFileSync(at("apps/app/src-tauri/Cargo.toml"), "utf8"),
      )?.[1],
  ],
  [
    "apps/app/src-tauri/Cargo.lock",
    () =>
      // The `app` package's own entry, not the first version key in the file.
      /name = "app"\nversion = "([^"]+)"/.exec(
        readFileSync(at("apps/app/src-tauri/Cargo.lock"), "utf8"),
      )?.[1],
  ],
];

const read = ([label, get]) => {
  try {
    return [label, get() ?? "(not found)"];
  } catch (err) {
    return [label, `(unreadable: ${err.message})`];
  }
};

const js = JS.map(read);
const native = NATIVE.map(read);
const uniq = (rows) => [...new Set(rows.map(([, v]) => v))];

console.log("\n  frontend (moves on every dev bump)");
for (const [l, v] of js) console.log(`    ${v.padEnd(12)} ${l}`);
console.log("\n  native (moves only in the release commit)");
for (const [l, v] of native) console.log(`    ${v.padEnd(12)} ${l}`);

const jsVersions = uniq(js);
const nativeVersions = uniq(native);
let bad = 0;
const check = (label, ok, detail = "") => {
  console.log(`\n  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) bad++;
};

check("the three frontend files agree", jsVersions.length === 1, jsVersions.join(" vs "));
check("the three native files agree", nativeVersions.length === 1, nativeVersions.join(" vs "));

if (process.argv.includes("--release")) {
  check(
    "frontend and native agree (required for a release)",
    jsVersions.length === 1 && nativeVersions.length === 1 && jsVersions[0] === nativeVersions[0],
    `${jsVersions.join("/")} vs ${nativeVersions.join("/")}`,
  );
} else if (jsVersions.length === 1 && nativeVersions.length === 1) {
  console.log(
    jsVersions[0] === nativeVersions[0]
      ? "\n  state: RELEASE-READY — all six agree.\n"
      : `\n  state: mid-development — frontend ${jsVersions[0]} ahead of native ${nativeVersions[0]}.` +
          `\n         Expected between releases. Run with --release in the release commit.\n`,
  );
}

if (bad) console.log(`\n  ${bad} check(s) FAILED\n`);
process.exit(bad ? 1 : 0);
