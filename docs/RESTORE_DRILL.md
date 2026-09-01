# PostgreSQL Restore Drill

This procedure restores an encrypted R2 backup into a **separate, disposable PostgreSQL
database** first. Do it every quarter and record only the date, operator, backup key and
result in the operations log. Do not record a passphrase or access key.

## Preconditions

- A recent `postgres/daily/*.dump.gpg` object exists in the dedicated backup R2 bucket.
- The backup R2 credentials can read that bucket; the application R2 credentials cannot.
- `BACKUP_ENCRYPTION_PASSPHRASE` is available through the VPS secret store.
- The production `api` and `worker` services are not pointed at the drill database.

## Safe drill

1. Create an isolated database, for example `scorm_restore_drill`, on a temporary PostgreSQL
   service or a managed-PostgreSQL clone. Never begin by restoring over production.
2. Start the repository's `backup` image with `PGDATABASE=scorm_restore_drill` and the
   disposable database connection settings. Keep its backup R2 environment variables.
3. List the selected encrypted object in R2, then run the restore script with its exact key:

   ```bash
   RESTORE_CONFIRM="RESTORE scorm_restore_drill" \
   docker compose run --rm --no-deps backup /app/ops/restore-postgres.sh \
   postgres/daily/postgres-YYYYMMDDTHHMMSSZ.dump.gpg
   ```

4. Run Alembic's current-version check and a non-sensitive row-count/query check. Start a
   one-off API container against the drill database and call `/readyz`.
5. Check that source/export objects referenced by sampled records are present in the main R2
   bucket. The backup validates database recovery; it does not replace object-storage retention.
6. Destroy the disposable database and its temporary volume. Record pass/fail and any recovery
   duration. Investigate failures before treating the backup policy as healthy.

## Production incident restore

Restoring production is destructive. Stop `api` and `worker`, take a fresh encrypted backup if
the database is still readable, select a confirmed backup key, then use the same command with
`PGDATABASE=scorm_studio` and an exact `RESTORE_CONFIRM="RESTORE scorm_studio"`. Start services
only after `/readyz` is successful. Have a second operator review the selected backup key and
the target database name before this action.
