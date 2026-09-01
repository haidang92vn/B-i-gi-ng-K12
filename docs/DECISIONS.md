# Product and Architecture Decisions

## Already decided
- Product is a web app for teachers creating SCORM lessons.
- Primary deployment target is K12Online using SCORM 2004.
- UX direction is inspired by the simplicity of iSpring, not a pixel clone.
- Teacher supplies the lesson/source content.
- Teacher chooses one of three AI directions: lesson, review, advanced.
- Teacher uses their own AI API credential.
- AI generates lesson structure/content/question bank.
- Teacher must review before publishing.
- Quiz selection happens after content review.
- SCORM configuration/export happens after lesson rendering.
- Persistent data will be hosted on external infrastructure rather than only the local computer.
- Initial infrastructure direction: external VPS + PostgreSQL + Redis + separate object storage.
- `course.json` is the canonical authoring model.

## Not yet finalized
- Exact AI providers/models to support first.
- Exact SCORM 2004 edition/preset after K12Online compatibility testing.
- Whether authentication is custom JWT/session auth or an external auth service.
- Whether to support organization/school multi-tenancy in MVP.
- Exact renderer behavior for advanced quiz types.
