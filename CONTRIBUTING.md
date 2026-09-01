# Contributing to AI SCORM Studio

This repository is developed milestone-by-milestone. Keep changes reviewable and do not
implement later milestones opportunistically.

## Before coding

1. Read `AGENTS.md`.
2. Read `CODEX_START_HERE.md`.
3. Check the active milestone in `TASKS.md`.
4. Run:

```bash
python validate_bundle.py
python -m unittest discover -s tests -v
```

## Change rules

- `course.json` / `schemas/course.schema.json` is the domain contract.
- Do not make HTML the source of truth.
- Never commit real API keys, passwords, tokens, R2 credentials, or JWT secrets.
- Do not expose teacher AI credentials to frontend code or browser storage.
- Do not silently change the SCORM/K12Online contract.
- Add or update tests when behavior changes.
- Update documentation when an architectural decision changes.

## Pull request checklist

- [ ] Scope matches one milestone/task.
- [ ] `python validate_bundle.py` passes.
- [ ] Unit tests pass.
- [ ] No secrets are committed.
- [ ] README/docs reflect user-visible or architectural changes.
- [ ] Schema/example remain compatible or migration notes are included.
