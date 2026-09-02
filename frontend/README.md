# Next.js frontend

This directory is the incremental production frontend. Authentication and Steps
1–2 now use the FastAPI APIs for canonical draft, source and direction
persistence. The FastAPI prototype remains available until each remaining
workflow step has a tested Next.js replacement.

```powershell
pnpm install
pnpm dev
```

By default `/api/*` is proxied to `http://127.0.0.1:8000`. Set
`FASTAPI_ORIGIN` when the backend runs elsewhere. For local Google OAuth, the
configured callback must use the frontend origin and `/api/v1/auth/google/callback`.
