# Codex Prompt 05 — AI lesson analysis and storyboard

Use the provider adapter to implement three generation strategies:
- lesson
- review
- advanced

Generate structured objectives, slides/blocks and a larger question bank than the number selected for the final quiz.

Requirements:
- output must validate to the canonical course model;
- support regeneration of one slide/section/question without regenerating the full course;
- teacher edits already marked approved must not be silently overwritten;
- store generation metadata such as provider/model/request id/token usage when available, but never store secrets.
