# Codex Prompt 10 — SCORM packager, validator and K12Online preset

Implement backend SCORM packaging from a validated course model.

Requirements:
- generate `imsmanifest.xml`;
- include player/runtime/assets;
- manifest at ZIP root;
- validate file references, launch resource, quiz/completion configuration and archive structure;
- invalid packages cannot be marked ready;
- save exports to object storage and metadata to DB;
- implement a K12Online preset without hiding advanced settings;
- create a manual LMS compatibility test document for every runtime-affecting release.
