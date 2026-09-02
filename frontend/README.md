# Next.js frontend

This directory is the incremental production frontend. Authentication and all eight steps now use
the FastAPI APIs for canonical draft, source, direction, structured
AI generation persistence. Step 3 keeps Mock AI as the free default, selects only
server-safe metadata for saved OpenAI/Gemini credentials and populates the same
canonical project. Step 4 reviews and edits objectives/slides, autosaves with
optimistic revisions and regenerates only unapproved slides. Step 5 selects and
edits all canonical quiz types without deleting unselected bank items. Step 6 embeds the canonical
backend player and handles per-slide AI media, uploads, approved URLs, preview and explicit
`asset_id` attachment. Step 7 persists the K12Online/custom preset, navigation, completion and
SCORM tracking policy and refreshes the same backend player. Step 8 requests the deterministic
quality report, lets FastAPI validate/package the saved project, downloads only a successful ZIP
and shows per-project export metadata. The FastAPI prototype remains available during deployment
cutover; it owns persistence, rendering and SCORM packaging.

```powershell
pnpm install
pnpm dev
```

By default `/api/*` is proxied to `http://127.0.0.1:8000`. Set
`FASTAPI_ORIGIN` when the backend runs elsewhere. For local Google OAuth, the
configured callback must use the frontend origin and `/api/v1/auth/google/callback`.
