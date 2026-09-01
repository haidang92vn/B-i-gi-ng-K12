# Quality checks before SCORM export

The quality checker reads the canonical course.json of an authenticated project and returns
advisory findings. It does not modify the course, call an AI provider, spend provider tokens, or
replace the technical SCORM package validator.

## What is checked

- fewer than three learning objectives or no slides;
- slide text density: more than 500 characters is a suggestion, more than 850 is a warning;
- slides still marked ai_draft;
- no selected quiz while quiz completion is required;
- short/long question stems, too few or duplicated options, missing/mismatched answers;
- answer data shape for multiple choice, matching and ordering;
- zero-score selected questions, unlinked objectives and duplicate selected question stems.

Findings are warning (should be fixed before publishing) or info (teacher-review guidance).
The score is a transparent readiness indicator, not a measure of pedagogical correctness and never
blocks export. The existing SCORM validator remains the only technical export gate.

## API

GET or POST /api/v1/projects/{project_id}/quality-check checks only the signed-in teacher's
project and returns its revision, score, summary and findings. The web UI saves the current draft
before requesting the report.
