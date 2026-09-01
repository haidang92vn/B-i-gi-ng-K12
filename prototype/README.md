# Prototype

This is the original runnable proof-of-concept. It demonstrates the 8-step workflow and can generate a minimal SCORM ZIP.

It is not the target production architecture.

Run:

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

Open `http://127.0.0.1:8000`.

Codex should preserve this as a regression reference until replacement functionality exists.
