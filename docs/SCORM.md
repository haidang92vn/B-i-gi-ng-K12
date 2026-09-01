# SCORM 2004 / K12Online Requirements

## Package root
The ZIP root must contain `imsmanifest.xml`; do not place the entire package inside an extra top-level folder.

```text
lesson.zip
├── imsmanifest.xml
├── index.html
├── runtime.js
└── assets/...
```

## Runtime target
Use SCORM 2004 API object `API_1484_11`.

Minimum tracking targets:
- `cmi.location`
- `cmi.suspend_data`
- `cmi.progress_measure`
- `cmi.score.raw`
- `cmi.score.min`
- `cmi.score.max`
- `cmi.score.scaled`
- `cmi.completion_status`
- `cmi.success_status`
- `cmi.session_time`

Lifecycle:
- Initialize
- GetValue/SetValue
- Commit
- Terminate

## Completion engine
Completion and success are separate.

Example preset:
- viewed percentage >= 90% => completion can become `completed`
- quiz score >= 70% => success becomes `passed`
- otherwise quiz success becomes `failed`

The exact policy must be stored in the course model, not hard-coded in player JS.

## Resume
Persist the learner position and compact player state. Use `cmi.location` for current location and `cmi.suspend_data` for additional state.

## Validator
Before export is downloadable, validate at least:
- manifest exists and is parseable XML
- one launch SCO exists
- referenced files exist
- no absolute local filesystem paths
- no missing media references
- quiz items are internally valid
- passing/completion values are in range
- generated ZIP opens and has manifest at root

## Compatibility policy
Do not claim full K12Online compatibility solely from static package checks. Maintain a manual test matrix against a real K12Online course and optionally SCORM Cloud after runtime changes.
