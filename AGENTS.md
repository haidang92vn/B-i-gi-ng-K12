# AGENTS.md — Instructions for Codex

## Mission
Build AI SCORM Studio into a production-ready web application while preserving the current 8-step teacher workflow.

## Non-negotiable architecture
1. `course.json` is the canonical domain model and single source of truth.
2. Do not use generated HTML as persisted source data.
3. Frontend target: Next.js + TypeScript.
4. Backend target: FastAPI + Pydantic.
5. PostgreSQL persists users/projects/course state; Redis is cache/job queue; S3-compatible storage holds source files, media, exports and backups.
6. AI access must use a provider-adapter interface. Never hard-code one provider into domain logic.
7. Teacher API keys must never be returned to the browser after storage, must never be logged, and must be encrypted at rest.
8. SCORM generation belongs on the backend.

## Workflow that must remain recognizable
1. Input lesson/source material.
2. Choose direction: lesson / review / advanced.
3. AI generates structured content and question bank.
4. Teacher reviews and edits.
5. Teacher selects quiz items and interaction types.
6. Build HTML5 lesson player.
7. Configure LMS/SCORM with K12Online preset.
8. Validate and export SCORM ZIP.

## Development rules
- Inspect existing code before changing it.
- Prefer incremental migrations over a full rewrite.
- Keep the prototype usable until replacement functionality exists.
- For each milestone: implement, add tests, run tests, update docs, summarize changed files and remaining risks.
- Do not introduce secrets into commits.
- Add migrations for persistent schema changes.
- Validate all external input at API boundaries.
- Keep domain logic independent from UI and provider SDKs.
- When changing `course.schema.json`, add a version/migration strategy.
- Do not claim SCORM/K12Online compatibility without automated validation plus a documented manual LMS test.

## Definition of done for a milestone
- Acceptance criteria in `TASKS.md` are met.
- Relevant automated tests pass.
- No secret is committed.
- README/docs are updated if behavior changed.
- Existing critical workflow remains functional.
- A concise change summary is provided.

## First task
Start with `prompts/01-course-model-and-persistence.md` only.
