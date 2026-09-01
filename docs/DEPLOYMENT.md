# Production deployment (VPS + R2)

The repository now includes a Compose stack for an Ubuntu 22.04+ VPS in Singapore:
`Caddy → FastAPI web/API + worker → PostgreSQL/Redis`, with Cloudflare R2 for all source files,
SCORM exports and encrypted database backups. The current UI is served by FastAPI. A real Next.js
frontend is still a later product refactor, so this configuration deliberately does not pretend a
non-existent Next.js app is deployable.

## Before first deploy

1. Point `APP_DOMAIN` to the VPS public IP in Cloudflare DNS. Permit inbound TCP 80 and 443;
   do not expose PostgreSQL or Redis.
2. Install Docker Engine and the Compose plugin, clone the trusted release, then copy
   `.env.example` to `.env`. Set `APP_ENV=production`, strong unique database/Redis/JWT secrets,
   a Fernet `CREDENTIAL_ENCRYPTION_KEY`, R2 application credentials, and a separate backup R2
   bucket with separate credentials. `chmod 600 .env` on the VPS.
3. The application storage bucket must be private. The backup bucket must only allow the backup
   credentials; do not share it with normal application credentials.
4. Validate the release locally/CI before moving it to the VPS. Never commit `.env`.

## Safe release procedure

Use a maintenance window when a migration is not backwards compatible. Back up before every
schema change, then run the migration job exactly once before starting new API/worker images:

```bash
docker compose build
docker compose --profile operations run --rm migrate
docker compose up -d --remove-orphans
docker compose ps
curl -fsS https://YOUR_DOMAIN/healthz
curl -fsS https://YOUR_DOMAIN/readyz
```

`api` never runs `create_all` in production. Alembic is therefore the only schema-change path.
Keep migrations additive/compatible until all old containers have been replaced; take an encrypted
backup first and document any required rollback procedure. The `migrate` service is an explicit
operations profile, not an automatic startup side effect.

## HTTPS, health and monitoring

Caddy obtains and renews certificates automatically after DNS and ports are correct. It is the
only container with host ports. PostgreSQL and Redis have no host-published ports; API and worker
retain outbound access only for R2 and the approved AI providers. `/healthz` is a liveness endpoint; `/readyz` additionally verifies
PostgreSQL and the configured R2 bucket. Compose health checks use `/readyz` and `pg_isready`.

For basic monitoring, configure an external monitor (Cloudflare health check, Uptime Kuma, or
equivalent) to alert on a failed `https://YOUR_DOMAIN/healthz`, and review a failed `/readyz`
immediately. Container logs are JSON and redact authorization headers, cookies, passwords, API
keys, tokens and credential-encryption values. Do not place request bodies, source material, AI
prompts or provider responses in operational logs.

## Storage and backup policy

User source files and SCORM exports are sent to R2, not a VPS bind mount. PostgreSQL uses a local
Docker volume for availability, but the `backup` service immediately creates a custom `pg_dump`,
encrypts it with GPG AES-256, uploads it to the separate R2 backup bucket, and prunes only backup
objects older than `BACKUP_RETENTION_DAYS` (minimum 7). It starts once after PostgreSQL is healthy
and repeats every `BACKUP_INTERVAL_SECONDS` (default 24 hours). Backups do not depend solely on
VPS disk.

Run `docker compose logs backup` after first deployment and after every credentials change. Set up
an alert from Docker/centralized logs for `Backup failed` or `backup_error`. Full recovery and the
required quarterly restore drill are in [RESTORE_DRILL.md](RESTORE_DRILL.md).

## Scale path

Phase 1 is this single VPS. Move PostgreSQL/Redis to managed services before adding API/worker
replicas, and keep R2 as the durable object boundary. Background job producers are not implemented
yet; the worker container currently proves Redis connectivity and is reserved for the later queue
implementation rather than silently processing or discarding jobs.
