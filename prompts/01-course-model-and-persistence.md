# Codex Prompt 01 — Course model and persistence

Analyze the entire repository first. Do not rewrite the application from scratch and do not remove the working prototype until equivalent behavior exists.

Goal: establish the production domain foundation.

Tasks:
1. Treat `schemas/course.schema.json` as the starting contract for the canonical course model.
2. Implement equivalent versioned Pydantic models in FastAPI.
3. Introduce PostgreSQL persistence with migrations and a `projects` model storing the canonical course as JSONB.
4. Add project create/read/update endpoints and optimistic revision handling.
5. Refactor the current prototype workflow so its state can be represented by this course model.
6. Do not connect a real AI provider yet; keep Mock AI.
7. Add automated tests for validation, persistence and ownership-ready project boundaries.
8. Update README/docs with run instructions.

Constraints:
- `course.json` is the single source of truth.
- no secrets in source control;
- no HTML persisted as canonical course state;
- do not hard-code provider-specific concepts in the course domain model.

Before finishing:
- run tests;
- fix failures caused by this change;
- list changed files;
- summarize architectural decisions;
- state any schema changes you recommend before Milestone 02.
