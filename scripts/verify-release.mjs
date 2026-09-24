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
 *
 * A FRONTEND BUNDLE (.tar.gz) also gets its LAYOUT checked, in every mode
 * that has its bytes, and on its own with no .sig straight after packing:
 * each entry must be a path `frontend.rs` will unpack (it refuses a leading
 * `./`, which `tar -C dist .` writes), `index.html` must be at the root, and,
 * where the archive was just packed from it, nothing in apps/app/dist may be
 * missing. RELEASING.md told you to pack `.` from 0.7 until v0.9.82: every
 * installed copy would have refused the first frontend-only release.
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
 * and that the url actually resolves. v0.8.163 shipped a frontend.json whose
 * signature read "PASTE THE FULL CONTENTS OF ..." and whose url 404'd; file
 * mode could not have caught either, because neither is about the crypto.
 * Pass a local asset file to additionally verify the bytes offline; without
 * one the url is fetched and verified, unless --offline says not to.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, createPublicKey, verify } from "node:crypto";
import { gunzipSync } from "node:zlib";

const argv = process.argv.slice(2);
const offline = argv.includes("--offline");
const [a, b] = argv.filter((x) => !x.startsWith("--"));
if (!a) {
  console.error("usage: node scripts/verify-release.mjs <file> <file.sig>");
  console.error("       node scripts/verify-release.mjs <manifest.json> [asset] [--offline]");
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
 * The entry paths of a .tar.gz, read the way the tar crate hands them to
 * `frontend.rs`: raw bytes, a GNU long name (`L`) or a pax `path=` record
 * overriding the header's own name, the ustar prefix joined on.
 */
function tarPaths(gz) {
  const buf = gunzipSync(gz);
  const paths = [];
  const str = (b) => b.toString("utf8").replace(/\0.*$/s, "");
  let next = null;
  for (let off = 0; off + 512 <= buf.length; ) {
    const h = buf.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    const size = parseInt(str(h.subarray(124, 136)).trim() || "0", 8);
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
    if (type === "g") continue;
    const prefix = str(h.subarray(345, 500));
    const name = str(h.subarray(0, 100));
    paths.push(next ?? (prefix ? `${prefix}/${name}` : name));
    next = null;
  }
  return paths;
}

/**
 * The rule `frontend.rs`'s `unpack` enforces, and has since 0.9.0: every
 * component of every entry must be a plain name. Rust's `Path::components`
 * folds away a "." in the MIDDLE of a path but keeps one at the start, so
 * `./index.html` is `[CurDir, Normal]` and is refused, and so is the bare
 * `./` that `tar -C dist .` writes first. That is exactly what RELEASING.md
 * used to tell you to run: an archive every installed copy rejects.
 */
function refusedPath(p) {
  if (/^[\\/]/.test(p)) return "absolute";
  const parts = p.split(/[\\/]/);
  if (/^[A-Za-z]:/.test(parts[0])) return "drive prefix";
  if (parts[0] === ".") return "starts with ./";
  if (parts.includes("..")) return "contains ..";
  return null;
}

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
function checkLayout(gz, withDist = false) {
  let paths;
  try {
    paths = tarPaths(gz);
  } catch (err) {
    fail("the bundle is a tar.gz", String(err.message ?? err));
    return;
  }
  if (withDist && existsSync(DIST)) {
    const packed = new Set(paths.map((p) => p.replace(/^\.\//, "")));
    const missing = filesUnder(DIST).filter((f) => !packed.has(f));
    check(
      "the bundle carries every file in apps/app/dist",
      missing.length === 0,
      missing.length ? `missing: ${missing.slice(0, 3).join(", ")}` : "",
    );
  }
  const refused = paths
    .map((p) => [p, refusedPath(p)])
    .filter(([, why]) => why);
  check(
    "every entry is a path the app will unpack",
    refused.length === 0,
    refused.length
      ? `${refused.length} refused, first: "${refused[0][0]}" (${refused[0][1]})`
      : `${paths.length} entries`,
  );
  check(
    "index.html sits at the archive root",
    paths.includes("index.html"),
    paths.includes("index.html") ? "" : "the app serves nothing without it",
  );
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
