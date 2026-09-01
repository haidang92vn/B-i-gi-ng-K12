# Database Contract — Initial Proposal

Use PostgreSQL. Use UUID primary keys unless the implementation has a strong reason otherwise. All timestamps should be timezone-aware.

## Milestone 01 implementation

`migrations/versions/20260901_01_create_projects.py` creates the initial `projects` table.
It stores `course_json` as JSON/JSONB (JSONB on PostgreSQL) and enforces optimistic updates
in the API by matching the submitted `expected_revision` in the SQL update predicate. Local
prototype runs may use SQLite only; production must set `DATABASE_URL` to PostgreSQL and run
`alembic upgrade head` before starting the API.

## users
- id
- email (unique, normalized)
- password_hash
- full_name nullable
- school_name nullable
- status
- created_at
- updated_at
- last_login_at nullable

## sessions / refresh_tokens
- id
- user_id
- token_hash or session identifier
- expires_at
- revoked_at nullable
- created_at
- user_agent/ip metadata only if justified and documented

## projects
- id
- owner_user_id
- title
- status: active / archived
- course_json JSONB
- schema_version
- revision integer
- created_at
- updated_at

## schools
- id
- name (unique)
- created_by_user_id
- created_at
- updated_at

## school_memberships
- id
- school_id
- user_id
- role: school_admin / teacher
- created_at

The `(school_id, user_id)` pair is unique. The API prevents removing the last `school_admin`.

## project_shares
- id
- project_id
- user_id
- access_level: viewer / editor
- granted_by_user_id
- created_at
- updated_at

The `(project_id, user_id)` pair is unique. A share supplements, rather than replaces, the
project owner relationship.

## project_versions
Optional but recommended once autosave/editor is stable.
- id
- project_id
- revision
- course_json JSONB or patch/snapshot strategy
- created_by_user_id
- reason nullable
- created_at

## ai_credentials
- id
- user_id
- provider
- label nullable
- encrypted_secret
- secret_last4 nullable
- model_default nullable
- status
- created_at
- updated_at

Never return `encrypted_secret` through normal API serializers.

## files
- id
- user_id
- project_id nullable
- purpose: source / image / audio / video / export / backup
- original_name
- mime_type
- byte_size
- storage_key
- checksum nullable
- created_at
- deleted_at nullable

## question_bank_items
Do not require normalization in Milestone 01. Add later if cross-project reuse is implemented.

## export_jobs
- id
- project_id
- user_id
- type: scorm2004
- status: queued / running / failed / ready
- input_revision
- error_code nullable
- error_message_safe nullable
- created_at
- started_at nullable
- finished_at nullable

## scorm_exports
- id
- export_job_id
- project_id
- storage_key
- filename
- byte_size
- manifest_version/preset metadata
- validation_json JSONB
- created_at

## audit_events
Start small. Record security-relevant actions such as credential replacement, account changes and export creation without storing secrets.
