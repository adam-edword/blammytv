/**
 * Verify a Tauri updater signature against the file it claims to sign.
 *
 * RELEASING.md: "the sig math can be checked against the uploaded exe before
 * shipping the manifest (blake2b-512 of the file, Ed25519 against tauri.conf's
 * pubkey)". This is that check, offline and in one command.
 *
 *   node scripts/verify-release.mjs <file> <file.sig>
 *
 * Checks, in order, and says which one failed:
 *   1. the .sig's key id matches the pubkey compiled into the app
 *   2. minisign's global signature, so the trusted comment is authentic
 *   3. the trusted comment names THIS file (never pair an exe with another
 *      build's .sig — every build mints a new pair)
 *   4. Ed25519 over blake2b-512 of the file's bytes
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createHash, createPublicKey, verify } from "node:crypto";

const [file, sigFile] = process.argv.slice(2);
if (!file || !sigFile) {
  console.error("usage: node scripts/verify-release.mjs <file> <file.sig>");
  process.exit(2);
}

const conf = JSON.parse(
  readFileSync(new URL("../apps/app/src-tauri/tauri.conf.json", import.meta.url)),
);
const pubFile = Buffer.from(conf.plugins.updater.pubkey, "base64").toString();
const pubLine = pubFile.split("\n").find((l) => l && !l.startsWith("untrusted"));
const pubBlob = Buffer.from(pubLine, "base64");
const rawPub = pubBlob.subarray(10);

// The .sig is itself base64 of a minisign file.
const sigText = Buffer.from(readFileSync(sigFile, "utf8"), "base64").toString();
const [, sigB64, commentLine, globalB64] = sigText.split("\n");
const sigBlob = Buffer.from(sigB64, "base64");
const trusted = commentLine.replace(/^trusted comment: /, "");

const id = (b) => Buffer.from(b.subarray(2, 10)).reverse().toString("hex").toUpperCase();
const key = createPublicKey({
  key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), rawPub]),
  format: "der",
  type: "spki",
});

let bad = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) bad++;
};

console.log(`\nverifying ${basename(file)}`);
check("key id matches tauri.conf.json", id(sigBlob) === id(pubBlob), id(sigBlob));
check(
  "trusted comment is authentic",
  verify(null, Buffer.concat([sigBlob.subarray(10), Buffer.from(trusted)]), key,
    Buffer.from(globalB64, "base64")),
);
const named = /file:(.+)$/.exec(trusted)?.[1];
check("the .sig names this file", named === basename(file), named);
const digest = createHash("blake2b512").update(readFileSync(file)).digest();
check("signature over the file's bytes", verify(null, digest, key, sigBlob.subarray(10)));

console.log(bad ? `\n${bad} check(s) FAILED — do not publish\n` : "\nall checks passed\n");
process.exit(bad ? 1 : 0);
