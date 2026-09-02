# Product Backlog

## Milestone 01 — Canonical course model + persistence [P0]
- [ ] Implement versioned `course.json` model using Pydantic.
- [ ] Validate against `schemas/course.schema.json`.
- [ ] Store project/course state in PostgreSQL JSONB.
- [ ] Create migrations.
- [ ] Add project create/read/update flow.
- [ ] Add revision/version field.
- [ ] Migrate prototype state to the canonical model.

Acceptance:
- restart server, reopen project, data remains;
- invalid course payload is rejected;
- prototype workflow can read/write the model;
- tests pass.

## Milestone 02 — Accounts + project library [P0]
- [ ] Register/login/logout.
- [ ] Secure password hashing.
- [ ] Session/refresh lifecycle.
- [ ] “My lessons” project library.
- [ ] Create/rename/duplicate/archive/delete project.
- [ ] Ownership checks on every project endpoint.

Acceptance:
- two teachers cannot access each other's projects;
- user can leave and return to continue a project.

## Milestone 03 — Source material + object storage [P0]
- [ ] S3-compatible storage adapter.
- [ ] Upload text/DOCX/PDF/PPTX.
- [ ] Store file metadata in DB, bytes in object storage.
- [ ] Extract source text to a normalized source model.
- [ ] File size/type controls.

Acceptance:
- uploaded source survives VPS app restart;
- deleting a project follows defined asset-retention policy.

## Milestone 04 — Teacher AI credentials + provider adapters [P0]
- [x] Credential CRUD without revealing plaintext secret.
- [x] Encrypt credentials at rest.
- [x] Provider-neutral AI interface.
- [x] Mock provider remains available for tests.
- [x] Add first real provider (OpenAI and Gemini).
- [x] Structured output validation/retry.

Acceptance:
- browser never receives stored secret;
- logs contain no API key;
- invalid AI JSON is retried/rejected safely.

## Milestone 05 — AI analysis + storyboard [P0]
- [x] Lesson/review/advanced prompt strategies.
- [x] Generate objectives.
- [x] Generate slide storyboard.
- [x] Generate initial question bank.
- [x] Regenerate one section without regenerating whole course.
- [x] Cost/token usage metadata.

Acceptance:
- output validates to course schema;
- teacher can regenerate a single section.

## Milestone 06 — Course editor [P0]
- [x] Edit objectives.
- [x] Add/remove/reorder/duplicate slide.
- [x] Reusable slide layouts.
- [x] Per-slide AI regenerate.
- [x] Draft/edited/approved states.
- [x] Autosave/debounced save.

Acceptance:
- refresh does not lose approved edits;
- reordering persists.

## Milestone 07 — Quiz bank + quiz editor [P0]
- [x] Select/unselect generated questions.
- [x] Edit stem/options/answer/explanation/feedback/score.
- [x] Difficulty + objective linkage.
- [x] Priority 1 renderers: single, multiple, true/false, fill.
- [x] Priority 2: matching, ordering.
- [x] Priority 3: drag/drop, image interactions.

Acceptance:
- selected quiz state persists;
- scoring is deterministic and tested.

## Milestone 08 — HTML5 player [P0]
- [x] Previous/Next.
- [x] Progress.
- [x] Slide menu.
- [x] Responsive/fullscreen.
- [x] Free/sequential/restricted navigation.
- [x] Theme/layout rendering.
- [x] Safe rendering of teacher/AI text.

Acceptance:
- desktop/mobile usable;
- no arbitrary authored script execution.

## Milestone 09 — Completion engine + SCORM runtime [P0]
- [x] Store completion policy in course model.
- [x] Implement SCORM 2004 runtime adapter.
- [x] Resume with location/suspend data.
- [x] Score/completion/success/session time tracking.
- [x] Runtime unit/integration test harness.

Acceptance:
- resume works in a SCORM test environment;
- completion and success are independently correct.

## Milestone 10 — SCORM packager + validator + K12 preset [P0]
- [x] Build manifest.
- [x] Package all assets.
- [x] Validate references and root structure.
- [x] K12Online preset.
- [x] Export history stored in DB/R2.
- [x] Manual compatibility test checklist.

Acceptance:
- invalid package cannot be exported as “ready”;
- ZIP has manifest at root;
- real LMS test results are documented.

## Milestone 11 — Production deployment [P1]
- [x] Docker Compose production stack.
- [x] HTTPS/domain.
- [x] PostgreSQL backup to off-site object storage.
- [x] health/readiness checks.
- [x] log redaction.
- [x] basic monitoring.
- [x] restore drill documentation.

## Milestone 12 — Quality & advanced features [P1/P2]
- [x] AI quality checker.
- [x] question quality checks.
- [x] slide text-density checks.
- [x] media/TTS.
- [x] school/team accounts.
- [x] shared question library.
- [x] analytics (report-import prototype; live field mapping remains pending).

## Milestone 12.5 — K12Online analytics integration [P1]
- [x] Verify public K12Online data channels: report export is documented; no public analytics API/webhook contract found.
- [ ] Obtain de-identified export samples and field dictionary from the school/partner administrator before live onboarding.
- [x] Implement report-import adapter, normalized analytics storage and dashboard from synthetic contract.
- [ ] Add API/webhook adapter only when K12Online/Viettel supplies an approved specification.

## Milestone 12.6 — First-school production onboarding [P1]
- [x] Add idempotent first-school administrator provisioning after migration.
- [x] Prepare VPS secret, migration, administrator and report-import acceptance checklist for Trường Tiểu học Trần Quốc Toản.
- [ ] Execute the runbook with an authorized administrator email/password and an approved VPS operator.

## Milestone 12.7 — Google sign-in [P1]
- [x] Add Google OpenID Connect server flow with PKCE, state/nonce and verified identity binding.
- [x] Add exact-email first administrator bootstrap for Trường Tiểu học Trần Quốc Toản.
- [ ] Configure the Google Cloud consent screen, OAuth client and exact production callback URI on the approved domain.

## Milestone 12.8 — End-to-end 8-step workflow review [P1]
- [x] Allow a teacher to start at Step 1 by selecting a source file; create a canonical draft project automatically.
- [x] Apply AI-generated content to that same draft project instead of creating a duplicate lesson.
- [x] Preserve generation-run linkage when the AI populates a pre-existing draft.

## Milestone 13 — Incremental Next.js frontend migration [P1]
- [x] Scaffold a strict Next.js 16 + TypeScript application without removing the FastAPI prototype.
- [x] Reuse backend-owned HttpOnly authentication, Google sign-in and the `/api/*` contract through a same-origin proxy.
- [x] Provide a responsive shell in which the existing eight-step teacher workflow remains recognizable.
- [x] Add the Step 1 source/title surface with explicit save state.
- [x] Connect Step 1 to canonical draft creation and source upload, then verify refresh/reopen behavior.
- [ ] Migrate Step 2 direction selection and persist it through optimistic canonical revision updates.
- [ ] Migrate Steps 2–8 incrementally; remove a prototype screen only after its replacement passes acceptance tests.

Acceptance for this first slice:
- Next.js production build and strict TypeScript check pass;
- unauthenticated `/api/v1/me` reaches FastAPI through the frontend proxy and returns `401`;
- the FastAPI prototype and existing automated suite remain functional;
- no credential is stored in browser JavaScript or committed configuration.
