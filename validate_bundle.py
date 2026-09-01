from pathlib import Path
import json

root = Path(__file__).resolve().parent
required = [
    "AGENTS.md", "TASKS.md", ".env.example",
    "docs/ARCHITECTURE.md", "docs/SECURITY.md", "docs/SCORM.md", "docs/DEPLOYMENT.md",
    "schemas/course.schema.json", "examples/course.example.json",
    "prototype/main.py", "prototype/app/index.html"
]
missing = [x for x in required if not (root / x).exists()]
if missing:
    raise SystemExit(f"Missing files: {missing}")

schema = json.loads((root / "schemas/course.schema.json").read_text(encoding="utf-8"))
course = json.loads((root / "examples/course.example.json").read_text(encoding="utf-8"))
assert schema["properties"]["schema_version"]["const"] == course["schema_version"]
assert course["metadata"]["direction"] in {"lesson", "review", "advanced"}
assert course["scorm"]["standard"] == "SCORM_2004"
print("Starter bundle basic validation: OK")
