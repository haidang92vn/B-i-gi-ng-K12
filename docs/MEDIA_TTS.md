# Media and TTS (Milestone 12.4)

## Authoring flow

At step 6, the teacher selects a slide and can create an image, create per-slide TTS,
upload a file, or register a public HTTPS media URL. Each operation first creates a private
**draft media asset** for preview. It becomes part of the lesson only after the teacher chooses
**Gắn vào slide**. The canonical course data then receives a `Block` with the media `asset_id`;
the Next.js Step 6 screen uses this exact API workflow and refreshes the embedded canonical player
after attachment. The media bytes remain in object storage;
the binary object itself is never persisted in generated HTML or `course.json`.

OpenAI and Gemini are isolated behind the server-side media-provider adapter. Their stored API
credentials remain encrypted and are never returned to the browser. The `mock` adapter provides
an image and a short WAV file for the demo without a credential. Real-provider availability,
model names, quotas and voice availability must be checked against the teacher's own account at
the time of use; both Gemini image/TTS models are preview services and may change.

## Safety and rights controls

- Uploads need an explicit rights confirmation. Accepted files are JPEG, PNG, WebP, GIF, MP3,
  WAV, OGG, M4A, MP4 and WebM. The server checks extension, declared MIME type, a basic file
  signature and size before storing to the configured R2-compatible private bucket.
- Limits are 10 MB for images, 25 MB for audio and 200 MB for video. They are authoring limits,
  not evidence of copyright ownership. The school remains responsible for licensing, consent,
  accessibility descriptions and consent for any voice used.
- URLs require the same rights confirmation and must be public HTTPS addresses. Local/private IP
  targets and URLs with embedded credentials are rejected; the server never fetches an arbitrary
  URL, preventing SSRF. The teacher must still verify that the LMS can reach it.
- A video over 25 MB gets a SCORM ZIP weight warning. Uploaded/generated content is copied into
  `assets/` inside the SCORM ZIP; a URL stays external and is deliberately not copied.

## SCORM behavior and deployment

The player renders image, audio and video blocks from canonical asset references. Preview reads
private content through an authenticated API route. SCORM exports package stored media and list
each asset in `imsmanifest.xml`; external URLs remain runtime dependencies. Export metadata keeps
any media warnings. Before production release, test a representative package (including video)
on the target K12Online tenant because its content-security policy and external-media allowance
are tenant configuration concerns.

Apply Alembic revision `20260902_14` before deploying this feature.
