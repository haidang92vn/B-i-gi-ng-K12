#!/usr/bin/env bash
set -euo pipefail

interval="${BACKUP_INTERVAL_SECONDS:-86400}"
case "$interval" in
  ''|*[!0-9]*) echo "BACKUP_INTERVAL_SECONDS must be a positive integer" >&2; exit 2 ;;
esac
if [ "$interval" -lt 3600 ]; then
  echo "BACKUP_INTERVAL_SECONDS must be at least 3600" >&2
  exit 2
fi

while true; do
  /app/ops/backup-postgres.sh || echo "Backup failed; it will retry after ${interval}s" >&2
  sleep "$interval"
done
