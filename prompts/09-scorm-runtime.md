# Codex Prompt 09 — Completion engine and SCORM 2004 runtime

Implement a testable SCORM 2004 runtime layer.

Use `docs/SCORM.md` as requirements.

Requirements:
- separate completion and success state;
- resume via location/suspend_data;
- progress, score, success, completion and session-time tracking;
- completion policy comes from the course model;
- isolate LMS API calls behind a runtime adapter;
- add a test harness/fake API_1484_11 implementation to validate runtime behavior without a real LMS.
