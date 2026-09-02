# Implementation Status

## Current state: starter/prototype

The repository contains a runnable FastAPI prototype and contracts for the production
architecture. It is **not yet the production application**.

### Available now

- 8-step UX prototype.
- Mock AI generation flow.
- Editable lesson review flow.
- Quiz type selection UI.
- Basic HTML5 course rendering.
- Basic SCORM 2004 package generation.
- `course.json` JSON Schema and example.
- Versioned Pydantic `course.json` model, project persistence and Alembic migration.
- Optimistic revision handling for project reads/updates in the prototype API.
- Teacher registration/login/logout with Argon2id password hashing and revocable HttpOnly sessions.
- Per-teacher project library with ownership isolation, duplicate, archive and delete actions.
- Source uploads for TXT, PDF, DOCX and PPTX; extracted text and file metadata are persisted while object bytes use R2-compatible storage.
- Per-teacher encrypted OpenAI/Gemini credentials; the browser only receives metadata and the last four key characters.
- Server-side provider adapters for Mock AI, OpenAI Responses API and Google Gemini structured JSON output, with schema validation and one retry.
- Lesson, review and advanced AI storyboarding with a larger question bank than the initially selected quiz set; per-slide regeneration preserves other slides and rejects overwriting approved slides.
- Non-sensitive generation metadata (provider, model, request ID and token counts when supplied) is stored in `generation_runs` and linked to the created project.
- Course editor supports objectives and slide editing, add/delete/duplicate/reorder, reusable layout IDs, and `ai_draft`/`edited`/`approved` states. Debounced autosave reports conflict/failure instead of discarding unsaved work.
- Quiz bank editor persists question text, options, answer, explanation, feedback, score, difficulty, objective links and selected state. Deterministic exact-match scoring supports single/multiple choice, true/false, fill, matching and ordering; drag/drop and image interactions remain deferred.
- HTML5 player preview renders directly from the canonical project through the same renderer used by SCORM export. It includes progress, menu, fullscreen, responsive layouts, navigation restrictions and escaping for both HTML text and JSON embedded in scripts.
- SCORM runtime tracks location, suspend data, progress, score, completion, success and session time. A fake `API_1484_11` harness verifies resume and the independence of completion/success without an LMS.
- SCORM export validates manifest, root files, launch resource, runtime and configuration before packaging. Ready packages are stored in R2-compatible storage with per-teacher export metadata; manual K12Online/SCORM Cloud verification uses `docs/LMS_COMPATIBILITY_TEST.md`.
- Production deployment artifacts include a Caddy HTTPS reverse proxy, FastAPI API, Redis, PostgreSQL, an explicit Alembic migration job, a reserved Redis worker and a daily encrypted PostgreSQL backup service to a separate R2 bucket. Liveness/readiness endpoints, structured secret-redacted logs, monitoring guidance and a quarterly restore drill are documented in `docs/DEPLOYMENT.md` and `docs/RESTORE_DRILL.md`.
- The export step includes a deterministic, non-blocking quality check over canonical course data. It flags AI-draft slides, text density, question stem/options/answer structure, duplicates, zero-score quiz questions and missing objective links without calling an AI provider or replacing the SCORM technical gate.
- School teams support explicit school administrators and teacher members. Project owners can share a lesson only with a registered teacher in a common school, as `viewer` or `editor`; the prototype UI locks viewer editing while retaining player, quality-check and SCORM-export access.
- The school shared-question library keeps subject, grade, topic, learning objectives, answer, difficulty and reviewer attribution. Teachers submit a draft from an edited course question; school admins publish or reject it, and only published copies can be added back into a project.
- Media/TTS supports an explicit teacher preview before attachment. Media bytes live in R2-compatible storage and course slides keep only `asset_id` references; upload validation, rights confirmation, private preview, SCORM asset packaging and large-video warnings are implemented. OpenAI and Gemini remain provider adapters, with Mock AI available for the demo.
- K12Online analytics has a privacy-preserving report-import prototype: a school admin imports bounded CSV UTF-8/XLSX data, original report bytes are discarded, learner identifiers become HMAC tokens, and the dashboard shows school/lesson aggregates only. Deterministic suggestions use aggregate metrics only; no AI provider receives learner-level data.
- A one-shot production provisioning service can safely create the first administrator and school membership after Alembic migration. The school-specific runbook is prepared for Trường Tiểu học Trần Quốc Toản, but it intentionally has not created an account without the authorized administrator's email/password or operated a real VPS.
- Google sign-in/register is implemented as a backend-verified OpenID Connect server flow. A verified email can bootstrap the first school administrator only when that exact email and school name are set in the VPS secret file; Google Cloud OAuth credentials and the production callback remain external setup work.
- The eight-step flow now accepts source files at Step 1 without requiring a pre-existing lesson: it creates one canonical draft, uploads the material, and then fills that same project with the AI storyboard and question bank. This avoids duplicate lessons and retains generation metadata.
- Architecture, database, API, security, deployment and SCORM design documents.
- Repository validator, unit smoke tests and GitHub Actions validation workflow.

### Not implemented yet

- Production PostgreSQL project library (the local prototype uses SQLite; deployment must run the Alembic migration against PostgreSQL).
- Full quiz renderers for matching/ordering/drag-drop/image interactions.
- Full SCORM conformance validation and verified K12Online interoperability matrix.
- A production Next.js frontend and actual background-job handlers (the current Compose worker only validates Redis connectivity).
- A real de-identified K12Online export/field dictionary, school retention approval and any official API/webhook specification. The generic report-import prototype must be mapped and accepted before live use; see `docs/ANALYTICS.md`.
- Execution of the controlled Trường Tiểu học Trần Quốc Toản production runbook by the approved VPS operator and school administrator; see `docs/ONBOARDING_TRAN_QUOC_TOAN.md`.

Follow `TASKS.md` and the numbered files in `prompts/` to implement these in order.
