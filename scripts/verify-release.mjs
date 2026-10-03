/**
 * Verify a Tauri updater signature, or a whole update manifest, before it ships.
 *
 * RELEASING.md: "the sig math can be checked against the uploaded exe before
 * shipping the manifest (blake2b-512 of the file, Ed25519 against tauri.conf's
 * pubkey)". This is that check, offline and in one command.
 *
 *   node scripts/verify-release.mjs <file> <file.sig>
 *   node scripts/verify-release.mjs <manifest.json> [asset-file] [--offline]
 *   node scripts/verify-release.mjs <frontend.tar.gz>
 *   node scripts/verify-release.mjs --self-test
 *
 * A FRONTEND BUNDLE (.tar.gz) also gets its LAYOUT checked, in every mode
 * that has its bytes, and on its own with no .sig straight after packing:
 * each entry must be a file or a directory (`frontend.rs` refuses a symlink,
 * a hard link or anything else, the whole bundle with it) at a path it will
 * unpack, `index.html` must be at the root, and, where the archive was just
 * packed from it, nothing in apps/app/dist may be missing. One place this is
 * stricter than the app: a leading `./`, which `tar -C dist .` writes, is
 * still refused here although the app has dropped it since v0.10.38.
 * RELEASING.md told you to pack `.` from 0.7 until v0.9.82: every installed
 * copy would have refused the first frontend-only release.
 *
 * FILE MODE checks, in order, and says which one failed:
 *   1. the .sig's key id matches the pubkey compiled into the app
 *   2. minisign's global signature, so the trusted comment is authentic
 *   3. the trusted comment names THIS file (never pair an exe with another
 *      build's .sig — every build mints a new pair)
 *   4. Ed25519 over blake2b-512 of the file's bytes
 *
 * MANIFEST MODE takes a latest.json or frontend.json and checks the same
 * signature plus everything around it: that the manifest is shaped right, that
 * its signature is a real signature and not a placeholder someone forgot to
 * replace, that it names the asset its url points at, that the versions agree,
 * and that the url actually resolves. A latest.json is also held to what
 * tauri-plugin-updater would refuse it for: a version that is not semver, a
 * pub_date that is not RFC 3339, and no platform key a Windows x64 install
 * asks for. v0.8.163 shipped a frontend.json whose signature read "PASTE THE
 * FULL CONTENTS OF ..." and whose url 404'd; file mode could not have caught
 * either, because neither is about the crypto.
 * Pass a local asset file to additionally verify the bytes offline; without
 * one the url is fetched and verified, unless --offline says not to.
 *
 * --self-test runs the layout and manifest rules above against archives and
 * strings built in this file, with no release in hand. Run it after editing
 * them.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, createPublicKey, verify } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

const argv = process.argv.slice(2);
const offline = argv.includes("--offline");
const selfTest = argv.includes("--self-test");
const [a, b] = argv.filter((x) => !x.startsWith("--"));
if (!a && !selfTest) {
  console.error("usage: node scripts/verify-release.mjs <file> <file.sig>");
  console.error("       node scripts/verify-release.mjs <manifest.json> [asset] [--offline]");
  console.error("       node scripts/verify-release.mjs --self-test");
  process.exit(2);
}

const conf = JSON.parse(
  readFileSync(new URL("../apps/app/src-tauri/tauri.conf.json", import.meta.url)),
);
const pubFile = Buffer.from(conf.plugins.updater.pubkey, "base64").toString();
const pubLine = pubFile.split("\n").find((l) => l && !l.startsWith("untrusted"));
const pubBlob = Buffer.from(pubLine, "base64");
const rawPub = pubBlob.subarray(10);

const id = (blob) => Buffer.from(blob.subarray(2, 10)).reverse().toString("hex").toUpperCase();
const key = createPublicKey({
  key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), rawPub]),
  format: "der",
  type: "spki",
});

let bad = 0;
/** Set when --offline stopped the url from being fetched. The bytes may
 * still have been verified locally, so this is a note rather than a fault. */
let skippedUrl = false;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) bad++;
};
const fail = (label, detail) => check(label, false, detail);
const done = () => {
  // "all checks passed" would be a lie in --offline manifest mode with no
  // local asset: the signature was never checked against any bytes at all.
  const unchecked = skippedUrl ? " (the URL was not fetched, --offline)" : "";
  console.log(
    bad
      ? `\n${bad} check(s) FAILED — do not publish\n`
      : `\nall checks passed${unchecked}\n`,
  );
  process.exit(bad ? 1 : 0);
};

/**
 * A .sig is base64 of a minisign file: comment, signature, trusted comment,
 * global signature. Anything that isn't that shape is not a signature — which
 * is the whole point in manifest mode, where the field is hand-pasted and the
 * failure we actually shipped was a sentence of English sitting in it.
 */
function parseSig(text) {
  let inner;
  try {
    inner = Buffer.from(text.trim(), "base64").toString();
  } catch {
    return null;
  }
  const lines = inner.split("\n");
  if (lines.length < 4) return null;
  if (!lines[0].startsWith("untrusted comment:")) return null;
  if (!lines[2].startsWith("trusted comment:")) return null;
  const blob = Buffer.from(lines[1], "base64");
  const global = Buffer.from(lines[3], "base64");
  if (blob.length !== 74 || global.length !== 64) return null;
  return { blob, global, trusted: lines[2].replace(/^trusted comment: */, "") };
}

/** The three checks that need only the signature and the name it claims. */
function checkSig(sig, expectedName) {
  check("key id matches tauri.conf.json", id(sig.blob) === id(pubBlob), id(sig.blob));
  check(
    "trusted comment is authentic",
    verify(null, Buffer.concat([sig.blob.subarray(10), Buffer.from(sig.trusted)]), key, sig.global),
  );
  const named = /file:(.+?)\s*$/.exec(sig.trusted)?.[1];
  check("the signature names this file", named === expectedName, named ?? "(no file: in comment)");
}

const bytesOk = (bytes, sig) =>
  verify(null, createHash("blake2b512").update(bytes).digest(), key, sig.blob.subarray(10));

/**
 * The entries of a .tar.gz (path and type flag), read the way the tar crate
 * hands them to `frontend.rs`: raw bytes, a GNU long name (`L`) or a pax
 * `path=` record overriding the header's own name, the ustar prefix joined
 * on. The extension headers that describe the next entry (`L`, `K`, `x`) are
 * not entries, as there. A pax GLOBAL header (`g`, which `git archive` writes
 * first) is one: the tar crate hands it over like any other entry, so it
 * falls to the type rule below and the app refuses the bundle for it.
 */
function tarEntries(gz) {
  const buf = gunzipSync(gz);
  const entries = [];
  const str = (b) => b.toString("utf8").replace(/\0.*$/s, "");
  let next = null;
  for (let off = 0; off + 512 <= buf.length; ) {
    const h = buf.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    const size = parseInt(str(h.subarray(124, 136)).trim() || "0", 8);
    // A size that is not a number, or is negative, would stall this loop or
    // end it early with entries unread. The tar crate errors on one too.
    if (!(size >= 0)) throw new Error(`a tar header at byte ${off} has no readable size`);
    const type = String.fromCharCode(h[156] || 48);
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === "L") {
      next = str(data);
      continue;
    }
    if (type === "x") {
      const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString("utf8"));
      if (m) next = m[1];
      continue;
    }
    if (type === "K") continue;
    const prefix = str(h.subarray(345, 500));
    const name = str(h.subarray(0, 100));
    entries.push({ path: next ?? (prefix ? `${prefix}/${name}` : name), type });
    next = null;
  }
  return entries;
}

/**
 * The path rule of `frontend.rs`'s `unpack`: every component of every entry
 * must be a plain name, so nothing absolute, no drive prefix, no `..`. Rust's
 * `Path::components` folds away a "." in the MIDDLE of a path but keeps one
 * at the start, so `./index.html` is `[CurDir, Normal]`. The app refused that
 * until v0.10.38 and drops the CurDir now, but this still refuses it: a
 * bundle that passes here is one every unpacker since 0.9.0 takes. `tar -C
 * dist .` writes a bare `./` and a `./` on every entry, which is what
 * RELEASING.md used to tell you to run.
 */
function refusedPath(p) {
  if (/^[\\/]/.test(p)) return "absolute";
  const parts = p.split(/[\\/]/);
  if (/^[A-Za-z]:/.test(parts[0])) return "drive prefix";
  if (parts[0] === ".") return "starts with ./";
  if (parts.includes("..")) return "contains ..";
  return null;
}

/**
 * The entry types `frontend.rs` unpacks: a regular file (`0`, or a NUL byte
 * the reader above has already turned into `0`) and a directory (`5`). It
 * checks `is_file() || is_dir()` before the path, so a link of either kind
 * (a symlink's target is written as given, v0.10.47) and every other type
 * refuse the whole bundle.
 */
const UNPACKED_TYPES = new Set(["0", "5"]);
const TYPE_NAMES = {
  1: "hard link",
  2: "symlink",
  3: "character device",
  4: "block device",
  6: "fifo",
  7: "contiguous file",
  g: "pax global header",
  S: "sparse file",
};
const typeName = (t) => TYPE_NAMES[t] ?? `type ${JSON.stringify(t)}`;

/** Every file under a directory, as archive-style relative paths. */
function filesUnder(dir, rel = "") {
  return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((d) => {
    const p = rel ? `${rel}/${d.name}` : d.name;
    return d.isDirectory() ? filesUnder(dir, p) : [p];
  });
}

const DIST = fileURLToPath(new URL("../apps/app/dist", import.meta.url));

/**
 * `withDist`: also require every file in the local build. Only where the
 * archive was just packed from it (layout-only and file mode), never for a
 * published manifest, where the local dist may be any build at all. The
 * first fix for the `./` problem named `index.html assets` by hand and
 * quietly dropped `logo.svg`, which sits beside them; this is what caught it.
 */
function layoutFindings(gz, withDist = false) {
  let entries;
  try {
    entries = tarEntries(gz);
  } catch (err) {
    return [["the bundle is a tar.gz", false, String(err.message ?? err)]];
  }
  const paths = entries.map((e) => e.path);
  const found = [];
  if (withDist && existsSync(DIST)) {
    const packed = new Set(paths.map((p) => p.replace(/^\.\//, "")));
    const missing = filesUnder(DIST).filter((f) => !packed.has(f));
    found.push([
      "the bundle carries every file in apps/app/dist",
      missing.length === 0,
      missing.length ? `missing: ${missing.slice(0, 3).join(", ")}` : "",
    ]);
  }
  const odd = entries.filter((e) => !UNPACKED_TYPES.has(e.type));
  found.push([
    "every entry is a file or a directory",
    odd.length === 0,
    odd.length ? `${odd.length} refused, first: "${odd[0].path}" (${typeName(odd[0].type)})` : "",
  ]);
  const refused = paths
    .map((p) => [p, refusedPath(p)])
    .filter(([, why]) => why);
  found.push([
    "every entry is a path the app will unpack",
    refused.length === 0,
    refused.length
      ? `${refused.length} refused, first: "${refused[0][0]}" (${refused[0][1]})`
      : `${paths.length} entries`,
  ]);
  found.push([
    "index.html sits at the archive root",
    paths.includes("index.html"),
    paths.includes("index.html") ? "" : "the app serves nothing without it",
  ]);
  return found;
}

const checkLayout = (gz, withDist = false) => {
  for (const [label, ok, detail] of layoutFindings(gz, withDist)) check(label, ok, detail);
};

// ------------------------------------------------- what the updater accepts

/**
 * A latest.json is read by tauri-plugin-updater (2.10.1, the version
 * Cargo.lock pins), and it refuses the WHOLE manifest, with nothing shown to
 * the user, for any of the three below. The rules are copied from its source
 * (src/updater.rs) and checked against the crates themselves over 40000
 * strings, so a green line here means the updater parses the field.
 *
 * `version`: `parse_version` drops every leading `v`, then `semver::Version`
 * parses what is left. So major.minor.patch (all three, no leading zeros, each
 * under 2^64), an optional `-pre.release` and an optional `+build`.
 */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
function versionOk(v) {
  const m = typeof v === "string" ? SEMVER.exec(v.replace(/^v+/, "")) : null;
  return Boolean(m) && [m[1], m[2], m[3]].every((n) => BigInt(n) <= 0xffff_ffff_ffff_ffffn);
}

const daysIn = (y, m) =>
  [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

/**
 * `pub_date`: an optional string, parsed by `time`'s `Rfc3339` (0.3.51).
 * Absent or null is fine (the update just has no date). A string is
 * YYYY-MM-DD, ANY one ASCII character (`T`, a space, even `x`), HH:MM:SS, an
 * optional .fraction of one digit or more, then `Z` or `z` or +HH:MM or
 * -HH:MM, and nothing after. The numbers must be real: a day the month has,
 * hour to 23, minute to 59, second to 59, offset hour to 23, offset minute to
 * 59. Second 60 is taken only as the last second of a month in UTC. Not
 * accepted: a date alone, no offset (`2026-06-24T00:00:00`), `+0100`.
 *
 * Returns what is wrong with it, or null.
 */
function rfc3339Problem(s) {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})[^\u0080-\uffff](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/.exec(s);
  if (!m) return "not YYYY-MM-DDTHH:MM:SS followed by Z or +HH:MM";
  const [y, mo, d, h, mi, sec] = m.slice(1, 7).map(Number);
  const oh = m[8] === undefined ? 0 : Number(m[8]);
  const om = m[9] === undefined ? 0 : Number(m[9]);
  if (mo < 1 || mo > 12) return `month ${m[2]} is not 01 to 12`;
  if (d < 1 || d > daysIn(y, mo)) return `day ${m[3]} is not a day of ${m[1]}-${m[2]}`;
  if (h > 23) return `hour ${m[4]} is past 23`;
  if (mi > 59) return `minute ${m[5]} is past 59`;
  if (sec > 60) return `second ${m[6]} is past 60`;
  if (oh > 23) return `offset hour ${m[8]} is past 23`;
  if (om > 59) return `offset minute ${m[9]} is past 59`;
  if (sec === 60) {
    const t = new Date(0);
    t.setUTCFullYear(y, mo - 1, d);
    t.setUTCHours(h, mi, 59, 999);
    const u = new Date(t.getTime() - (m[7] === "-" ? -1 : 1) * (oh * 60 + om) * 60_000);
    const lastOfMonth =
      u.getUTCHours() === 23 &&
      u.getUTCMinutes() === 59 &&
      u.getUTCDate() === daysIn(u.getUTCFullYear(), u.getUTCMonth() + 1);
    if (!lastOfMonth) return "second 60 only counts as the last second of a month in UTC";
  }
  return null;
}

/**
 * `platforms`: `get_urls` looks for `{os}-{arch}-{installer}` and then
 * `{os}-{arch}`. The installer is the bundle type the build was patched with,
 * so an NSIS install asks for `windows-x86_64-nsis`, then `windows-x86_64`.
 * (A binary run outside an installer only asks for the second.) Every entry
 * must also carry a url and a signature or the whole manifest fails to parse,
 * which the per-entry check in manifest mode already insists on.
 */
const WINDOWS_KEYS = ["windows-x86_64-nsis", "windows-x86_64"];

// ---------------------------------------------------------------- self-test

/**
 * `--self-test`: the rules above, run against archives and strings built here,
 * so a later edit that stops refusing a link, or starts refusing a date the
 * updater takes, fails with no release to hold it up. Every expected answer
 * was read off the real crates or the real unpacker, not off this file.
 */
if (selfTest) {
  /** Just enough tar for `tarEntries`: ustar headers, a NUL-padded body. */
  const pack = (entries) => {
    const blocks = [];
    for (const { name, type = "0", link = "", body = "", rawSize } of entries) {
      const h = Buffer.alloc(512);
      h.write(name, 0, 100);
      h.write("0000644\0", 100);
      h.write(rawSize ?? body.length.toString(8).padStart(11, "0") + "\0", 124);
      h.write("        ", 148);
      h.write(type, 156);
      h.write(link, 157, 100);
      h.write("ustar\x0000", 257);
      h.write(h.reduce((n, x) => n + x, 0).toString(8).padStart(6, "0") + "\0 ", 148);
      blocks.push(h, Buffer.from(body), Buffer.alloc((512 - (body.length % 512)) % 512));
    }
    return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
  };
  const plain = [
    { name: "index.html", body: "<html>" },
    { name: "assets/", type: "5" },
    { name: "assets/app.js", body: "1" },
  ];
  const TYPE_LINE = "every entry is a file or a directory";
  const typeLine = (entries) => layoutFindings(pack(entries)).find(([l]) => l === TYPE_LINE);

  console.log("\nthe layout check, on archives built here");
  check(
    "a bundle of plain files and directories passes every line",
    layoutFindings(pack(plain)).every(([, ok]) => ok),
  );
  const leak = (type, link) => ({ name: "assets/leak.txt", type, link });
  for (const [label, entries, want] of [
    ["a symlink is refused", [...plain, leak("2", "/etc/hostname")], "symlink"],
    ["a hard link is refused", [...plain, leak("1", "index.html")], "hard link"],
    ["a fifo is refused: only files and directories are unpacked", [...plain, leak("6", "")], "fifo"],
    [
      "a GNU long link name is not an entry of its own",
      [...plain, { name: "././@LongLink", type: "K", body: "../".repeat(60) + "\0" }, leak("2", "../x")],
      '1 refused, first: "assets/leak.txt" (symlink)',
    ],
    [
      "a pax global header is an entry, and refused (git archive writes one)",
      [{ name: "pax_global_header", type: "g", body: "20 comment=abc\n" }, ...plain],
      '"pax_global_header" (pax global header)',
    ],
  ]) {
    const [, ok, detail] = typeLine(entries);
    check(label, !ok && detail.includes(want), detail);
  }

  const PATH_LINE = "every entry is a path the app will unpack";
  const pathLine = (entries) => layoutFindings(pack(entries)).find(([l]) => l === PATH_LINE);
  for (const [label, entries, want] of [
    [
      "a leading ./ is refused here, though the app has dropped it since v0.10.38",
      [{ name: "./", type: "5" }, { name: "./index.html", body: "h" }],
      "starts with ./",
    ],
    ["a .. is refused", [...plain, { name: "../evil.txt", body: "x" }], "contains .."],
    ["an absolute path is refused", [...plain, { name: "/etc/evil.txt", body: "x" }], "absolute"],
  ]) {
    const [, ok, detail] = pathLine(entries);
    check(label, !ok && detail.includes(want), detail);
  }

  // A size that cannot be read used to stall the reader (negative) or end it
  // early and pass what it had (not a number).
  for (const [label, rawSize] of [
    ["a negative size in a header fails the layout check, it does not stall", "-0001000\0\0\0\0"],
    ["a size that is not a number fails the layout check", "zzzzzzzzzzzz"],
  ]) {
    const [first] = layoutFindings(pack([{ name: "index.html", rawSize }]));
    check(label, first[0] === "the bundle is a tar.gz" && !first[1], first[2]);
  }

  console.log("\nversions, as the semver crate reads them (after dropping leading v)");
  for (const [v, want] of [
    ["0.11.0", true],
    ["v0.11.0", true],
    ["vv0.11.0", true],
    ["0.11.0-rc.1+build.5", true],
    ["0.11", false],
    ["0.11.0.1", false],
    ["0.11.00", false],
    ["V0.11.0", false],
    [" 0.11.0", false],
    ["18446744073709551616.0.0", false],
    ["", false],
    [null, false],
  ])
    check(`${JSON.stringify(v)} is ${want ? "accepted" : "refused"}`, versionOk(v) === want);

  console.log("\npub_date, as time's Rfc3339 reads it");
  for (const [d, want] of [
    ["2026-10-03T02:41:22Z", true],
    ["2026-10-03T02:41:22.5+01:00", true],
    ["2026-10-03t02:41:22z", true],
    ["2026-10-03 02:41:22Z", true],
    ["2026-06-30T23:59:60Z", true],
    ["2026-06-24", false],
    ["2026-06-24T00:00:00", false],
    ["2026-06-24T00:00:00+0100", false],
    ["2026-02-30T00:00:00Z", false],
    ["2026-10-03T24:00:00Z", false],
    ["2026-10-03T02:41:60Z", false],
    ["June 24, 2026", false],
  ])
    check(`${JSON.stringify(d)} is ${want ? "accepted" : "refused"}`, (rfc3339Problem(d) === null) === want);
  done();
}

// ---------------------------------------------------------------- file mode

const isBundle = (name) => name.endsWith(".tar.gz");

if (!a.endsWith(".json")) {
  // A frontend bundle on its own: the layout check, straight after packing
  // and before anything is signed (RELEASING.md, hot channel step 2).
  if (!b && isBundle(a)) {
    console.log(`\nchecking ${basename(a)}'s layout only (no .sig given)`);
    checkLayout(readFileSync(a), true);
    done();
  }
  if (!b) {
    console.error("usage: node scripts/verify-release.mjs <file> <file.sig>");
    process.exit(2);
  }
  console.log(`\nverifying ${basename(a)}`);
  const sig = parseSig(readFileSync(b, "utf8"));
  if (!sig) {
    fail("the .sig is a minisign signature", "malformed");
    done();
  }
  checkSig(sig, basename(a));
  const bytes = readFileSync(a);
  check("signature over the file's bytes", bytesOk(bytes, sig));
  if (isBundle(a)) checkLayout(bytes, true);
  done();
}

// ------------------------------------------------------------ manifest mode

const manifest = JSON.parse(readFileSync(a, "utf8"));

/**
 * latest.json carries one entry per platform; frontend.json is a single flat
 * entry with a nativeVersion gate. Normalise both to the same list so the
 * checks below don't care which one they were handed.
 */
const kind = manifest.platforms ? "latest.json" : manifest.nativeVersion ? "frontend.json" : null;
console.log(`\nverifying ${basename(a)} as ${kind ?? "an unrecognised manifest"}`);
if (!kind) {
  fail(
    "the manifest is a latest.json or a frontend.json",
    "no platforms, no nativeVersion — nothing to check",
  );
  done();
}
const entries =
  kind === "latest.json"
    ? Object.entries(manifest.platforms).map(([platform, e]) => ({ ...e, platform }))
    : [{ ...manifest, platform: "frontend" }];

check("the manifest declares a version", Boolean(manifest.version), manifest.version ?? "");
if (kind === "latest.json") {
  // What tauri-plugin-updater refuses the whole manifest for (see its rules
  // above). frontend.json is not read by the plugin, so none of these apply.
  check(
    "the version is semver, as the updater needs",
    versionOk(manifest.version),
    versionOk(manifest.version)
      ? ""
      : `${JSON.stringify(manifest.version)} is not major.minor.patch`,
  );
  const date = manifest.pub_date;
  const dateProblem =
    date === undefined || date === null
      ? null
      : typeof date !== "string"
        ? `${JSON.stringify(date)} is not a string`
        : rfc3339Problem(date);
  check(
    "pub_date is RFC 3339, as the updater parses it",
    dateProblem === null,
    dateProblem ?? (typeof date === "string" ? date : "none, which the updater accepts"),
  );
  const have = Object.keys(manifest.platforms ?? {});
  const winKey = WINDOWS_KEYS.find((k) => have.includes(k));
  check(
    "platforms has the key a Windows x64 install asks for",
    Boolean(winKey),
    winKey ?? `has ${have.join(", ") || "no platforms"}; needs ${WINDOWS_KEYS.join(" or ")}`,
  );
}
if (kind === "frontend.json") {
  // The app refuses a bundle whose nativeVersion isn't the running native
  // build, silently. A stale one here doesn't error, it just never applies.
  check(
    "nativeVersion matches tauri.conf.json",
    manifest.nativeVersion === conf.version,
    `${manifest.nativeVersion} vs ${conf.version}`,
  );
}
check("the manifest has an entry to check", entries.length > 0, `${entries.length}`);

for (const entry of entries) {
  console.log(`\n  [${entry.platform}]`);
  if (!entry.url || !entry.signature) {
    fail("the entry has a url and a signature", !entry.url ? "no url" : "no signature");
    continue;
  }
  const asset = basename(new URL(entry.url).pathname);

  const sig = parseSig(entry.signature);
  if (!sig) {
    // This is the one that shipped: a human-readable placeholder where a
    // 420-char base64 blob belongs, published without anyone looking.
    fail("the signature is a real signature", `not minisign: ${entry.signature.slice(0, 48)}...`);
    continue;
  }
  checkSig(sig, asset);
  check("the asset name carries the manifest version", asset.includes(manifest.version), asset);

  // BYTES and URL are two independent questions, and folding them together
  // is how this script came to pass the exact bug it was written for.
  // Handing it a local asset used to skip the fetch entirely, so
  // `verify-release.mjs latest.json <exe>`, the form RELEASING.md documents,
  // verified the crypto beautifully and never noticed that the
  // url 404'd. That is v0.8.163's second failure, the one the docstring
  // above claims to catch, sailing through the mode most likely to be used.
  let bytesChecked = false;

  if (b) {
    const local = readFileSync(b);
    check(
      "signature over the local asset's bytes",
      basename(b) === asset && bytesOk(local, sig),
      basename(b) === asset ? "" : `${basename(b)} is not ${asset}`,
    );
    if (kind === "frontend.json") checkLayout(local);
    bytesChecked = true;
  }

  if (offline) {
    console.log(`  ....  url not fetched (--offline)  ${entry.url}`);
    skippedUrl = true;
  } else {
    // A manifest naming an asset nobody uploaded. Always asked, whether or
    // not a local copy was handed over, because a local file proves nothing
    // about what users will actually download.
    let res;
    try {
      res = await fetch(entry.url, { redirect: "follow" });
    } catch (err) {
      fail("the url resolves", String(err.message ?? err));
      continue;
    }
    check("the url resolves", res.ok, `HTTP ${res.status}  ${entry.url}`);
    if (!res.ok) continue;
    if (!bytesChecked) {
      const bytes = Buffer.from(await res.arrayBuffer());
      check(
        "signature over the published bytes",
        bytesOk(bytes, sig),
        `${bytes.length} bytes`,
      );
      if (kind === "frontend.json") checkLayout(bytes);
      bytesChecked = true;
    }
  }

  // Nothing about this entry's bytes was checked against anything. Said as
  // a FAILURE rather than a note, because the prose version of this exited
  // 0 and any wrapper gating on the exit code read that as green.
  if (!bytesChecked) {
    fail(
      "the signature was checked against real bytes",
      "--offline with no local asset verifies nothing",
    );
  }
}

done();
