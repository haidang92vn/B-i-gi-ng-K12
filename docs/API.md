# API Contract — Directional

Prefix production API with `/api/v1`.

## Authentication
```text
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/me
```

## Projects
```text
GET    /api/v1/projects
POST   /api/v1/projects
GET    /api/v1/projects/{project_id}
PATCH  /api/v1/projects/{project_id}
POST   /api/v1/projects/{project_id}/duplicate
POST   /api/v1/projects/{project_id}/archive
DELETE /api/v1/projects/{project_id}
```

For course updates, require revision/precondition handling to avoid silent overwrite from two tabs.

## School teams and project sharing
```text
GET    /api/v1/schools
POST   /api/v1/schools
GET    /api/v1/schools/{school_id}/members
PUT    /api/v1/schools/{school_id}/members
DELETE /api/v1/schools/{school_id}/members/{user_id}

GET    /api/v1/projects/{project_id}/shares
PUT    /api/v1/projects/{project_id}/shares
DELETE /api/v1/projects/{project_id}/shares/{user_id}
```

School admins manage membership. Project owners can share only with a registered teacher in a
shared school team, with `viewer` or `editor` access. Readers receive no ownership-changing
endpoints; unauthorized access is returned as `404`.

## Source files
```text
POST   /api/v1/projects/{project_id}/sources
GET    /api/v1/projects/{project_id}/sources
DELETE /api/v1/projects/{project_id}/sources/{file_id}
POST   /api/v1/projects/{project_id}/sources/{file_id}/extract
```

## AI credentials
```text
GET    /api/v1/ai/credentials
POST   /api/v1/ai/credentials
PATCH  /api/v1/ai/credentials/{credential_id}
DELETE /api/v1/ai/credentials/{credential_id}
POST   /api/v1/ai/credentials/{credential_id}/test
```

GET must return metadata only, never a stored secret.

## AI generation
```text
POST /api/v1/projects/{project_id}/ai/analyze
POST /api/v1/projects/{project_id}/ai/storyboard
POST /api/v1/projects/{project_id}/ai/questions
POST /api/v1/projects/{project_id}/ai/regenerate-slide/{slide_id}
POST /api/v1/projects/{project_id}/ai/regenerate-question/{question_id}
GET  /api/v1/projects/{project_id}/quality-check
POST /api/v1/projects/{project_id}/quality-check
```

Long operations may return a job id instead of blocking the request.

## Preview / rendering
```text
POST /api/v1/projects/{project_id}/preview
```

Preview may return a temporary render id/url but must render from the current canonical course model.

## SCORM export
```text
POST /api/v1/projects/{project_id}/exports/scorm2004
GET  /api/v1/projects/{project_id}/exports
GET  /api/v1/exports/{export_id}
GET  /api/v1/exports/{export_id}/download
```

The export endpoint validates a specific project revision and stores the revision number with the export.

## Error shape
Use one stable error structure, e.g.:

```json
{
  "error": {
    "code": "COURSE_REVISION_CONFLICT",
    "message": "The project was updated in another session.",
    "details": {}
  }
}
```

Do not expose stack traces or provider secrets in production responses.
