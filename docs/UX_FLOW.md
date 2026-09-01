# UX Flow

The 8-step flow is the primary authoring experience. Users may move back to earlier completed steps without losing data.

## Step 1 — Source
Inputs:
- lesson title
- direct text
- later: PDF/DOCX/PPTX uploads

Output to canonical model/source layer:
- project metadata
- normalized source references/content

## Step 2 — Direction
Exactly one primary strategy:
- lesson
- review
- advanced

This choice influences AI prompts and question difficulty distribution; it must not silently change approved teacher content later.

## Step 3 — AI generation
Teacher chooses credential/provider/model where applicable.
AI returns structured data, not free-form HTML.
Show generation status/errors and allow retry.

## Step 4 — Teacher review
Teacher edits objectives, sections/slides and approves content.
Important actions:
- edit
- regenerate one unit
- approve
- add/delete/reorder/duplicate

## Step 5 — Quiz selection
AI question bank is larger than final quiz.
Teacher can:
- select/unselect
- change supported interaction type when semantically valid
- edit scoring/answers/feedback

## Step 6 — Lesson build/preview
Render approved canonical data into a reusable HTML5 player.
Do not create a separate editable HTML document.

## Step 7 — SCORM configuration
Default preset: K12Online / SCORM 2004.
Simple view exposes:
- passing score
- completion percentage
- resume

Advanced view may expose additional supported runtime controls.

## Step 8 — Validate/export
Show validation results before download.
An export is tied to a specific project revision.
If project changes afterward, label the prior export as an older revision rather than mutating it.

## Library/home
After authentication, default landing page should be “My lessons” with:
- recent projects
- status
- updated time
- create lesson
- duplicate/archive/delete
- export history per project
