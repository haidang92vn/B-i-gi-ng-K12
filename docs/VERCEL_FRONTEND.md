# Vercel frontend and VPS API

The production frontend is a Next.js application on Vercel. FastAPI, PostgreSQL,
Redis and private R2 storage remain on the approved VPS. This split preserves the
server-owned session, canonical `course.json`, provider credentials and SCORM
packaging contract.

## Current demo deployment

The temporary frontend URL is
`https://frontend-vert-nine-24.vercel.app`. It is suitable for reviewing the
interface and for configuring an exact Google OAuth callback later. It does not
make login, AI generation, uploads or SCORM export available until a public VPS
API is configured. The login screen explicitly detects this missing backend and
explains that it is an interface-only deployment instead of presenting a
misleading authentication failure.

The current upload deployment is deliberately a manual Vercel deployment. Link
the GitHub repository to the Vercel project after the repository selector refreshes,
set the root directory to `frontend`, and use `main` as the production branch so
future validated commits deploy automatically.

## Required production topology

Use two HTTPS hostnames:

- `studio.YOUR_DOMAIN`: Vercel frontend. Until a school domain is purchased, the
  temporary `vercel.app` address can be used here.
- `api.YOUR_DOMAIN`: VPS Caddy reverse proxy to FastAPI. This domain needs DNS A/AAAA
  records to the VPS and inbound TCP 80/443.

Set these values without committing secrets:

| Location | Variable | Value |
| --- | --- | --- |
| Vercel, Production environment | `FASTAPI_ORIGIN` | `https://api.YOUR_DOMAIN` |
| VPS `.env` | `APP_ENV` | `production` |
| VPS `.env` | `APP_DOMAIN` | `api.YOUR_DOMAIN` |
| VPS `.env` | `APP_URL` | `https://studio.YOUR_DOMAIN` or the temporary Vercel URL |
| VPS `.env` | `API_URL` | `https://api.YOUR_DOMAIN` |
| VPS `.env` | `GOOGLE_OAUTH_REDIRECT_URI` | `https://studio.YOUR_DOMAIN/api/v1/auth/google/callback` |

The Vercel rewrite keeps browser requests on the frontend hostname. That makes the
HttpOnly session and the Google state cookie same-origin; do not call the VPS API
from browser JavaScript directly and do not add frontend CORS credentials as a
workaround.

`FASTAPI_ORIGIN` is not a secret, but it must be an HTTPS URL in Vercel production.
The frontend intentionally has no production fallback to `127.0.0.1`; missing
configuration results in an API 404 rather than silently pointing the deployment
at itself.

## Cutover order

1. Obtain the VPS public IP and the school domain; create the `api` DNS record.
2. Run the documented VPS migration, secrets, R2, health and backup checks in
   [DEPLOYMENT.md](DEPLOYMENT.md).
3. Configure the VPS variables above, then verify `https://api.YOUR_DOMAIN/healthz`
   and `/readyz`.
4. Set `FASTAPI_ORIGIN` in the Vercel Production environment and redeploy the
   frontend. Verify `https://studio.YOUR_DOMAIN/api/v1/me` returns `401` before
   signing in; this proves the same-origin proxy is connected.
5. Add the exact frontend callback URI to Google Cloud and keep the Client ID and
   Secret only in the VPS `.env`.
6. Complete the first-school provisioning and the manual K12Online test checklist.

Do not put PostgreSQL, Redis, R2, Google Client Secret, the encryption key or a
teacher AI key in Vercel.
