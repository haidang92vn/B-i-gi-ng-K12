# Codex Prompt 06 — Course editor

Build the production editor around the canonical course model.

Requirements:
- edit objectives and slide content;
- add/delete/duplicate/reorder slides;
- reusable layout identifiers rather than AI-generated arbitrary CSS;
- slide state: ai_draft / edited / approved;
- regenerate a single slide with AI;
- autosave with safe revision handling;
- preserve unsaved-change UX and error recovery;
- add tests for reorder/persistence/revision conflicts.
