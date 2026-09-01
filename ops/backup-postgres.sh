#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE is required}"

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump_file="$work_dir/postgres-${timestamp}.dump"
encrypted_file="${dump_file}.gpg"
object_key="postgres/daily/postgres-${timestamp}.dump.gpg"

echo "Creating PostgreSQL backup at ${timestamp}"
pg_dump --format=custom --no-owner --no-privileges --file="$dump_file"
gpg --batch --yes --symmetric --cipher-algo AES256 --pinentry-mode loopback \
  --passphrase-fd 3 --output "$encrypted_file" "$dump_file" 3<<<"$BACKUP_ENCRYPTION_PASSPHRASE"
python /app/ops/r2_backup.py upload "$encrypted_file" "$object_key"
python /app/ops/r2_backup.py prune
echo "Encrypted backup uploaded: ${object_key}"
