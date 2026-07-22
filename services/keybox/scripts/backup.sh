#!/usr/bin/env bash
# keybox backup (bare-metal): nightly sqlite3 .backup + 30-day local prune.
#
# Running keybox in the container? Use scripts/backup.mjs instead — the
# node:22-bookworm-slim runtime image has no `sqlite3` CLI, so this script
# won't run there. backup.mjs does the same job (online .backup + 30-day
# prune) with the better-sqlite3 dependency already installed for the
# server itself. This script is for the bare-metal/systemd deploy path
# only — see README.md.
#
# The key DB is the ONLY record of which keys exist (Stripe's dashboard is
# the purchase<->person record, but it has no idea what key a webhook
# generated). A dead disk on the Oracle box must not orphan every key
# that's ever been sold — this script is the "don't lose the box" story.
#
# Cron (nightly at 03:17, off the hour to avoid pile-ups):
#   17 3 * * * /path/to/services/keybox/scripts/backup.sh >> /var/log/keybox-backup.log 2>&1
#
# Usage: backup.sh [db_path] [backup_dir]
set -euo pipefail

DB_PATH="${1:-${DB_PATH:-./keybox.db}}"
BACKUP_DIR="${2:-${BACKUP_DIR:-./backups}}"
RETENTION_DAYS=30

if [[ ! -f "$DB_PATH" ]]; then
  echo "keybox backup: no db at $DB_PATH, nothing to back up" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_DIR/keybox-$TIMESTAMP.db"

# sqlite3 .backup is safe to run against a live WAL-mode db (it's the
# consistent-snapshot mechanism, not a raw file copy).
sqlite3 "$DB_PATH" ".backup '$DEST'"
echo "keybox backup: wrote $DEST"

# Prune local backups older than RETENTION_DAYS. Local retention is a
# convenience buffer, not the durability story — see the off-box line below.
find "$BACKUP_DIR" -maxdepth 1 -name 'keybox-*.db' -type f -mtime +"$RETENTION_DAYS" -print -delete

# --- Off-box copy (REQUIRED for real durability; local backups alone don't
# survive a dead disk). Uncomment and configure ONE of these once rclone or
# an SCP target is set up:
#
# rclone copy "$DEST" remote:blammytv-keybox-backups/
#
# scp "$DEST" backup-host:/srv/keybox-backups/
