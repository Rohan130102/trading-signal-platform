#!/bin/sh
# Restores into an EMPTY database, then verifies the tamper-evident chain over the signal history.
#   DATABASE_URL=... BACKUP_PASSPHRASE_FILE=/path/to/passphrase ./deploy/restore.sh <file.dump.enc>
set -eu
FILE="${1:?Usage: restore.sh <file.dump.enc>}"
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_PASSPHRASE_FILE:?BACKUP_PASSPHRASE_FILE is required}"
TABLES="$(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
if [ "$TABLES" != "0" ]; then
  echo "Refusing to restore: this database is not empty ($TABLES tables)." >&2
  exit 1
fi
openssl dgst -sha256 -r "$FILE" >/dev/null
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$BACKUP_PASSPHRASE_FILE" -in "$FILE" \
  | pg_restore --no-owner --no-privileges --exit-on-error --dbname "$DATABASE_URL"
psql "$DATABASE_URL" -c "ALTER DATABASE \"$(psql "$DATABASE_URL" -Atc 'SELECT current_database()')\" SET timezone TO 'UTC'"
psql "$DATABASE_URL" -c "SELECT checked, first_bad_seq, CASE WHEN first_bad_seq IS NULL THEN 'chain intact' ELSE 'TAMPERING OR CORRUPTION' END AS result FROM verify_signal_event_chain()"
