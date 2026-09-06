# Implementation Status

## Current state: prototype + incremental production frontend

The repository contains a runnable FastAPI prototype, the first Next.js frontend slice and
contracts for the production architecture. It is **not yet the complete production application**.

### Available now

- Canonical schema 1.1.0 adds backward-compatible quiz attempt and disclosure policy. The
  local-first LMS editor controls 1–10/unlimited attempts, per-question feedback and correct-answer
  disclosure; old 1.0.0 courses migrate to documented safe defaults.

- Submitted quizzes show per-question correct/incorrect feedback and teacher-authored
  explanations. Learners can start a clean retry; required-quiz completion and success return
  to incomplete/unknown until the next submission.

- The serverless SCORM player persists in-progress answers for every supported quiz type in
  `cmi.suspend_data`, restores them after slide navigation/LMS resume, and restores submitted
  score feedback without marking an unfinished quiz complete.

- Suspend data uses a conservative 60,000-character budget below the SCORM 2004 SPM. Oversized
  drafts retain core progress, score and attempt state, compress visited-slide ranges, and visibly
  warn when some answers are omitted or the LMS rejects the save.

- Quiz submissions append SCORM 2004 `cmi.interactions.n` records per question and attempt,
  including type, timestamp, learner response, result and latency. Unsupported interaction
  reporting degrades safely without blocking score, completion or success tracking.

- Local-first Step 8 shows every serverless quality finding with its explanation,
  recommendation and a direct link that selects the exact affected slide or question, or opens the LMS setting step.
  The report remains advisory; server-side validation is still required before SCORM export.

- Serverless preview and ZIP honor menu/progress visibility, free/sequential/restricted
  navigation, responsive two-column/callout layouts and safe theme accents. Progress counts
  distinct visited slides instead of the furthest slide. Verification: 51 Python tests,
  21 Chromium tests, 37 frontend unit tests and TypeScript checks pass locally. The serverless API
  and frontend were deployed to their production aliases on 2026-09-06, followed by a successful
  public Mock AI → preview → quality check → SCORM ZIP smoke test.

- Serverless preview embeds packaged runtime/player scripts for sandbox operation. Export and
  preview reject empty slide lists and invalid selected quiz configurations; generated HTML and
  ZIP assets are exercised in Chromium, including script-text escaping and scoring.

- Local draft protection: navigation waits for editor saves, replacement requires confirmation,
  storage failures remain visible with retry, and source/metadata save atomically in one browser
  write. TypeScript, 36 frontend unit tests and browser regression scenarios cover this slice.

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
- Quiz bank editor persists question text, options, answer, explanation, feedback, score, difficulty, objective links and selected state. Deterministic scoring and the HTML5 player cover single/multiple choice, true/false, fill, matching, ordering, drag/drop and asset-backed image interactions.
- HTML5 player preview renders directly from the canonical project through the same renderer used by SCORM export. It includes progress, menu, fullscreen, responsive layouts, navigation restrictions and escaping for both HTML text and JSON embedded in scripts.
- SCORM runtime tracks location, suspend data, progress, score, completion, success and session time. A fake `API_1484_11` harness verifies resume and the independence of completion/success without an LMS.
- SCORM export validates manifest, root files, launch resource, runtime and configuration before packaging. Ready packages are stored in R2-compatible storage with per-teacher export metadata; manual K12Online/SCORM Cloud verification uses `docs/LMS_COMPATIBILITY_TEST.md`.
- Production deployment artifacts include a Caddy HTTPS reverse proxy, FastAPI API, Redis, PostgreSQL, an explicit Alembic migration job, a Redis worker for durable SCORM export jobs and a daily encrypted PostgreSQL backup service to a separate R2 bucket. Liveness/readiness endpoints, structured secret-redacted logs, monitoring guidance and a quarterly restore drill are documented in `docs/DEPLOYMENT.md` and `docs/RESTORE_DRILL.md`.
- The export step includes a deterministic, non-blocking quality check over canonical course data. It flags AI-draft slides, text density, question stem/options/answer structure, duplicates, zero-score quiz questions and missing objective links without calling an AI provider or replacing the SCORM technical gate.
- School teams support explicit school administrators and teacher members. Project owners can share a lesson only with a registered teacher in a common school, as `viewer` or `editor`; the prototype UI locks viewer editing while retaining player, quality-check and SCORM-export access.
- The school shared-question library keeps subject, grade, topic, learning objectives, answer, difficulty and reviewer attribution. Teachers submit a draft from an edited course question; school admins publish or reject it, and only published copies can be added back into a project.
- Media/TTS supports an explicit teacher preview before attachment. Media bytes live in R2-compatible storage and course slides keep only `asset_id` references; upload validation, rights confirmation, private preview, SCORM asset packaging and large-video warnings are implemented. OpenAI and Gemini remain provider adapters, with Mock AI available for the demo.
- K12Online analytics has a privacy-preserving report-import prototype: a school admin imports bounded CSV UTF-8/XLSX data, original report bytes are discarded, learner identifiers become HMAC tokens, and the dashboard shows school/lesson aggregates only. Deterministic suggestions use aggregate metrics only; no AI provider receives learner-level data.
- A one-shot production provisioning service can safely create the first administrator and school membership after Alembic migration. The school-specific runbook is prepared for Trường Tiểu học Trần Quốc Toản, but it intentionally has not created an account without the authorized administrator's email/password or operated a real VPS.
- Google sign-in/register is implemented as a backend-verified OpenID Connect server flow. A verified email can bootstrap the first school administrator only when that exact email and school name are set in the VPS secret file; Google Cloud OAuth credentials and the production callback remain external setup work.
- The eight-step flow now accepts source files at Step 1 without requiring a pre-existing lesson: it creates one canonical draft, uploads the material, and then fills that same project with the AI storyboard and question bank. This avoids duplicate lessons and retains generation metadata.
- The quiz player and SCORM renderer support deterministic drag/drop ordering and image selection. Image choices reference project media assets through `course.json`, and export rejects a package with unresolved image references; see `docs/QUIZ_INTERACTIONS.md`.
- The HTML5 player now applies its canonical menu/progress/completion settings at runtime. When a quiz is required, slide progress alone cannot mark the course complete; success remains independent and score-based. Matching and ordering render as actual interactions; see `docs/PLAYER_BEHAVIOR.md`.
- The SCORM runtime harness now mirrors quiz-required completion, resume state including highest visited slide, success/score separation and non-negative session duration.
- SCORM export validates both the manifest/file map and the completed ZIP container. It rejects unsafe paths, unreadable archives, duplicate/encrypted entries, missing root manifest, multiple SCOs, non-4th-Edition K12 presets and unlisted packaged assets before recording an export as ready.
- Architecture, database, API, security, deployment and SCORM design documents.
- Repository validator, unit smoke tests and GitHub Actions validation workflow.
- A strict Next.js 16 + TypeScript frontend now covers backend-owned login/register, Google
  sign-in entry and a responsive eight-step workspace shell. It proxies `/api/*` to FastAPI so
  the HttpOnly session remains same-origin. Step 1 creates or updates one canonical draft, uploads
  validated source material, shows explicit save/error state and restores the latest owned draft
  plus its newest extracted source after refresh. Step 2 persists lesson, review or advanced
  direction through an optimistic `course.json` revision without touching source history. Step 3
  selects Mock/OpenAI/Gemini, exposes only server-safe credential metadata, validates structured AI
  output and fills the same canonical project with objectives, slides and a question bank. Step 4
  edits objectives and slides, manages review states and slide order, autosaves with revision
  protection and can regenerate one unapproved slide without touching its siblings. Step 5 keeps
  selected and unselected questions in the canonical bank while editing all quiz types, scores,
  difficulty, structured answers, feedback and objective links with the same revision protection.
  Step 6 embeds the backend-rendered canonical HTML5 player and supports per-slide AI image/TTS,
  validated teacher uploads, approved HTTPS URLs and explicit asset attachment. Step 7 persists
  the K12Online/custom preset, navigation, completion and independent score/completion/success
  tracking switches, then refreshes the canonical player. Step 8 displays the deterministic
  quality report, asks FastAPI to validate/package the saved canonical project, downloads only a
  successful ZIP and shows the project's ready-export metadata. For long-running exports it can
  queue a revision-pinned worker job and later download its private completed ZIP. See
  `docs/FRONTEND_MIGRATION.md`.

### Not implemented yet

- Production PostgreSQL project library (the local prototype uses SQLite; deployment must run the Alembic migration against PostgreSQL).
- Full SCORM conformance validation and verified K12Online interoperability matrix.
- Production deployment cutover from the FastAPI-served prototype UI to the complete Next.js
  frontend. The Compose worker now handles revision-pinned SCORM export jobs, exposes a
  private post-worker ZIP download and is surfaced as an optional Step 8 “Xuất nền” path;
  AI/media jobs still need their own bounded queue contracts and cost controls.
- A real de-identified K12Online export/field dictionary, school retention approval and any official API/webhook specification. The generic report-import prototype must be mapped and accepted before live use; see `docs/ANALYTICS.md`.
- Execution of the controlled Trường Tiểu học Trần Quốc Toản production runbook by the approved VPS operator and school administrator; see `docs/ONBOARDING_TRAN_QUOC_TOAN.md`.

Follow `TASKS.md` and the numbered files in `prompts/` to implement these in order.
