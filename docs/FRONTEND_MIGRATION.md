# Incremental Next.js frontend migration

## Scope of the first slice

The `frontend/` application is the first bounded migration from the FastAPI-served prototype to
the production target of Next.js + TypeScript. It intentionally does not remove or duplicate the
prototype's working domain logic.

Included now:

- backend-owned email login/register using the existing HttpOnly session cookie;
- Google OpenID Connect entry through the existing FastAPI endpoint;
- a responsive navigation shell that keeps all eight teacher workflow steps recognizable;
- a Step 1 title, source-text and source-file surface with explicit save/error state;
- canonical draft creation, optimistic title revision updates and source persistence;
- automatic restore of the latest active owned draft and its newest extracted source;
- a same-origin `/api/*` rewrite to FastAPI.

The browser never receives stored teacher AI credentials. `course.json` remains canonical and no
generated HTML or unsaved frontend draft is treated as persisted source data.

## Local run

Start FastAPI from the repository root:

```powershell
uvicorn prototype.main:app --reload --host 127.0.0.1 --port 8000
```

Then start the frontend:

```powershell
cd frontend
pnpm install
pnpm dev
```

Open `http://127.0.0.1:3000`. Set `FASTAPI_ORIGIN` in `frontend/.env.local` only when the backend
uses another origin. Keep secrets in the backend/VPS environment; the frontend variable is only a
server-side proxy destination.

For Google OAuth during local development, register the exact callback
`http://127.0.0.1:3000/api/v1/auth/google/callback`. Production must use the exact approved HTTPS
domain instead.

## Verification

```powershell
cd frontend
pnpm typecheck
pnpm build
```

With both services running, `GET http://127.0.0.1:3000/api/v1/me` must reach FastAPI. An
unauthenticated request should return `401`, which proves the proxy path without creating an
account or changing data.

## Migration rule and next slice

Migrate one workflow slice at a time. A prototype screen remains available until its Next.js
replacement persists canonical data, passes its acceptance tests and survives refresh/reopen.

Step 1 now reuses the open project instead of creating a new record for each save. Pasted text is
stored as a UTF-8 source material version; uploaded TXT/PDF/DOCX/PPTX files remain in the configured
object storage, while the frontend restores extracted text through the authenticated API.

The next slice implements Step 2 direction selection. Acceptance requires the selected lesson,
review or advanced direction to persist through an optimistic canonical revision update and remain
selected after refresh without changing Step 1 source history.
