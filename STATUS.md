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
- Architecture, database, API, security, deployment and SCORM design documents.
- Repository validator, unit smoke tests and GitHub Actions validation workflow.

### Not implemented yet

- Production Next.js frontend.
- Persistent PostgreSQL project library.
- Authentication/authorization.
- Cloudflare R2/S3 file storage.
- Encrypted per-teacher AI credentials.
- Real OpenAI/Gemini/Claude provider adapters.
- Full quiz renderers for matching/ordering/drag-drop/image interactions.
- Background job queue/workers.
- Full SCORM conformance validation and verified K12Online interoperability matrix.
- Production Docker Compose deployment.

Follow `TASKS.md` and the numbered files in `prompts/` to implement these in order.
