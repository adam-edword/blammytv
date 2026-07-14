#!/usr/bin/env node
// keybox admin CLI (container-native): see, mint, and revoke keys.
//
// The key DB (/data/keybox.db) is the ONLY record of which keys exist, and
// the node:22-bookworm-slim image has no `sqlite3` CLI and Coolify has no DB
// viewer — so without this, the keys are invisible. This reuses the
// better-sqlite3 dep the server already ships (same trick as backup.mjs).
//
// Usage (run inside the container — Coolify's Terminal, or `docker exec`):
//   node scripts/admin.mjs list                 # every key + its activations
//   node scripts/admin.mjs mint                 # mint an unlimited admin/comp
//                                               # key (pass = unlocks ALL themes)
//   node scripts/admin.mjs revoke BTV-XXXX-...   # delete a key everywhere
//
// Env: DB_PATH (default /data/keybox.db) — the same var the server uses.
//
// SECURITY: `mint` produces a free master-unlock that bypasses Stripe. It is
// unguessable (crypto-random) but grants every theme on unlimited machines to
// anyone who holds it — keep it private, and `revoke` it if it ever leaks.
import { openDb, createKey, listKeys, deleteKey, ACTIVATION_LIMIT } from "../src/db.js";

const DB_PATH = process.env.DB_PATH || "/data/keybox.db";

const USAGE = `keybox admin CLI

  node scripts/admin.mjs list                 list every key + activation count
  node scripts/admin.mjs mint                 mint an unlimited admin key (pass)
  node scripts/admin.mjs revoke <KEY>         delete a key and its activations

Env: DB_PATH (default /data/keybox.db)`;

function fmtDate(ms) {
  if (!ms) return "—";
  // Second-resolution UTC, sortable and compact: 2026-07-14 03:17:00Z
  return new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function entitlement(k) {
  return k.kind === "pass" ? "ALL (pass)" : k.themes.join(", ") || "(none)";
}

function list(db) {
  const keys = listKeys(db);
  if (keys.length === 0) {
    console.log("No keys yet.");
    return;
  }
  console.log(`${keys.length} key${keys.length === 1 ? "" : "s"}:\n`);
  for (const k of keys) {
    const cap = k.unlimited ? "∞" : String(ACTIVATION_LIMIT);
    const flags = [
      k.unlimited ? "UNLIMITED" : null,
      k.stripeSession ? "stripe" : "manual",
      k.emailedAt ? "emailed" : null,
    ]
      .filter(Boolean)
      .join(" · ");
    console.log(`  ${k.key}`);
    console.log(`      entitles : ${entitlement(k)}`);
    console.log(`      machines : ${k.activationCount}/${cap}`);
    console.log(`      created  : ${fmtDate(k.createdAt)}   [${flags}]`);
    console.log("");
  }
}

function mint(db) {
  const record = createKey(db, { kind: "pass", unlimited: true, session: null });
  console.log("Minted an UNLIMITED admin key (pass — unlocks every theme):\n");
  console.log(`    ${record.key}\n`);
  console.log("Save it somewhere private. It bypasses Stripe and activates on");
  console.log("unlimited machines. Revoke with:");
  console.log(`    node scripts/admin.mjs revoke ${record.key}`);
}

function revoke(db, key) {
  if (!key) {
    console.error("revoke: missing key argument\n\n" + USAGE);
    process.exit(1);
  }
  const gone = deleteKey(db, key);
  if (gone) {
    console.log(`Revoked ${key} (key + all its activations deleted).`);
  } else {
    console.log(`No key found matching ${key} — nothing revoked.`);
  }
}

function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(USAGE);
    process.exit(cmd ? 0 : 1);
  }

  const db = openDb(DB_PATH);
  try {
    switch (cmd) {
      case "list":
        list(db);
        break;
      case "mint":
        mint(db);
        break;
      case "revoke":
        revoke(db, arg);
        break;
      default:
        console.error(`Unknown command: ${cmd}\n\n${USAGE}`);
        process.exit(1);
    }
  } finally {
    db.close();
  }
}

main();
