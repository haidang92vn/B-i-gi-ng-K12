# Deployment Plan

## MVP production topology

Recommended initial deployment:
- VPS in Singapore
- Docker Compose
- reverse proxy (Caddy or Nginx)
- Next.js
- FastAPI
- PostgreSQL
- Redis
- worker process
- Cloudflare R2 for object storage
- Cloudflare DNS/HTTPS in front

## Storage principle
The VPS is for compute and database. Large user files and generated exports belong in object storage.

## Backup
Suggested database policy:
- daily encrypted pg_dump: retain 7
- weekly: retain 4
- monthly: retain 6–12
- store backups off the VPS
- periodically perform a restore test

## Scale path
Phase 1:
```text
1 VPS + PostgreSQL + Redis + worker + R2
```

Phase 2:
```text
App VPS + managed PostgreSQL + Redis + R2
```

Phase 3:
```text
multiple API/worker instances + managed DB + managed Redis + R2
```

The application should not rely on local disk for persistent user data so migration between VPS providers remains simple.
