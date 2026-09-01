"""Repository readiness validator for the AI SCORM Studio starter bundle.

Run before commit:
    python validate_bundle.py

The script intentionally performs deterministic, offline checks only.
"""
from __future__ import annotations

from pathlib import Path
import importlib.util
import json
import tempfile
import zipfile

try:
    from jsonschema import Draft202012Validator
except ImportError as exc:  # pragma: no cover - helpful local error
    raise SystemExit(
        "Missing dependency 'jsonschema'. Run: pip install -r requirements.txt"
    ) from exc

ROOT = Path(__file__).resolve().parent

REQUIRED_FILES = [
    "README.md",
    "AGENTS.md",
    "CODEX_START_HERE.md",
    "TASKS.md",
    "STATUS.md",
    "CONTRIBUTING.md",
    "LICENSE",
    ".env.example",
    ".gitignore",
    "requirements.txt",
    ".github/workflows/validate.yml",
    "docs/ARCHITECTURE.md",
    "docs/API.md",
    "docs/DATABASE.md",
    "docs/SECURITY.md",
    "docs/SCORM.md",
    "docs/DEPLOYMENT.md",
    "docs/DECISIONS.md",
    "docs/UX_FLOW.md",
    "schemas/course.schema.json",
    "examples/course.example.json",
    "prototype/main.py",
    "prototype/requirements.txt",
    "prototype/app/index.html",
    "prototype/app/app.js",
    "prototype/app/styles.css",
]

SECRET_MARKERS = [
    "sk-" + "proj-",
    "sk-" + "live-",
    "BEGIN " + "PRIVATE KEY",
    "AK" + "IA",  # common AWS access key prefix
]


def fail(message: str) -> None:
    raise SystemExit(f"VALIDATION FAILED: {message}")


def check_required_files() -> None:
    missing = [path for path in REQUIRED_FILES if not (ROOT / path).is_file()]
    if missing:
        fail(f"missing required files: {missing}")


def load_json(path: str) -> dict:
    try:
        return json.loads((ROOT / path).read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"invalid JSON in {path}: {exc}")
        raise AssertionError("unreachable")


def check_course_contract() -> None:
    schema = load_json("schemas/course.schema.json")
    course = load_json("examples/course.example.json")

    Draft202012Validator.check_schema(schema)
    errors = sorted(Draft202012Validator(schema).iter_errors(course), key=lambda e: list(e.path))
    if errors:
        details = "; ".join(
            f"{'.'.join(map(str, err.path)) or '<root>'}: {err.message}" for err in errors[:8]
        )
        fail(f"course.example.json does not match schema: {details}")

    if schema["properties"]["schema_version"].get("const") != course.get("schema_version"):
        fail("schema_version constant does not match the example")
    if course["scorm"]["standard"] != "SCORM_2004":
        fail("example course must target SCORM_2004")
    if course["scorm"]["preset"] != "k12online":
        fail("example course must use the k12online preset")


def import_prototype_module():
    module_path = ROOT / "prototype/main.py"
    spec = importlib.util.spec_from_file_location("scorm_studio_prototype", module_path)
    if spec is None or spec.loader is None:
        fail("cannot import prototype/main.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def check_prototype_scorm_package() -> None:
    module = import_prototype_module()
    request = module.ExportRequest(
        title="Validation Course",
        direction="Bài học mới",
        objectives=["Mục tiêu kiểm thử"],
        sections=[{"id": "s1", "title": "Nội dung", "content": "Kiểm thử package."}],
        quizzes=[
            module.QuizItem(
                id="q1",
                question="2 + 2 = ?",
                options=["3", "4"],
                answer="4",
                quiz_type="single",
                selected=True,
            )
        ],
        passing_score=70,
        completion_percent=90,
        resume=True,
    )

    with tempfile.TemporaryDirectory() as temp_dir:
        package = Path(temp_dir) / "validation.zip"
        with zipfile.ZipFile(package, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("imsmanifest.xml", module.scorm_manifest(request.title))
            archive.writestr("index.html", module.build_course_html(request))
            archive.writestr("runtime.js", module.runtime_js())

        with zipfile.ZipFile(package) as archive:
            names = set(archive.namelist())
            required_root = {"imsmanifest.xml", "index.html", "runtime.js"}
            if not required_root.issubset(names):
                fail(f"prototype SCORM zip missing root files: {sorted(required_root - names)}")
            manifest = archive.read("imsmanifest.xml").decode("utf-8")
            runtime = archive.read("runtime.js").decode("utf-8")
            if "SCORM" not in manifest or "scormType=\"sco\"" not in manifest:
                fail("prototype manifest does not declare an SCO resource")
            for token in ("API_1484_11", "Initialize", "SetValue", "Commit", "Terminate"):
                if token not in runtime:
                    fail(f"prototype runtime missing SCORM token: {token}")


def check_no_obvious_secrets() -> None:
    scan_extensions = {".md", ".py", ".json", ".js", ".ts", ".tsx", ".yml", ".yaml", ".example"}
    ignored_parts = {".git", ".venv", "venv", "node_modules", "__pycache__"}
    for path in ROOT.rglob("*"):
        if not path.is_file() or any(part in ignored_parts for part in path.parts):
            continue
        if path.name == ".env.example" or path.suffix in scan_extensions:
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            for marker in SECRET_MARKERS:
                if marker in text:
                    # Documentation may mention the marker as an example only if it is clearly redacted.
                    if marker == "AKIA" and "common AWS access key prefix" in text:
                        continue
                    fail(f"possible secret marker '{marker}' found in {path.relative_to(ROOT)}")


def main() -> None:
    checks = [
        ("required repository files", check_required_files),
        ("course JSON Schema + example", check_course_contract),
        ("prototype SCORM package smoke test", check_prototype_scorm_package),
        ("obvious secret scan", check_no_obvious_secrets),
    ]
    for label, check in checks:
        check()
        print(f"[OK] {label}")
    print("Starter repository validation: OK")


if __name__ == "__main__":
    main()
