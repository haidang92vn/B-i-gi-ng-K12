#!/usr/bin/env bash
set -euo pipefail

backup_key="${1:?Usage: restore-postgres.sh postgres/daily/postgres-...dump.gpg}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE is required}"

if [ "${RESTORE_CONFIRM:-}" != "RESTORE ${PGDATABASE}" ]; then
  echo "Refusing destructive restore. Set RESTORE_CONFIRM='RESTORE ${PGDATABASE}' after reading docs/RESTORE_DRILL.md." >&2
  exit 2
fi

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
encrypted_file="$work_dir/backup.dump.gpg"
dump_file="$work_dir/backup.dump"

python /app/ops/r2_backup.py download "$backup_key" "$encrypted_file"
gpg --batch --yes --decrypt --pinentry-mode loopback --passphrase-fd 3 \
  --output "$dump_file" "$encrypted_file" 3<<<"$BACKUP_ENCRYPTION_PASSPHRASE"
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$PGDATABASE" "$dump_file"
echo "Restore completed for ${PGDATABASE}"
