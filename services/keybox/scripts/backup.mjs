#!/usr/bin/env node
// keybox backup (container-native): better-sqlite3 .backup() + 30-day prune.
//
// The Docker image is node:22-bookworm-slim, which has no `sqlite3` CLI —
// scripts/backup.sh's `sqlite3 "$DB_PATH" ".backup ..."` line simply isn't
// runnable in the container. Rather than apt-installing sqlite3 into the
// runtime image just for backups, this reuses the better-sqlite3 dependency
// that's already installed for the server itself: it exposes the same
// online-backup API (safe to run against a live WAL-mode db, same as the
// sqlite3 CLI's .backup) via `db.backup(destPath)`.
//
// The key DB is the ONLY record of which keys exist (Stripe's dashboard is
// the purchase<->person record, but has no idea what key a webhook
// generated) — see scripts/backup.sh's header for the full rationale.
//
// Usage: node scripts/backup.mjs
// Env:   DB_PATH (default /data/keybox.db), BACKUP_DIR (default /data/backups)
//
// Coolify: wire this up as a Scheduled Task (`node scripts/backup.mjs`),
// daily, against the running container. See README.md's Coolify section —
// local backups on the same /data volume don't survive a dead disk, so
// /data/backups still needs to be copied off the box periodically.
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

const DB_PATH = process.env.DB_PATH || "/data/keybox.db";
const BACKUP_DIR = process.env.BACKUP_DIR || "/data/backups";
const RETENTION_DAYS = 30;

function isoDate() {
  // Sortable-by-filename, second-resolution UTC timestamp: 2026-07-12T031700Z
  return new Date().toISOString().replace(/[:.]/g, "").replace(/\.\d+Z$/, "Z");
}

async function main() {
  if (!existsSync(DB_PATH)) {
    console.error(`keybox backup: no db at ${DB_PATH}, nothing to back up`);
    process.exit(1);
  }

  // db.backup() requires the destination directory to already exist (it
  // checks before it starts copying pages), so this has to run before the
  // backup call, not after.
  mkdirSync(BACKUP_DIR, { recursive: true });

  const dest = path.join(BACKUP_DIR, `keybox-${isoDate()}.db`);

  // Open read-only: a backup job has no business writing to the live db,
  // and read-only keeps this safe to run concurrently with the server
  // process without lock contention.
  const db = new Database(DB_PATH, { readonly: true });
  try {
    // better-sqlite3's .backup() is async (it steps the SQLite online-backup
    // API across multiple ticks) — must be awaited or the process can exit
    // mid-copy with a truncated file.
    await db.backup(dest);
  } finally {
    db.close();
  }

  console.log(`keybox backup: wrote ${dest}`);

  pruneOldBackups();
}

function pruneOldBackups() {
  const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const entries = readdirSync(BACKUP_DIR).filter(
    (name) => name.startsWith("keybox-") && name.endsWith(".db"),
  );
  for (const name of entries) {
    const full = path.join(BACKUP_DIR, name);
    const { mtimeMs } = statSync(full);
    if (mtimeMs < cutoffMs) {
      unlinkSync(full);
    }
  }
}

main().catch((err) => {
  console.error("keybox backup: failed", err);
  process.exit(1);
});
