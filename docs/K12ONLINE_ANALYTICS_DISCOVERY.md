# K12Online analytics discovery (Milestone 12.5)

Date checked: 2026-09-02.

## Evidence from public K12Online documentation

K12Online's content-partner guidance documents three relevant report families: overview,
usage reports (by unit, lesson and program) and detailed usage reports (by lesson and program).
It explicitly says that usage reports can be exported. The general user guide also documents
detailed assessment reports such as an attempt list, gradebook, topic statistics and score
distribution. K12Online accepts SCORM ZIP learning material.

- https://hotro.k12online.vn/doi-tac-noi-dung/thong-ke-bao-cao.html
- https://static.k12online.vn/lien-ket/huong-dan-su-dung

No public documentation was found for an analytics data API, SCORM event webhook, xAPI/LRS
endpoint, or an analytics webhook subscription. A public K12Online webhook reference exists for
CCCD examination identity verification only; it must not be treated as an analytics integration.

## Decision

Use a **report-import adapter** as the first supported K12Online integration. Do not scrape the
K12Online interface, reuse browser sessions, or infer undocumented endpoints. A future API or
webhook adapter can implement the same normalized input contract once Viettel/K12Online provides
an approved tenant-specific specification and credential flow.

## Minimum data contract to obtain before implementation

Ask the school/partner administrator to export a de-identified sample of each available report,
with its column headers and one data dictionary. The importer must identify:

- stable learner pseudonym or K12Online learner ID (never a name as the primary key);
- lesson/course identifier, title and learning assignment/class context;
- first/last activity timestamp, completion state and completion percentage where present;
- score, maximum score and attempt number where present;
- duration/time-on-task and question-level correctness where present;
- report period, timezone and export-generated time.

The exact export format and columns are tenant/role dependent, so no parser is implemented from
screenshots or undocumented assumptions. Imports should be CSV/XLSX only, encrypted at rest,
access-controlled to the appropriate school, idempotent by source file hash and auditable. Raw
student identifiers should be pseudonymized before AI receives any aggregate summary; AI must
not make grades or automated high-stakes decisions.

## Recommended implementation sequence after approval

1. Receive de-identified sample exports and map column names.
2. Implement CSV/XLSX upload, validation, normalization and import audit.
3. Build school/teacher dashboard for completion, score, time-on-task and question accuracy.
4. Add deterministic flags; provide AI only aggregate narrative suggestions.
5. Add an API/webhook adapter only after an official specification, consent/roles and test tenant
   are supplied by K12Online/Viettel.
