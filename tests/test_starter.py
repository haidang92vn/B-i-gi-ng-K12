from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import unittest
from uuid import uuid4

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from prototype.course_models import Question
from prototype.quiz_scoring import score_question
from prototype.scorm_runtime import FakeScorm2004API, ScormRuntime

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

    def test_quiz_scoring_is_deterministic(self):
        def question(kind, correct):
            return Question(id="q", type=kind, question="Kiểm tra", selected=True, score=2,
                            difficulty="understand", correct_answer=correct)
        self.assertEqual(score_question(question("single", "Đáp án A"), " đáp án a "), (True, 2))
        self.assertEqual(score_question(question("multiple", ["A", "C"]), ["c", "a"]), (True, 2))
        self.assertEqual(score_question(question("multiple", ["A", "C"]), ["A"]), (False, 0.0))
        self.assertEqual(score_question(question("fill", "Quang hợp"), "quang HỢP"), (True, 2))
        self.assertEqual(score_question(question("matching", {"A": "1", "B": "2"}), {"b": "2", "a": "1"}), (True, 2))
        self.assertEqual(score_question(question("ordering", ["Một", "Hai"]), ["Hai", "Một"]), (False, 0.0))

    def test_scorm_runtime_harness_keeps_completion_and_success_independent(self):
        api = FakeScorm2004API()
        runtime = ScormRuntime(api, completion_percent=90, passing_score=70)
        runtime.initialize()
        runtime.view_slide(location=7, total_slides=10)
        self.assertEqual(api.GetValue("cmi.completion_status"), "incomplete")
        runtime.submit_score(80)
        self.assertEqual(api.GetValue("cmi.success_status"), "passed")
        self.assertEqual(api.GetValue("cmi.completion_status"), "incomplete")
        runtime.view_slide(location=9, total_slides=10)
        self.assertEqual(runtime.resume(), {"location": 9})
        self.assertEqual(api.GetValue("cmi.completion_status"), "completed")
        runtime.finish(61)
        self.assertEqual(api.GetValue("cmi.session_time"), "PT0H1M1S")
        self.assertTrue(api.terminated)


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

    def test_regenerates_only_draft_slide_and_records_metadata(self):
        client = TestClient(self.module.app)
        client.post("/api/v1/auth/register", json={"email": f"teacher-{uuid4()}@example.test", "password": "a-secure-test-password"})
        generated = client.post("/api/generate", json={"title": "Bài kiểm thử", "source": "Nội dung một. Nội dung hai.", "provider": "mock"})
        self.assertEqual(generated.status_code, 200, generated.text)
        generated_data = generated.json()
        project = client.post("/api/v1/projects", json={"title": "Bài kiểm thử", "direction": "lesson", "course": generated_data["course"], "generation_id": generated_data["generation"]["id"]})
        self.assertEqual(project.status_code, 201, project.text)
        before = project.json()
        first_slide_id = before["course"]["slides"][0]["id"]
        untouched_slide = before["course"]["slides"][1]
        regenerated = client.post(f"/api/v1/projects/{before['id']}/slides/{first_slide_id}/regenerate", json={"source": "Nội dung thay thế. Có thêm ví dụ mới.", "provider": "mock", "expected_revision": 1})
        self.assertEqual(regenerated.status_code, 200, regenerated.text)
        after = regenerated.json()
        self.assertEqual(after["revision"], 2)
        self.assertEqual(after["course"]["slides"][1], untouched_slide)
        self.assertIn("Nội dung thay thế", after["course"]["slides"][0]["blocks"][0]["text"])

        approved = after["course"]
        approved["revision"] = 3
        approved["slides"][0]["status"] = "approved"
        saved = client.patch(f"/api/v1/projects/{before['id']}", json={"expected_revision": 2, "course": approved})
        self.assertEqual(saved.status_code, 200, saved.text)
        rejected = client.post(f"/api/v1/projects/{before['id']}/slides/{first_slide_id}/regenerate", json={"source": "Không được ghi đè.", "provider": "mock", "expected_revision": 3})
        self.assertEqual(rejected.status_code, 409, rejected.text)

    def test_slide_reorder_persists_with_revision_protection(self):
        client = TestClient(self.module.app)
        client.post("/api/v1/auth/register", json={"email": f"teacher-{uuid4()}@example.test", "password": "a-secure-test-password"})
        generated = client.post("/api/generate", json={"title": "Bài sắp xếp", "source": "Ý một. Ý hai.", "provider": "mock"}).json()
        project = client.post("/api/v1/projects", json={"title": "Bài sắp xếp", "direction": "lesson", "course": generated["course"]}).json()
        reordered = project["course"]
        original_ids = [slide["id"] for slide in reordered["slides"]]
        reordered["slides"] = list(reversed(reordered["slides"]))
        reordered["revision"] = 2
        saved = client.patch(f"/api/v1/projects/{project['id']}", json={"expected_revision": 1, "course": reordered})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual([slide["id"] for slide in saved.json()["course"]["slides"]], list(reversed(original_ids)))
        stale = client.patch(f"/api/v1/projects/{project['id']}", json={"expected_revision": 1, "course": reordered})
        self.assertEqual(stale.status_code, 409, stale.text)

    def test_quiz_selection_and_authoring_fields_persist(self):
        client = TestClient(self.module.app)
        client.post("/api/v1/auth/register", json={"email": f"teacher-{uuid4()}@example.test", "password": "a-secure-test-password"})
        generated = client.post("/api/generate", json={"title": "Bài Quiz", "source": "Ý một. Ý hai.", "provider": "mock"}).json()
        project = client.post("/api/v1/projects", json={"title": "Bài Quiz", "direction": "lesson", "course": generated["course"]}).json()
        course = project["course"]
        course["revision"] = 2
        question = course["question_bank"][0]
        question.update({"selected": False, "score": 2.5, "difficulty": "apply", "objective_ids": ["o1"], "explanation": "Vì đây là ý chính.", "feedback_correct": "Tốt.", "feedback_incorrect": "Xem lại nội dung."})
        saved = client.patch(f"/api/v1/projects/{project['id']}", json={"expected_revision": 1, "course": course})
        self.assertEqual(saved.status_code, 200, saved.text)
        restored = client.get(f"/api/v1/projects/{project['id']}").json()["course"]["question_bank"][0]
        self.assertFalse(restored["selected"])
        self.assertEqual(restored["score"], 2.5)
        self.assertEqual(restored["objective_ids"], ["o1"])
        self.assertEqual(restored["feedback_correct"], "Tốt.")

    def test_player_renders_canonical_project_and_escapes_authored_html(self):
        client = TestClient(self.module.app)
        client.post("/api/v1/auth/register", json={"email": f"teacher-{uuid4()}@example.test", "password": "a-secure-test-password"})
        generated = client.post("/api/generate", json={"title": "Bài player", "source": "<script>alert('x')</script> Nội dung an toàn.", "provider": "mock"}).json()
        project = client.post("/api/v1/projects", json={"title": "Bài player", "direction": "lesson", "course": generated["course"]}).json()
        player = client.get(f"/api/v1/projects/{project['id']}/player")
        self.assertEqual(player.status_code, 200, player.text)
        self.assertIn("Toàn màn hình", player.text)
        self.assertIn("navigationMode", player.text)
        self.assertIn("&lt;script&gt;alert", player.text)

    def test_project_course_persists_and_revision_conflicts_are_rejected(self):
        client = TestClient(self.module.app)
        title = f"Kiểm thử persistence {uuid4()}"
        registered = client.post("/api/v1/auth/register", json={
            "email": f"teacher-{uuid4()}@example.test", "password": "a-secure-test-password",
            "full_name": "Giáo viên kiểm thử",
        })
        self.assertEqual(registered.status_code, 201, registered.text)
        secret = "sk-test-secret-value-1234"
        credential = client.post("/api/v1/ai/credentials", json={"provider": "openai", "secret": secret, "label": "Test key"})
        self.assertEqual(credential.status_code, 201, credential.text)
        self.assertNotIn(secret, credential.text)
        self.assertEqual(credential.json()["secret_last4"], "1234")
        self.assertNotIn("encrypted_secret", client.get("/api/v1/ai/credentials").text)
        renamed = client.patch(f"/api/v1/ai/credentials/{credential.json()['id']}", json={"label": "Đã đổi tên", "model_default": "test-model"})
        self.assertEqual(renamed.status_code, 200, renamed.text)
        self.assertNotIn(secret, renamed.text)
        mock_generated = client.post("/api/generate", json={"title": title, "source": "Nội dung kiểm thử. Có ví dụ.", "provider": "mock"})
        self.assertEqual(mock_generated.status_code, 200, mock_generated.text)
        self.assertIn("course", mock_generated.json())

        request = self.module.GenerateRequest(title=title, source="Nguồn kiểm thử có đủ ngữ cảnh.", provider="openai")
        attempts = [{"unexpected": "shape"}, self.module.make_mock_content(request)["course"]]
        class RetryingProvider:
            def generate_structured(self, **kwargs): return attempts.pop(0)
        original_provider_for = self.module.provider_for
        self.module.provider_for = lambda *args, **kwargs: RetryingProvider()
        try:
            generated = self.module.generate_real_content(request, self.module.AICredential(
                user_id="test-user", provider="openai", encrypted_secret=self.module.encrypt(secret), secret_last4="1234"))
        finally:
            self.module.provider_for = original_provider_for
        self.assertEqual(generated["course"]["metadata"]["title"], title)
        self.assertEqual(attempts, [])
        created = client.post("/api/v1/projects", json={"title": title, "direction": "lesson"})
        self.assertEqual(created.status_code, 201, created.text)
        project = created.json()
        self.assertEqual(project["course"]["metadata"]["title"], title)
        self.assertEqual(project["course"]["revision"], 1)
        uploaded = client.post(f"/api/v1/projects/{project['id']}/sources", files={"upload": ("lesson.txt", b"Noi dung bai hoc", "text/plain")})
        self.assertEqual(uploaded.status_code, 201, uploaded.text)
        self.assertEqual(uploaded.json()["extracted_text"], "Noi dung bai hoc")

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

        other_client = TestClient(self.module.app)
        other_client.post("/api/v1/auth/register", json={
            "email": f"teacher-{uuid4()}@example.test", "password": "another-secure-password",
        })
        forbidden = other_client.get(f"/api/v1/projects/{project['id']}")
        self.assertEqual(forbidden.status_code, 404, forbidden.text)
        self.assertEqual(other_client.get(f"/api/v1/projects/{project['id']}/sources").json(), [])


if __name__ == "__main__":
    unittest.main()
