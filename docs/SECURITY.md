# Security Requirements

## Credentials
- Never persist plaintext teacher API keys.
- Never write secrets to application logs, analytics, crash reports or client-side storage.
- Encrypt provider credentials using an application master key or external KMS.
- Return only provider name, credential id, status, model and last 4 characters if needed for UI.
- Support credential rotation/replacement.

## Authentication
- Passwords must be hashed with Argon2id or a comparably strong password hashing scheme.
- Use short-lived access tokens and revocable refresh/session tokens.
- Add rate limiting to login, password reset and AI-generation endpoints.

Google sign-in uses an authorization-code server flow with PKCE, state, nonce and backend ID-token
signature/issuer/audience/expiry verification. The application never accepts a Gmail password and
never stores Google tokens. Google bootstrap admin assignment must compare the verified email with
an exact VPS-only configuration value; see `docs/GOOGLE_SIGN_IN.md`.

## Authorization
Every project/file/export/credential endpoint must verify ownership or authorized membership server-side. Never trust a user_id supplied by the browser.

School membership is explicit and is managed only by a school admin. A project owner may share a
project only with a registered teacher who belongs to at least one common school; the API checks
this relationship on every grant. `viewer` access never permits course mutation or source upload,
and a missing grant is intentionally represented as `404` to avoid disclosing another teacher's
project.

Shared-question drafts are visible only to their author and school admins. Publishing/rejecting
requires a school-admin membership checked server-side. A published question is copied into a
course with a new id, so editing one course cannot silently modify content in another course.

## Analytics imports

Only a school administrator may import or list K12Online-style reports. The importer accepts only
bounded CSV UTF-8/XLSX input, parses it in memory, rejects a name-only identifier mapping and does
not persist raw report bytes. A dedicated `ANALYTICS_PSEUDONYM_KEY` HMACs learner identifiers
before normalized rows are stored. All school members receive aggregates only; learner-level data
and source identifiers are not API responses or AI inputs. AI summaries, if approved later, must
receive aggregates only and must not make a high-stakes decision.

## Files
- Restrict allowed file types and sizes.
- Generate server-side object keys; do not trust raw filenames as paths.
- Scan/inspect uploads before processing where feasible.
- Use signed URLs or authenticated download endpoints for private assets.

## SCORM/HTML safety
AI or teacher-generated content may contain markup. Sanitize content before injecting into rendered HTML. Avoid arbitrary script execution in authored content.

## Database and backups
- PostgreSQL must not be publicly exposed.
- Encrypt backups before off-site storage.
- Test restore procedures.
- Keep production secrets outside source control.

## Logs
Log IDs and operational metadata, not sensitive content or secrets. Redact Authorization headers, cookies, provider keys and signed URLs.
