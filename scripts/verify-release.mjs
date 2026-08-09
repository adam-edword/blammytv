/**
 * Verify a Tauri updater signature, or a whole update manifest, before it ships.
 *
 * RELEASING.md: "the sig math can be checked against the uploaded exe before
 * shipping the manifest (blake2b-512 of the file, Ed25519 against tauri.conf's
 * pubkey)". This is that check, offline and in one command.
 *
 *   node scripts/verify-release.mjs <file> <file.sig>
 *   node scripts/verify-release.mjs <manifest.json> [asset-file] [--offline]
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
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createHash, createPublicKey, verify } from "node:crypto";

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

// ---------------------------------------------------------------- file mode

if (!a.endsWith(".json")) {
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
  check("signature over the file's bytes", bytesOk(readFileSync(a), sig));
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
    check(
      "signature over the local asset's bytes",
      basename(b) === asset && bytesOk(readFileSync(b), sig),
      basename(b) === asset ? "" : `${basename(b)} is not ${asset}`,
    );
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
