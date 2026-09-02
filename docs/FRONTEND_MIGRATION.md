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
- Step 2 direction selection persisted through an optimistic canonical revision update;
- Step 3 Mock/OpenAI/Gemini selection, server-owned credential metadata and structured generation;
- schema-validated AI output populated into the same canonical draft with generation-run linkage;
- Step 4 objective/slide review, status management and debounced canonical autosave;
- add, duplicate, reorder and delete slide operations plus targeted regeneration of unapproved slides;
- Step 5 question-bank filtering, selection and full canonical quiz-field editing;
- structured authoring for matching, ordering, drag/drop and asset-backed image interactions;
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

Step 2 now offers lesson, review and advanced directions. Saving changes only
`course.metadata.direction` and `course.revision`; it preserves title, source history and all other
canonical fields. A revision conflict is shown instead of silently overwriting another session.

Step 3 now generates from the extracted source restored from the newest saved material. Mock AI is
the no-cost default; OpenAI and Gemini can only use an active credential ID returned by the backend.
The browser never receives or submits the stored secret. Generated data is schema-validated by
FastAPI, assigned the existing project ID and next optimistic revision, and linked to its generation
run. A provider/schema/network failure leaves the saved source and direction intact so the teacher
can retry. Existing generated slides are not overwritten from this screen; the teacher continues to
review and edit them at Step 4.

Step 4 now edits learning objectives and the title, main text, speaker notes, layout and review
status of each slide. Teachers can add, duplicate, reorder and delete slides. Changes remain in the
current UI while a 700 ms debounced save advances the canonical project revision; navigation is
held until the latest change is acknowledged. A conflict or network failure leaves the local values
visible. Network failures offer a retry; a revision conflict requires an explicit, warned action
before the editor replaces local values with the newest server version. Targeted regeneration uses the selected
Step 3 provider, waits for autosave and relies on the backend guard that refuses to overwrite an
approved slide. Non-text media blocks remain intact during text edits.

Step 5 now separates selecting a question from deleting it: unselected questions remain in the
canonical bank and can be filtered or reused. The editor covers all eight supported interaction
types, score, difficulty, options, structured correct answers, explanation, feedback and learning-
objective links. Matching pairs, ordered/drag-drop sequences and image-option asset references have
teacher-readable line formats that convert to the existing canonical structures without changing
the deterministic backend scoring rules. Per-question warnings identify missing stems, answers,
options, scores and objective links. Autosave and conflict recovery use the same guarded revision
workflow as Step 4.

The next slice implements Step 6 HTML5 lesson building and preview in Next.js. It will render from
the saved canonical project through the backend player and migrate the related media/TTS preview,
rights confirmation and slide-attachment workflow without persisting generated HTML as source.
