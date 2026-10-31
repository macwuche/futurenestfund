#!/usr/bin/env bash
# Nightly backup of GrantApp's data (docs/DEPLOY.md step 9). Run as root from cron.
# Saves the app's tables (schema public) and the uploaded files to /var/backups/futurenestfund; keeps 14 days.
# Sign-in accounts live in Supabase's auth schema and are covered by Supabase's own backups, not this script.
set -euo pipefail
DEST=/var/backups/futurenestfund
STAMP=$(date -u +%Y%m%d-%H%M)
umask 077
mkdir -p "$DEST"
set -a; . /etc/futurenestfund/migrate.env; set +a
PGSSLMODE=require pg_dump "$SUPABASE_ADMIN_DB_URL" --format=custom --no-owner --no-privileges --schema=public --file="$DEST/db-$STAMP.dump"
tar -C /var/lib/futurenestfund -czf "$DEST/uploads-$STAMP.tar.gz" uploads
find "$DEST" -type f -mtime +14 -delete
echo "$STAMP ok, $(du -sh "$DEST" | cut -f1) in $DEST"
