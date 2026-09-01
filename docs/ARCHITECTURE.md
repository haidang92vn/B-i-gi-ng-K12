# Architecture

## 1. Target system

```text
Browser
  │
  ▼
Cloudflare DNS / HTTPS / optional CDN
  │
  ▼
Reverse Proxy
  │
  ├── Next.js Web
  │
  └── FastAPI API
        │
        ├── PostgreSQL
        ├── Redis
        ├── Worker Queue
        ├── AI Provider Adapters
        └── S3-compatible Object Storage (Cloudflare R2)
```

## 2. Domain model

The persisted course model is versioned JSON conforming to `schemas/course.schema.json`.

Typical flow:

```text
Source material
   ↓
Parser / AI
   ↓
course.json
   ├── Editor
   ├── Quiz editor
   ├── Preview renderer
   ├── Quality checker
   └── SCORM exporter
```

HTML is generated from the course model; HTML is never the canonical authoring format.

## 3. Suggested services/modules

### Web
- Authentication UI
- Project library
- 8-step course wizard
- Course editor
- Quiz editor
- Preview
- Export history
- AI provider settings

### API
- auth
- users
- projects
- course model
- files
- AI orchestration
- quiz
- rendering
- SCORM generation
- validation
- exports

### Worker
Use Redis-backed jobs for work that may take longer than a normal request:
- document parsing
- AI storyboard generation
- large quiz generation
- TTS/media processing
- SCORM packaging
- quality analysis

## 4. Persistence

### PostgreSQL
Suggested tables:
- users
- refresh_tokens or sessions
- projects
- project_versions
- ai_credentials
- files
- question_bank_items
- export_jobs
- scorm_exports
- audit_events

Store the working course model in a JSONB column initially. Normalize only high-value queryable data later.

### Object storage
Use object storage for:
- PDF/DOCX/PPTX source files
- images/audio/video
- generated SCORM ZIP
- encrypted database backups

Suggested object key:

```text
users/{user_id}/projects/{project_id}/source/{file_id}-{name}
users/{user_id}/projects/{project_id}/media/{file_id}-{name}
users/{user_id}/projects/{project_id}/exports/{export_id}.zip
```

## 5. AI provider adapter

Domain code calls a provider-neutral interface, for example:

```python
class AIProvider(Protocol):
    async def generate_structured(self, request: AIRequest, schema: dict) -> dict: ...
```

Provider implementations may include OpenAI, Gemini, Claude, or others. Credentials belong to a teacher account and are decrypted only in backend memory for the request/job.

## 6. Course versioning

Every course model carries:

```json
{
  "schema_version": "1.0.0",
  "revision": 12
}
```

A project edit should update revision. Major schema changes require explicit migrators.

## 7. SCORM

SCORM packaging consumes a validated course model and creates a temporary build directory. The exporter must never mutate the persisted course.

Recommended pipeline:

```text
course.json
  ↓ validate
renderer
  ↓
HTML5 player + quiz assets
  ↓
SCORM runtime
  ↓
imsmanifest.xml
  ↓ validate
ZIP
  ↓
Object storage
```
