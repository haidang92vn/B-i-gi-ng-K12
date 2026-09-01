from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import unittest
from uuid import uuid4

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]


def load_prototype():
    path = ROOT / "prototype/main.py"
    spec = importlib.util.spec_from_file_location("prototype_main_test", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class CourseContractTests(unittest.TestCase):
    def test_example_matches_json_schema(self):
        schema = json.loads((ROOT / "schemas/course.schema.json").read_text(encoding="utf-8"))
        example = json.loads((ROOT / "examples/course.example.json").read_text(encoding="utf-8"))
        Draft202012Validator(schema).validate(example)


class PrototypeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_prototype()

    def test_mock_ai_generates_expected_sections_and_questions(self):
        request = self.module.GenerateRequest(
            title="Phân số bằng nhau",
            source=(
                "Hai phân số bằng nhau biểu diễn cùng một giá trị. "
                "Có thể nhân cả tử số và mẫu số với cùng một số khác 0."
            ),
            direction="lesson",
        )
        result = self.module.make_mock_content(request)
        self.assertEqual(result["direction_name"], "Bài học mới")
        self.assertGreaterEqual(len(result["sections"]), 4)
        self.assertGreaterEqual(len(result["quizzes"]), 1)

    def test_scorm_manifest_has_root_sco(self):
        manifest = self.module.scorm_manifest("Validation")
        self.assertIn("<schemaversion>2004 4th Edition</schemaversion>", manifest)
        self.assertIn('adlcp:scormType="sco"', manifest)
        self.assertIn('href="index.html"', manifest)

    def test_runtime_tracks_core_scorm_2004_fields(self):
        runtime = self.module.runtime_js()
        for token in ["API_1484_11", "Initialize", "SetValue", "Commit", "Terminate"]:
            self.assertIn(token, runtime)

    def test_project_course_persists_and_revision_conflicts_are_rejected(self):
        client = TestClient(self.module.app)
        title = f"Kiểm thử persistence {uuid4()}"
        created = client.post("/api/v1/projects", json={"title": title, "direction": "lesson"})
        self.assertEqual(created.status_code, 201, created.text)
        project = created.json()
        self.assertEqual(project["course"]["metadata"]["title"], title)
        self.assertEqual(project["course"]["revision"], 1)

        updated_course = project["course"]
        updated_course["revision"] = 2
        updated_course["metadata"]["title"] = f"{title} đã sửa"
        updated = client.patch(
            f"/api/v1/projects/{project['id']}",
            json={"expected_revision": 1, "course": updated_course},
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["revision"], 2)

        stale = client.patch(
            f"/api/v1/projects/{project['id']}",
            json={"expected_revision": 1, "course": updated_course},
        )
        self.assertEqual(stale.status_code, 409, stale.text)
        self.assertEqual(stale.json()["detail"]["code"], "COURSE_REVISION_CONFLICT")


if __name__ == "__main__":
    unittest.main()
