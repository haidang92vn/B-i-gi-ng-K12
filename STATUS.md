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
- Architecture, database, API, security, deployment and SCORM design documents.
- Repository validator, unit smoke tests and GitHub Actions validation workflow.

### Not implemented yet

- Production Next.js frontend.
- Production PostgreSQL project library (the local prototype uses SQLite; deployment must run the Alembic migration against PostgreSQL).
- Encrypted per-teacher AI credentials.
- Real OpenAI/Gemini/Claude provider adapters.
- Full quiz renderers for matching/ordering/drag-drop/image interactions.
- Background job queue/workers.
- Full SCORM conformance validation and verified K12Online interoperability matrix.
- Production Docker Compose deployment.

Follow `TASKS.md` and the numbered files in `prompts/` to implement these in order.
