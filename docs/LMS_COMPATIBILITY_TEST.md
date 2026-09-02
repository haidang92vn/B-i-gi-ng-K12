# Manual LMS compatibility checklist

Do not claim K12Online compatibility until this checklist is completed for a real exported package.

For each release affecting player, quiz, runtime or packaging, record the date, package export ID, K12Online course URL (internal), browser and result.

- Upload the ZIP to a K12Online SCORM 2004 activity; verify launch succeeds.
- Confirm title, slide menu, next/previous and mobile layout.
- Leave mid-course, close, reopen and verify the location resumes.
- Complete the configured viewed percentage and verify completion status.
- Submit both passing and failing quizzes; verify success is independent from completion.
- Verify raw/scaled score, suspend data and session time in LMS reporting where available.
- Repeat launch and resume in a second supported browser.
- Optionally repeat the same package in SCORM Cloud as a diagnostic comparison.

Record failures, LMS messages and a recovery test before marking the preset compatible.

## Release verification record

| Date | Scope | Automated package validation | K12Online tenant test | Result |
|---|---|---|---|---|
| 2026-09-02 | Player, runtime, advanced quiz, canonical LMS settings and ZIP validator | 33 tests passed; final ZIP readability/root/path checks enabled | Not run — no approved tenant/course and export ID supplied | Static validation passed; K12Online compatibility remains unverified |
