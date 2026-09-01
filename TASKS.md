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
- [ ] Lesson/review/advanced prompt strategies.
- [ ] Generate objectives.
- [ ] Generate slide storyboard.
- [ ] Generate initial question bank.
- [ ] Regenerate one section without regenerating whole course.
- [ ] Cost/token usage metadata.

Acceptance:
- output validates to course schema;
- teacher can regenerate a single section.

## Milestone 06 — Course editor [P0]
- [ ] Edit objectives.
- [ ] Add/remove/reorder/duplicate slide.
- [ ] Reusable slide layouts.
- [ ] Per-slide AI regenerate.
- [ ] Draft/edited/approved states.
- [ ] Autosave/debounced save.

Acceptance:
- refresh does not lose approved edits;
- reordering persists.

## Milestone 07 — Quiz bank + quiz editor [P0]
- [ ] Select/unselect generated questions.
- [ ] Edit stem/options/answer/explanation/feedback/score.
- [ ] Difficulty + objective linkage.
- [ ] Priority 1 renderers: single, multiple, true/false, fill.
- [ ] Priority 2: matching, ordering.
- [ ] Priority 3: drag/drop, image interactions.

Acceptance:
- selected quiz state persists;
- scoring is deterministic and tested.

## Milestone 08 — HTML5 player [P0]
- [ ] Previous/Next.
- [ ] Progress.
- [ ] Slide menu.
- [ ] Responsive/fullscreen.
- [ ] Free/sequential/restricted navigation.
- [ ] Theme/layout rendering.
- [ ] Safe rendering of teacher/AI text.

Acceptance:
- desktop/mobile usable;
- no arbitrary authored script execution.

## Milestone 09 — Completion engine + SCORM runtime [P0]
- [ ] Store completion policy in course model.
- [ ] Implement SCORM 2004 runtime adapter.
- [ ] Resume with location/suspend data.
- [ ] Score/completion/success/session time tracking.
- [ ] Runtime unit/integration test harness.

Acceptance:
- resume works in a SCORM test environment;
- completion and success are independently correct.

## Milestone 10 — SCORM packager + validator + K12 preset [P0]
- [ ] Build manifest.
- [ ] Package all assets.
- [ ] Validate references and root structure.
- [ ] K12Online preset.
- [ ] Export history stored in DB/R2.
- [ ] Manual compatibility test checklist.

Acceptance:
- invalid package cannot be exported as “ready”;
- ZIP has manifest at root;
- real LMS test results are documented.

## Milestone 11 — Production deployment [P1]
- [ ] Docker Compose production stack.
- [ ] HTTPS/domain.
- [ ] PostgreSQL backup to off-site object storage.
- [ ] health/readiness checks.
- [ ] log redaction.
- [ ] basic monitoring.
- [ ] restore drill documentation.

## Milestone 12 — Quality & advanced features [P1/P2]
- [ ] AI quality checker.
- [ ] question quality checks.
- [ ] slide text-density checks.
- [ ] media/TTS.
- [ ] school/team accounts.
- [ ] shared question library.
- [ ] analytics.
