# Onboarding production — Trường Tiểu học Trần Quốc Toản

This is the controlled first-school runbook for **Trường Tiểu học Trần Quốc Toản**. Complete it
on the approved VPS only. Do not paste production secrets, staff passwords or student exports into
Git, chat logs or this repository.

## 1. Authority and inputs

Before touching the VPS, name one school administrator and obtain, through the school's approved
channel:

- administrator full name and official email;
- an initial password delivered separately to that person (minimum 12 characters, not reused);
- approval for the dashboard's aggregate-only learner analytics purpose and retention period;
- one de-identified K12Online report export plus its field dictionary.

The first administrator is the account that can invite the remaining teachers, review the shared
question library and import reports. Do not use a shared generic account.

## 2. Configure the VPS secret file

Clone the audited commit, create `.env` from `.env.example`, set its permissions to `0600`, and
set all production values in the VPS secret store. In addition to PostgreSQL, Redis, Fernet, R2
and backup values, `APP_ENV=production` requires a unique non-placeholder
`ANALYTICS_PSEUDONYM_KEY`. Generate it independently from all other secrets; rotating it later
requires a planned analytics re-import.

Do **not** put `INITIAL_ADMIN_PASSWORD` in `.env`. Use a short-lived shell environment only for
the single provisioning command below.

## 3. Migrate, then provision the first administrator

Run these commands from the release directory during a maintenance window. They intentionally
start only PostgreSQL/Redis first, apply Alembic once, then run an ephemeral provisioning
container. Replace the email/name with the designated school administrator; retain the school name
exactly as shown.

```bash
docker compose build
docker compose up -d postgres redis
docker compose --profile operations run --rm migrate

export INITIAL_SCHOOL_NAME='Trường Tiểu học Trần Quốc Toản'
export INITIAL_ADMIN_FULL_NAME='Tên quản trị viên được ủy quyền'
export INITIAL_ADMIN_EMAIL='quantri@truong.example.edu.vn'
read -r -s -p 'Initial administrator password: ' INITIAL_ADMIN_PASSWORD; echo
export INITIAL_ADMIN_PASSWORD
docker compose --profile operations run --rm --no-deps \
  -e INITIAL_SCHOOL_NAME -e INITIAL_ADMIN_FULL_NAME -e INITIAL_ADMIN_EMAIL -e INITIAL_ADMIN_PASSWORD \
  provision
unset INITIAL_ADMIN_PASSWORD INITIAL_ADMIN_EMAIL INITIAL_ADMIN_FULL_NAME INITIAL_SCHOOL_NAME

docker compose up -d --remove-orphans
docker compose ps
curl -fsS https://YOUR_DOMAIN/healthz
curl -fsS https://YOUR_DOMAIN/readyz
```

The provisioning command refuses to run unless Alembic is at `20260902_15`. It is idempotent:
re-running it preserves an existing user's password and ensures that user has `school_admin` for
this school. It prints only school/admin IDs, school name and email—never the password. A failed
command must be investigated before retrying; do not bypass the migration check.

## 4. First-account and access acceptance

1. The designated administrator signs in at the HTTPS domain with the one-time password and
   changes it through the approved account process when that capability is released. Until then,
   the password must be rotated only by an authorized database/account procedure; never use the
   provisioning command as a reset tool.
2. In **Nhóm trường**, verify the school name, then invite two registered teacher accounts: one
   teacher and one additional `school_admin`. Verify that removing the final school admin is
   refused.
3. Verify a teacher can see aggregate analytics but cannot import/list source reports. Verify an
   outsider receives no school analytics response.
4. Verify `/readyz`, Caddy HTTPS, R2 private-object access and the first encrypted backup. Record
   the deployment date, release commit, designated admin and backup verification in the school's
   controlled operations record, not in source control.

## 5. K12Online report acceptance before real import

Do not upload a production report until the school/partner administrator confirms the following:

- export is authorized, de-identified and does not rely on a learner name/email as its identifier;
- the field dictionary maps the three required fields: learner pseudonym, course identifier and
  lesson identifier;
- report period, timezone, score denominator, completion calculation and attempt semantics are
  understood;
- retention owner and deletion/re-import procedure are documented;
- a 10–20 learner pilot reconciles aggregate completion, score, duration and question correctness
  with the authorized K12Online report without exposing individual learners in the dashboard.

Use the included synthetic CSV/XLSX first to verify the import path. For a real report, the school
administrator imports it through **Analytics**; the application parses it in memory, stores only
normalized HMAC-pseudonymized events and discards source bytes. Do not send a raw export to an AI
provider, an external consultant or an unapproved support channel.

## 6. Go/no-go record

Go live only when every item in sections 2–5 is confirmed by the school administrator and VPS
operator. If K12Online/Viettel later supplies an approved analytics API/webhook specification,
evaluate it as a separate change; do not enable scraping or reuse browser sessions.
