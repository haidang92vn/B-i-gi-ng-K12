# K12Online report import and school analytics

## Scope

Milestone 12.5 implements the safe first integration path: a school administrator imports a
K12Online-style **CSV UTF-8 or XLSX** report, then teachers see only school-level aggregates.
There is no scraping, undocumented API call, webhook listener or storage of a source report.

The bundled synthetic inputs are `examples/k12online_analytics_synthetic_sample.csv` and the
matching XLSX workbook in `outputs/k12online_analytics_sample/`. They contain invented learner
codes only; they are not K12Online exports and do not prove a tenant-specific field mapping.

## Expected columns

The importer auto-detects a limited English/Vietnamese alias set. Required fields are:

- `learner_pseudonym` (or `student_id`/`ma_hoc_sinh`), never a name or email;
- `course_external_id` (or `course_id`/`ma_chuong_trinh`);
- `lesson_external_id` (or `lesson_id`/`ma_bai_hoc`).

Useful optional fields include `course_title`, `class_code`, `lesson_title`, `activity_date`,
`duration_minutes`, `completion_percent`, `completion_status`, `score`, `max_score`,
`attempt_number`, `correct_answers`, `total_questions`, and `correct_rate`. Percentages accept
either `0..1` or `0..100`. A report is capped at 10 MB and 50,000 rows; malformed rows are
counted but their original values are not retained in error feedback.

## Privacy and access

The API reads the upload in memory, computes an SHA-256 idempotency fingerprint and then discards
the original bytes. Each learner identifier becomes an HMAC-SHA256 token using
`ANALYTICS_PSEUDONYM_KEY`; the source value is never written to PostgreSQL, returned by an API or
sent to an AI provider. The production key is required and must be protected in the VPS secret
store. Rotating it changes future tokens, so it requires a planned migration/re-import process.

Only `school_admin` can import reports or view import history. Any school member can view the
aggregate dashboard and lesson-level aggregate metrics, never learner rows. A duplicate source
hash within a school is rejected. The normalized tables are `analytics_imports` and
`learning_analytics`, created by migration `20260902_15`.

## API

```text
POST /api/v1/schools/{school_id}/analytics/imports       school_admin, multipart field: upload
GET  /api/v1/schools/{school_id}/analytics/imports       school_admin
GET  /api/v1/schools/{school_id}/analytics/summary       school member, aggregates only
GET  /api/v1/schools/{school_id}/analytics/insights      school member, aggregates only
```

`/insights` is deliberately deterministic in this milestone. It offers non-binding teaching
prompts from anonymous aggregates and makes no automated grading, ranking or high-stakes decision.
An AI adapter may later summarize only pre-aggregated data after the school approves a provider,
retention policy and consent model.

## Before connecting a real school

Obtain one de-identified export and data dictionary from the authorized K12Online school/partner
administrator. Confirm real column names, report period/timezone, calculation meanings, role
permissions and retention policy. If K12Online/Viettel later provides an approved API or webhook
specification, add a separate adapter behind this normalized contract rather than changing
dashboard/domain logic.
