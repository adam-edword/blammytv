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
//   node scripts/admin.mjs email a@b.com        # every key bought by that email
//
// Env: DB_PATH (default /data/keybox.db) — the same var the server uses.
// STRIPE_API_KEY (also the server's) enables the buyer-email column: the DB
// is PII-free by design (no email column — see db.js), so `list` and `email`
// resolve each key's buyer through its stored Stripe Checkout session id,
// live from Stripe, at lookup time. Nothing is ever written back.
//
// SECURITY: `mint` produces a free master-unlock that bypasses Stripe. It is
// unguessable (crypto-random) but grants every theme on unlimited machines to
// anyone who holds it — keep it private, and `revoke` it if it ever leaks.
import Stripe from "stripe";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { openDb, createKey, listKeys, deleteKey, ACTIVATION_LIMIT } from "../src/db.js";

const DB_PATH = process.env.DB_PATH || "/data/keybox.db";

const USAGE = `keybox admin CLI

  node scripts/admin.mjs list                 list every key + activation count
  node scripts/admin.mjs mint                 mint an unlimited admin key (pass)
  node scripts/admin.mjs revoke <KEY>         delete a key and its activations
  node scripts/admin.mjs email <ADDRESS>      list every key bought by that email

Env: DB_PATH (default /data/keybox.db)
     STRIPE_API_KEY (buyer-email lookup for list/email; set for the server already)`;

function fmtDate(ms) {
  if (!ms) return "—";
  // Second-resolution UTC, sortable and compact: 2026-07-14 03:17:00Z
  return new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function entitlement(k) {
  return k.kind === "pass" ? "ALL (pass)" : k.themes.join(", ") || "(none)";
}

/**
 * Buyer emails, resolved live from Stripe by each key's stored Checkout
 * session id — the DB itself stores no email anywhere (PII-free by design,
 * see db.js). Returns Map<sessionId, email|null>: null means Stripe has no
 * email on that session; a session missing from the map means the lookup
 * itself failed. Duplicate session ids are fetched once; batches keep the
 * request fan-out polite.
 */
export async function resolveEmails(stripe, keys, { concurrency = 10 } = {}) {
  const sessions = [...new Set(keys.map((k) => k.stripeSession).filter(Boolean))];
  const emails = new Map();
  for (let i = 0; i < sessions.length; i += concurrency) {
    await Promise.all(
      sessions.slice(i, i + concurrency).map(async (id) => {
        try {
          const s = await stripe.checkout.sessions.retrieve(id);
          emails.set(id, s.customer_details?.email ?? s.customer_email ?? null);
        } catch (err) {
          console.error(`  (warn) Stripe lookup failed for session ${id}: ${err.message}`);
        }
      }),
    );
  }
  return emails;
}

/** Keys whose buyer email matches `email` (case-insensitive). */
export function keysForEmail(keys, emails, email) {
  const want = email.trim().toLowerCase();
  return keys.filter((k) => {
    const got = k.stripeSession ? emails.get(k.stripeSession) : null;
    return typeof got === "string" && got.toLowerCase() === want;
  });
}

function buyerEmail(k, stripe, emails) {
  if (!k.stripeSession) return "— (manual key, no buyer)";
  if (!stripe) return "(unknown — STRIPE_API_KEY not set)";
  if (!emails.has(k.stripeSession)) return "(Stripe lookup failed)";
  return emails.get(k.stripeSession) ?? "— (no email on Stripe session)";
}

function printKey(k, email) {
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
  console.log(`      email    : ${email}`);
  console.log("");
}

async function list(db, stripe) {
  const keys = listKeys(db);
  if (keys.length === 0) {
    console.log("No keys yet.");
    return;
  }
  const emails = stripe ? await resolveEmails(stripe, keys) : new Map();
  console.log(`${keys.length} key${keys.length === 1 ? "" : "s"}:\n`);
  for (const k of keys) {
    printKey(k, buyerEmail(k, stripe, emails));
  }
}

async function emailCmd(db, stripe, address) {
  if (!address) {
    console.error("email: missing address argument\n\n" + USAGE);
    process.exit(1);
  }
  if (!stripe) {
    console.error(
      "email: STRIPE_API_KEY is not set. Buyer emails live only in Stripe (the\n" +
        "DB is PII-free), so this command needs the server's Stripe key — run it\n" +
        "inside the container, where STRIPE_API_KEY is already in the env.",
    );
    process.exit(1);
  }
  const keys = listKeys(db);
  const emails = await resolveEmails(stripe, keys);
  const matches = keysForEmail(keys, emails, address);
  if (matches.length === 0) {
    console.log(`No keys found for ${address}.`);
    return;
  }
  console.log(`${matches.length} key${matches.length === 1 ? "" : "s"} for ${address}:\n`);
  for (const k of matches) {
    printKey(k, buyerEmail(k, stripe, emails));
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

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(USAGE);
    process.exit(cmd ? 0 : 1);
  }

  // Same env var the server boots with; absent (local dev outside the
  // container) the CLI still works, just without the buyer-email column.
  const stripe = process.env.STRIPE_API_KEY ? new Stripe(process.env.STRIPE_API_KEY) : null;

  const db = openDb(DB_PATH);
  try {
    switch (cmd) {
      case "list":
        await list(db, stripe);
        break;
      case "mint":
        mint(db);
        break;
      case "revoke":
        revoke(db, arg);
        break;
      case "email":
        await emailCmd(db, stripe, arg);
        break;
      default:
        console.error(`Unknown command: ${cmd}\n\n${USAGE}`);
        process.exit(1);
    }
  } finally {
    db.close();
  }
}

// Guarded like server.js so tests can import resolveEmails/keysForEmail
// without the CLI running (and opening /data/keybox.db) as a side effect.
const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
