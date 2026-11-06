#!/bin/sh
# Encrypted logical backup. Schedule it, copy the result off this host, and rehearse restore.sh.
#   DATABASE_URL=... BACKUP_PASSPHRASE_FILE=/path/to/passphrase ./deploy/backup.sh /path/to/backups
# The database holds personal data and financial records, so backups are never stored unencrypted.
set -eu
TARGET_DIR="${1:?Usage: backup.sh <directory>}"
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_PASSPHRASE_FILE:?BACKUP_PASSPHRASE_FILE is required}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$TARGET_DIR/signaldesk-$STAMP.dump.enc"
umask 077
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$BACKUP_PASSPHRASE_FILE" -out "$FILE"
openssl dgst -sha256 "$FILE" > "$FILE.sha256"
echo "Backup written: $FILE"
