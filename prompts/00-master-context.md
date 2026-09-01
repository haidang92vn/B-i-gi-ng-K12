# Master Context for Codex

You are working on **AI SCORM Studio**, a teacher-facing web app that turns teacher-provided lesson content into a reviewed AI-assisted HTML5 lesson and exports SCORM 2004 for K12Online.

The teacher workflow is fixed at a high level:
1. source content
2. learning direction: lesson/review/advanced
3. AI structured generation
4. teacher review
5. quiz selection/type
6. HTML5 lesson build
7. SCORM settings
8. validation/export

Read in this order:
1. `AGENTS.md`
2. `docs/DECISIONS.md`
3. `docs/ARCHITECTURE.md`
4. `schemas/course.schema.json`
5. `TASKS.md`

The current runnable proof-of-concept is under `prototype/`.

Do not attempt the whole backlog in one pass. Work milestone by milestone using the corresponding file in `prompts/`.
