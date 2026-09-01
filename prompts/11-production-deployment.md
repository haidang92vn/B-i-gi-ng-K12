# Codex Prompt 11 — Production deployment

Prepare the repository for a VPS deployment using Docker Compose.

Target:
- Singapore VPS
- reverse proxy + HTTPS
- Next.js
- FastAPI
- PostgreSQL
- Redis
- worker
- Cloudflare R2

Requirements:
- production Dockerfiles/Compose;
- health/readiness checks;
- migrations on deploy with safe procedure;
- secret/environment documentation;
- database backup script producing encrypted off-site backups;
- log redaction;
- restore procedure;
- no persistent user data depending solely on VPS local disk.
