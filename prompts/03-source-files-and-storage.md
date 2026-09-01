# Codex Prompt 03 — Source files and object storage

Implement source material upload and S3-compatible storage.

Requirements:
- object-storage abstraction compatible with Cloudflare R2;
- uploads for PDF, DOCX and PPTX plus direct text input;
- DB stores metadata/object key, not large file bytes;
- normalize extracted text into project source material;
- file type/size validation and safe object naming;
- authenticated access to private files;
- automated tests using a local/mock S3-compatible test strategy where practical.

Do not expose object-storage secrets to the browser.
