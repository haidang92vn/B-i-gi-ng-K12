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

## Authorization
Every project/file/export/credential endpoint must verify ownership or authorized membership server-side. Never trust a user_id supplied by the browser.

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
