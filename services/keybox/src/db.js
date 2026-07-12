import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { generateKey } from "./keygen.js";

/**
 * keybox's entire persistence layer. PII-free by construction: the schema
 * has no name/email/address column anywhere. `keys.stripe_session` is a
 * Stripe Checkout Session id, not a buyer identifier — it exists purely for
 * webhook idempotency (replay-safe createKey) and the success-page lookup.
 *
 * `keys.themes` is a JSON array of theme ids, stored as TEXT because
 * better-sqlite3/SQLite has no native array type. Empty array for a 'pass'
 * key (a pass carries no per-theme list; entitlement is "all of them").
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS keys (
  key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('pass','themes')),
  themes TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  stripe_session TEXT UNIQUE,
  emailed_at INTEGER
);

CREATE TABLE IF NOT EXISTS activations (
  key TEXT NOT NULL,
  machine TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  PRIMARY KEY(key, machine)
);
`;

export const ACTIVATION_LIMIT = 3;

export function openDb(path) {
  // A fresh container's /data volume mount is an empty directory the first
  // time it's ever attached — nothing has created it yet. better-sqlite3
  // will happily create the .db file itself, but not a missing parent
  // directory, so without this the very first boot against a brand-new
  // volume crashes. ":memory:" (tests) and bare filenames (no directory
  // component) both no-op here — mkdirSync("", ...) would throw, so guard it.
  const dir = dirname(path);
  if (path !== ":memory:" && dir && dir !== ".") {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);

  // CREATE TABLE IF NOT EXISTS never alters an existing table, so adding
  // emailed_at to SCHEMA above only takes effect on a brand-new database.
  // The live production DB already has a `keys` table without that column —
  // this runtime migration is what actually adds it there. Guarded by
  // table_info so it's a no-op (and safe to run on every boot) once the
  // column exists, whether it got there via this ALTER or via CREATE TABLE
  // on a fresh db.
  const columns = db.prepare("PRAGMA table_info(keys)").all();
  if (!columns.some((c) => c.name === "emailed_at")) {
    db.exec("ALTER TABLE keys ADD COLUMN emailed_at INTEGER");
  }

  return db;
}

/**
 * Create a key for a completed Checkout session. Idempotent on session id:
 * a webhook replay for the same session returns the already-issued key
 * instead of minting a second one. Retries key generation on the (astronomically
 * unlikely) chance of a PK collision.
 */
export function createKey(db, { kind, themes = [], session }) {
  if (session) {
    const existing = findBySession(db, session);
    if (existing) return existing;
  }

  const insert = db.prepare(
    `INSERT INTO keys (key, kind, themes, created_at, stripe_session)
     VALUES (?, ?, ?, ?, ?)`,
  );

  const themesJson = JSON.stringify(themes);
  const createdAt = Date.now();

  for (let attempt = 0; attempt < 10; attempt++) {
    const key = generateKey();
    try {
      insert.run(key, kind, themesJson, createdAt, session ?? null);
      return getKey(db, key);
    } catch (err) {
      // PK collision on `key` — regenerate and retry. A UNIQUE collision on
      // `stripe_session` means a concurrent webhook replay won the race;
      // fall back to reading what it wrote.
      if (isUniqueViolation(err, "keys.key")) continue;
      if (isUniqueViolation(err, "keys.stripe_session")) {
        const winner = session ? findBySession(db, session) : null;
        if (winner) return winner;
      }
      throw err;
    }
  }
  throw new Error("keybox: exhausted key-generation retries");
}

function isUniqueViolation(err, column) {
  return (
    err?.code === "SQLITE_CONSTRAINT_UNIQUE" ||
    err?.code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
    (typeof err?.message === "string" &&
      err.message.includes("UNIQUE constraint failed") &&
      (!column || err.message.includes(column)))
  );
}

export function findBySession(db, session) {
  const row = db
    .prepare(`SELECT * FROM keys WHERE stripe_session = ?`)
    .get(session);
  return row ? rowToKey(row) : null;
}

export function getKey(db, key) {
  const row = db.prepare(`SELECT * FROM keys WHERE key = ?`).get(key);
  return row ? rowToKey(row) : null;
}

function rowToKey(row) {
  return {
    key: row.key,
    kind: row.kind,
    themes: JSON.parse(row.themes),
    createdAt: row.created_at,
    stripeSession: row.stripe_session,
    emailedAt: row.emailed_at,
  };
}

/**
 * Mark a key as having had its delivery email sent (or attempted-and-given-
 * up-on — callers only call this on success). Separate from createKey
 * because the email send happens after the key already exists and must
 * never block or fail key creation itself.
 */
export function markEmailed(db, key) {
  db.prepare(`UPDATE keys SET emailed_at = ? WHERE key = ?`).run(Date.now(), key);
}

export function activationCount(db, key) {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM activations WHERE key = ?`)
    .get(key);
  return row.n;
}

/**
 * Register (key, machine) as activated. Idempotent: re-touching an already-
 * registered machine always succeeds and never counts against the cap.
 * A brand-new machine that would push the count past ACTIVATION_LIMIT is
 * rejected with {limit:true} instead of being written.
 */
export function touchActivation(db, key, machine) {
  const already = db
    .prepare(`SELECT 1 FROM activations WHERE key = ? AND machine = ?`)
    .get(key, machine);
  if (already) return { ok: true };

  if (activationCount(db, key) >= ACTIVATION_LIMIT) {
    return { limit: true };
  }

  db.prepare(
    `INSERT INTO activations (key, machine, first_seen) VALUES (?, ?, ?)`,
  ).run(key, machine, Date.now());
  return { ok: true };
}

export function isActivated(db, key, machine) {
  const row = db
    .prepare(`SELECT 1 FROM activations WHERE key = ? AND machine = ?`)
    .get(key, machine);
  return Boolean(row);
}
