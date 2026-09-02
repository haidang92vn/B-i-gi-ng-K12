from __future__ import annotations

import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from uuid import uuid4
import zipfile

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from openpyxl import Workbook
from prototype.course_models import Block, Question, Slide, new_course
from prototype.quiz_scoring import score_question
from prototype.scorm_runtime import FakeScorm2004API, ScormRuntime
from prototype.logging_config import redact
from prototype.onboarding import ProvisioningError, provision_school_admin
from prototype.google_oauth import GoogleProfile, decode_attempt
from prototype.persistence import database_url
from prototype.quality import analyze_course

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
        self.assertEqual(score_question(question("dragdrop", ["Bước 1", "Bước 2"]), ["bước 1", "Bước 2"]), (True, 2))
        self.assertEqual(score_question(question("image", "img-2"), "IMG-2"), (True, 2))

    def test_player_renders_dragdrop_and_asset_backed_image_quizzes(self):
        course = new_course("Tương tác")
        course.question_bank = [
            Question(id="drag", type="dragdrop", question="Sắp xếp các bước theo thứ tự.", options=["Bước 1", "Bước 2"], correct_answer=["Bước 1", "Bước 2"], selected=True, score=1, difficulty="apply"),
            Question(id="image", type="image", question="Chọn đúng hình minh họa.", correct_answer="img-2", selected=True, score=1, difficulty="recognize", settings={"image_options": [{"id": "img-1", "asset_id": "asset-1", "label": "Ảnh một"}, {"id": "img-2", "asset_id": "asset-2", "label": "Ảnh hai"}]}),
        ]
        module = load_prototype()
        request = module.export_request_from_course(course, {"asset-1": {"kind": "image", "src": "assets/asset-1.png", "label": "Ảnh một"}, "asset-2": {"kind": "image", "src": "assets/asset-2.png", "label": "Ảnh hai"}})
        player = module.build_course_html(request)
        self.assertIn('class="drag-token"', player)
        self.assertIn('class="drop-zone"', player)
        self.assertIn('src="assets/asset-2.png"', player)
        self.assertIn('sameAnswer(type,value,answer)', player)

    def test_player_honours_quiz_completion_navigation_and_progress_settings(self):
        module = load_prototype()
        request = module.ExportRequest(
            title="Player policy", direction="lesson", objectives=[], sections=[{"title": "Một", "content": "Nội dung"}],
            quizzes=[module.QuizItem(id="match", question="Ghép các cặp tương ứng.", quiz_type="matching", answer={"A": "1", "B": "2"}, options=["1", "2"], selected=True), module.QuizItem(id="order", question="Sắp xếp đúng thứ tự.", quiz_type="ordering", answer=["Một", "Hai"], options=["Một", "Hai"], selected=True)],
            navigation_mode="restricted", show_menu=False, require_quiz=True,
        )
        player = module.build_course_html(request)
        self.assertIn('data-match-left="A"', player)
        self.assertIn('data-type="ordering"', player)
        self.assertIn('document.querySelector(".progress").hidden = !CFG.showProgress', player)
        self.assertIn('(!CFG.requireQuiz || quizSubmitted)', player)
        self.assertIn('CFG.navigationMode === "restricted"', player)

    def test_quality_checker_flags_incomplete_image_quiz(self):
        course = new_course("Ảnh thiếu asset")
        course.question_bank = [Question(id="image", type="image", question="Chọn đúng hình minh họa cho kiến thức.", correct_answer="img-1", selected=True, score=1, difficulty="recognize", settings={"image_options": [{"id": "img-1", "asset_id": "missing", "label": "Ảnh một"}]})]
        codes = {item["code"] for item in analyze_course(course)["findings"]}
        self.assertIn("QUESTION_IMAGE_OPTIONS_MISSING", codes)

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
        self.assertEqual(runtime.resume(), {"location": 9, "highestVisited": 9})
        self.assertEqual(api.GetValue("cmi.completion_status"), "completed")
        runtime.finish(61)
        self.assertEqual(api.GetValue("cmi.session_time"), "PT0H1M1S")
        self.assertTrue(api.terminated)

    def test_scorm_runtime_requires_quiz_and_handles_bad_resume_data(self):
        api = FakeScorm2004API(values={"cmi.suspend_data": "not-json"})
        runtime = ScormRuntime(api, completion_percent=90, passing_score=70, require_quiz=True)
        runtime.initialize()
        self.assertEqual(runtime.resume(), {})
        runtime.view_slide(location=9, total_slides=10)
        self.assertEqual(api.GetValue("cmi.completion_status"), "incomplete")
        runtime.submit_score(65)
        self.assertEqual(api.GetValue("cmi.success_status"), "failed")
        self.assertEqual(api.GetValue("cmi.completion_status"), "completed")
        self.assertEqual(runtime.resume(), {"location": 9, "highestVisited": 9})
        runtime.finish(-10)
        self.assertEqual(api.GetValue("cmi.session_time"), "PT0H0M0S")

    def test_quality_checker_identifies_fixable_slide_and_question_issues(self):
        course = new_course("Kiểm tra chất lượng")
        course.slides = [Slide(id="s1", title="Dày chữ", layout="content", status="ai_draft", blocks=[
            Block(id="b1", type="text", text="Nội dung " * 150),
        ])]
        course.question_bank = [Question(
            id="q1", type="multiple", question="Ngắn", selected=True, score=0,
            difficulty="understand", correct_answer="A", options=["A", "A"],
        )]
        report = analyze_course(course)
        codes = {item["code"] for item in report["findings"]}
        self.assertFalse(report["blocking"])
        self.assertIn("SLIDE_TEXT_VERY_DENSE", codes)
        self.assertIn("SLIDE_NOT_REVIEWED", codes)
        self.assertIn("QUESTION_OPTIONS_DUPLICATE", codes)
        self.assertIn("QUESTION_MULTIPLE_ANSWER_FORMAT", codes)


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

    def test_health_and_readiness_are_available_for_deployment_probes(self):
        client = TestClient(self.module.app)
        self.assertEqual(client.get("/healthz").json(), {"status": "ok"})
        readiness = client.get("/readyz")
        self.assertEqual(readiness.status_code, 200, readiness.text)
        self.assertEqual(readiness.json()["dependencies"]["database"], "ok")

    def test_owned_project_quality_endpoint_returns_advisory_report(self):
        client = TestClient(self.module.app)
        client.post("/api/v1/auth/register", json={"email": f"quality-{uuid4()}@example.test", "password": "a-secure-test-password"})
        generated = client.post("/api/generate", json={"title": "Bài chất lượng", "source": "Một nội dung kiểm tra.", "provider": "mock"}).json()
        project = client.post("/api/v1/projects", json={"title": "Bài chất lượng", "direction": "lesson", "course": generated["course"]}).json()
        response = client.get(f"/api/v1/projects/{project['id']}/quality-check")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["course_id"], project["course"]["id"])
        self.assertFalse(response.json()["blocking"])

    def test_media_tts_preview_attaches_to_course_and_packages_in_scorm(self):
        client = TestClient(self.module.app)
        client.post("/api/v1/auth/register", json={"email": f"media-{uuid4()}@example.test", "password": "a-secure-test-password"})
        generated = client.post("/api/generate", json={"title": "Bài media", "source": "Nguồn học liệu cho media.", "provider": "mock"}).json()
        project = client.post("/api/v1/projects", json={"title": "Bài media", "direction": "lesson", "course": generated["course"]}).json()
        slide_id = project["course"]["slides"][0]["id"]

        preview = client.post(f"/api/v1/projects/{project['id']}/slides/{slide_id}/tts", json={"text": "Nội dung để nghe thử.", "provider": "mock"})
        self.assertEqual(preview.status_code, 201, preview.text)
        asset = preview.json()
        self.assertEqual(asset["status"], "draft")
        content = client.get(asset["content_url"])
        self.assertEqual(content.status_code, 200, content.text)
        self.assertTrue(content.content.startswith(b"RIFF"))

        attached = client.post(f"/api/v1/projects/{project['id']}/slides/{slide_id}/media", json={"asset_id": asset["id"], "expected_revision": 1})
        self.assertEqual(attached.status_code, 200, attached.text)
        self.assertEqual(attached.json()["revision"], 2)
        self.assertIn(asset["id"], {block.get("asset_id") for block in attached.json()["course"]["slides"][0]["blocks"]})
        self.assertIn(asset["content_url"], client.get(f"/api/v1/projects/{project['id']}/player").text)

        exported = client.post("/api/export-scorm", json={"title": "Bài media", "direction": "lesson", "objectives": [], "sections": [], "quizzes": [], "project_id": project["id"]})
        self.assertEqual(exported.status_code, 200, exported.text)
        with zipfile.ZipFile(io.BytesIO(exported.content)) as package:
            names = set(package.namelist())
            self.assertIn("imsmanifest.xml", names)
            self.assertIn(f"assets/{asset['id']}.wav", names)
            self.assertIn(f"assets/{asset['id']}.wav", package.read("imsmanifest.xml").decode())
            self.assertIn(f"assets/{asset['id']}.wav", package.read("index.html").decode())

    def test_media_upload_and_url_require_safe_type_and_rights_confirmation(self):
        client = TestClient(self.module.app)
        client.post("/api/v1/auth/register", json={"email": f"media-check-{uuid4()}@example.test", "password": "a-secure-test-password"})
        generated = client.post("/api/generate", json={"title": "Bài kiểm media", "source": "Nguồn học liệu.", "provider": "mock"}).json()
        project = client.post("/api/v1/projects", json={"title": "Bài kiểm media", "direction": "lesson", "course": generated["course"]}).json()
        slide_id = project["course"]["slides"][0]["id"]
        rejected = client.post(f"/api/v1/projects/{project['id']}/media/upload", params={"slide_id": slide_id, "rights_confirmed": "false"}, files={"upload": ("fake.png", b"not-a-png", "image/png")})
        self.assertEqual(rejected.status_code, 422, rejected.text)
        unsafe_url = client.post(f"/api/v1/projects/{project['id']}/media/url", params={"slide_id": slide_id}, json={"kind": "image", "url": "https://127.0.0.1/private.png", "label": "Nội bộ", "rights_confirmed": True})
        self.assertEqual(unsafe_url.status_code, 422, unsafe_url.text)

    def test_external_media_url_is_not_copied_into_scorm_zip(self):
        client = TestClient(self.module.app)
        client.post("/api/v1/auth/register", json={"email": f"media-url-{uuid4()}@example.test", "password": "a-secure-test-password"})
        generated = client.post("/api/generate", json={"title": "Bài URL", "source": "Nguồn học liệu.", "provider": "mock"}).json()
        project = client.post("/api/v1/projects", json={"title": "Bài URL", "direction": "lesson", "course": generated["course"]}).json()
        slide_id = project["course"]["slides"][0]["id"]
        asset = client.post(f"/api/v1/projects/{project['id']}/media/url", params={"slide_id": slide_id}, json={"kind": "image", "url": "https://media.example.test/lesson.png", "label": "Minh họa ngoài", "rights_confirmed": True})
        self.assertEqual(asset.status_code, 201, asset.text)
        self.assertEqual(client.post(f"/api/v1/projects/{project['id']}/slides/{slide_id}/media", json={"asset_id": asset.json()["id"], "expected_revision": 1}).status_code, 200)
        exported = client.post("/api/export-scorm", json={"title": "Bài URL", "direction": "lesson", "objectives": [], "sections": [], "quizzes": [], "project_id": project["id"]})
        self.assertEqual(exported.status_code, 200, exported.text)
        self.assertEqual(exported.headers["X-SCORM-Warning-Count"], "1")
        with zipfile.ZipFile(io.BytesIO(exported.content)) as package:
            self.assertEqual([name for name in package.namelist() if name.startswith("assets/")], [])
            self.assertIn("https://media.example.test/lesson.png", package.read("index.html").decode())

    def test_log_redaction_hides_common_secret_shapes(self):
        line = redact("Authorization: Bearer secret-value Cookie: session=abc api_key=sk-123456789")
        self.assertNotIn("secret-value", line)
        self.assertNotIn("session=abc", line)
        self.assertNotIn("sk-123456789", line)

    def test_production_requires_explicit_postgres_database_url(self):
        with patch.dict(os.environ, {"APP_ENV": "production"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "DATABASE_URL"):
                database_url()

    def test_scorm_manifest_has_root_sco(self):
        manifest = self.module.scorm_manifest("Validation")
        self.assertIn("<schemaversion>2004 4th Edition</schemaversion>", manifest)
        self.assertIn('adlcp:scormType="sco"', manifest)
        self.assertIn('href="index.html"', manifest)

    def test_scorm_validator_rejects_missing_or_unsafe_files(self):
        files = {"imsmanifest.xml": b"<manifest><resource href='file:///bad'/></manifest>", "index.html": b"", "runtime.js": b""}
        errors = self.module.validate_scorm_package(files, passing_score=101, completion_percent=90)
        self.assertTrue(any("Passing score" in error for error in errors))
        self.assertTrue(any("Unsafe manifest" in error for error in errors))

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

        generated_for_draft = client.post("/api/generate", json={"title": title, "source": "Noi dung da tai len.", "provider": "mock"})
        self.assertEqual(generated_for_draft.status_code, 200, generated_for_draft.text)
        generated_course = generated_for_draft.json()["course"]
        generated_course["id"] = project["id"]
        generated_course["revision"] = 2
        populated_draft = client.patch(
            f"/api/v1/projects/{project['id']}",
            json={"expected_revision": 1, "course": generated_course, "generation_id": generated_for_draft.json()["generation"]["id"]},
        )
        self.assertEqual(populated_draft.status_code, 200, populated_draft.text)
        self.assertEqual(populated_draft.json()["id"], project["id"])
        self.assertEqual(populated_draft.json()["revision"], 2)

        updated_course = populated_draft.json()["course"]
        updated_course["revision"] = 3
        updated_course["metadata"]["title"] = f"{title} đã sửa"
        updated = client.patch(
            f"/api/v1/projects/{project['id']}",
            json={"expected_revision": 2, "course": updated_course},
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["revision"], 3)

        stale = client.patch(
            f"/api/v1/projects/{project['id']}",
            json={"expected_revision": 2, "course": updated_course},
        )
        self.assertEqual(stale.status_code, 409, stale.text)
        self.assertEqual(stale.json()["detail"]["code"], "COURSE_REVISION_CONFLICT")

        other_client = TestClient(self.module.app)
        other_client.post("/api/v1/auth/register", json={
            "email": f"teacher-{uuid4()}@example.test", "password": "another-secure-password",
        })
        forbidden = other_client.get(f"/api/v1/projects/{project['id']}")
        self.assertEqual(forbidden.status_code, 404, forbidden.text)
        self.assertEqual(other_client.get(f"/api/v1/projects/{project['id']}/sources").status_code, 404)

    def test_school_admin_can_share_view_or_edit_access_only_with_school_members(self):
        admin = TestClient(self.module.app)
        collaborator = TestClient(self.module.app)
        outsider = TestClient(self.module.app)
        admin_email = f"admin-{uuid4()}@example.test"
        collaborator_email = f"teacher-{uuid4()}@example.test"
        outsider_email = f"outsider-{uuid4()}@example.test"
        for client, email in ((admin, admin_email), (collaborator, collaborator_email), (outsider, outsider_email)):
            response = client.post("/api/v1/auth/register", json={"email": email, "password": "a-secure-test-password"})
            self.assertEqual(response.status_code, 201, response.text)

        school = admin.post("/api/v1/schools", json={"name": f"Trường kiểm thử {uuid4()}"}).json()
        member = admin.put(f"/api/v1/schools/{school['id']}/members", json={"email": collaborator_email, "role": "teacher"})
        self.assertEqual(member.status_code, 200, member.text)
        self.assertEqual(collaborator.put(f"/api/v1/schools/{school['id']}/members", json={"email": outsider_email, "role": "teacher"}).status_code, 403)

        generated = admin.post("/api/generate", json={"title": "Bài chia sẻ", "source": "Nguồn bài học.", "provider": "mock"}).json()
        project = admin.post("/api/v1/projects", json={"title": "Bài chia sẻ", "direction": "lesson", "course": generated["course"]}).json()
        cannot_share = admin.put(f"/api/v1/projects/{project['id']}/shares", json={"email": outsider_email, "access_level": "viewer"})
        self.assertEqual(cannot_share.status_code, 422, cannot_share.text)
        viewer = admin.put(f"/api/v1/projects/{project['id']}/shares", json={"email": collaborator_email, "access_level": "viewer"})
        self.assertEqual(viewer.status_code, 200, viewer.text)

        shared_project = collaborator.get(f"/api/v1/projects/{project['id']}")
        self.assertEqual(shared_project.status_code, 200, shared_project.text)
        self.assertEqual(shared_project.json()["access_level"], "viewer")
        course = shared_project.json()["course"]
        course["revision"] = 2
        self.assertEqual(collaborator.patch(f"/api/v1/projects/{project['id']}", json={"expected_revision": 1, "course": course}).status_code, 403)

        editor = admin.put(f"/api/v1/projects/{project['id']}/shares", json={"email": collaborator_email, "access_level": "editor"})
        self.assertEqual(editor.status_code, 200, editor.text)
        updated = collaborator.patch(f"/api/v1/projects/{project['id']}", json={"expected_revision": 1, "course": course})
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["access_level"], "editor")
        admin_user = admin.get("/api/v1/me").json()
        collaborator_user = collaborator.get("/api/v1/me").json()
        self.assertEqual(admin.delete(f"/api/v1/schools/{school['id']}/members/{admin_user['id']}").status_code, 409)
        self.assertEqual(admin.delete(f"/api/v1/schools/{school['id']}/members/{collaborator_user['id']}").status_code, 204)
        self.assertEqual(collaborator.get(f"/api/v1/projects/{project['id']}").status_code, 404)

    def test_shared_question_requires_review_before_school_library_use(self):
        admin = TestClient(self.module.app)
        teacher = TestClient(self.module.app)
        outsider = TestClient(self.module.app)
        admin_email = f"admin-library-{uuid4()}@example.test"
        teacher_email = f"teacher-library-{uuid4()}@example.test"
        for client, email in ((admin, admin_email), (teacher, teacher_email), (outsider, f"outside-library-{uuid4()}@example.test")):
            response = client.post("/api/v1/auth/register", json={"email": email, "password": "a-secure-test-password"})
            self.assertEqual(response.status_code, 201, response.text)

        school = admin.post("/api/v1/schools", json={"name": f"Trường thư viện {uuid4()}"}).json()
        member = admin.put(f"/api/v1/schools/{school['id']}/members", json={"email": teacher_email, "role": "teacher"})
        self.assertEqual(member.status_code, 200, member.text)
        generated = teacher.post("/api/generate", json={"title": "Bài có câu hỏi", "source": "Nguồn học liệu.", "provider": "mock"}).json()
        project = teacher.post("/api/v1/projects", json={"title": "Bài có câu hỏi", "direction": "lesson", "course": generated["course"]}).json()
        question_id = project["course"]["question_bank"][0]["id"]
        draft = teacher.post(
            f"/api/v1/projects/{project['id']}/questions/{question_id}/shared-draft",
            json={"school_id": school["id"], "subject": "Toán", "grade": "Lớp 5", "topic": "Phân số", "learning_objectives": ["Nhận biết phân số bằng nhau"]},
        )
        self.assertEqual(draft.status_code, 201, draft.text)
        self.assertEqual(draft.json()["status"], "draft")
        self.assertEqual(outsider.get("/api/v1/shared-questions", params={"school_id": school["id"]}).status_code, 404)
        self.assertEqual(teacher.get("/api/v1/shared-questions", params={"school_id": school["id"]}).json()[0]["status"], "draft")
        submitted = teacher.post(f"/api/v1/shared-questions/{draft.json()['id']}/submit")
        self.assertEqual(submitted.status_code, 200, submitted.text)
        self.assertEqual(teacher.post(f"/api/v1/shared-questions/{draft.json()['id']}/review", json={"decision": "published"}).status_code, 403)
        published = admin.post(f"/api/v1/shared-questions/{draft.json()['id']}/review", json={"decision": "published"})
        self.assertEqual(published.status_code, 200, published.text)
        self.assertEqual(published.json()["reviewed_by_user_id"], admin.get("/api/v1/me").json()["id"])

        imported = teacher.post(
            f"/api/v1/projects/{project['id']}/shared-questions/{draft.json()['id']}/add",
            json={"expected_revision": 1, "selected": True},
        )
        self.assertEqual(imported.status_code, 200, imported.text)
        self.assertEqual(imported.json()["revision"], 2)
        self.assertEqual(len(imported.json()["course"]["question_bank"]), len(project["course"]["question_bank"]) + 1)
        admin_draft = admin.post("/api/v1/shared-questions", json={
            "school_id": school["id"], "subject": "Toán", "grade": "Lớp 5", "topic": "Số học",
            "learning_objectives": ["Củng cố phép tính"],
            "question": {"type": "single", "question": "2 + 2 bằng bao nhiêu?", "difficulty": "recognize", "correct_answer": "4", "options": ["3", "4"]},
        })
        self.assertEqual(admin_draft.status_code, 201, admin_draft.text)
        self.assertEqual(admin.post(f"/api/v1/shared-questions/{admin_draft.json()['id']}/submit").status_code, 200)
        self.assertEqual(admin.post(f"/api/v1/shared-questions/{admin_draft.json()['id']}/review", json={"decision": "published"}).status_code, 403)

    def test_school_analytics_import_is_anonymous_aggregate_only_and_idempotent(self):
        admin = TestClient(self.module.app)
        teacher = TestClient(self.module.app)
        outsider = TestClient(self.module.app)
        admin_email = f"analytics-admin-{uuid4()}@example.test"
        teacher_email = f"analytics-teacher-{uuid4()}@example.test"
        for client, email in ((admin, admin_email), (teacher, teacher_email), (outsider, f"analytics-outsider-{uuid4()}@example.test")):
            response = client.post("/api/v1/auth/register", json={"email": email, "password": "a-secure-test-password"})
            self.assertEqual(response.status_code, 201, response.text)
        school = admin.post("/api/v1/schools", json={"name": f"Trường analytics {uuid4()}"}).json()
        self.assertEqual(admin.put(f"/api/v1/schools/{school['id']}/members", json={"email": teacher_email, "role": "teacher"}).status_code, 200)
        report = (
            "learner_pseudonym,course_external_id,lesson_external_id,completion_percent,score,max_score,correct_answers,total_questions\n"
            "HS-001,TOAN5,PS-01,100,8,10,8,10\n"
            "HS-002,TOAN5,PS-01,50,6,10,6,10\n"
        ).encode("utf-8")
        created = admin.post(
            f"/api/v1/schools/{school['id']}/analytics/imports",
            files={"upload": ("report.csv", report, "text/csv")},
        )
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(created.json()["accepted_row_count"], 2)
        self.assertEqual(created.json()["rejected_row_count"], 0)
        self.assertNotIn("HS-001", created.text)
        duplicate = admin.post(f"/api/v1/schools/{school['id']}/analytics/imports", files={"upload": ("report.csv", report, "text/csv")})
        self.assertEqual(duplicate.status_code, 409, duplicate.text)
        self.assertEqual(teacher.get(f"/api/v1/schools/{school['id']}/analytics/imports").status_code, 403)
        self.assertEqual(outsider.get(f"/api/v1/schools/{school['id']}/analytics/summary").status_code, 404)
        summary = teacher.get(f"/api/v1/schools/{school['id']}/analytics/summary")
        self.assertEqual(summary.status_code, 200, summary.text)
        self.assertEqual(summary.json()["learner_count"], 2)
        self.assertEqual(summary.json()["completion_ratio"], 0.75)
        self.assertNotIn("HS-001", summary.text)
        insights = teacher.get(f"/api/v1/schools/{school['id']}/analytics/insights")
        self.assertEqual(insights.status_code, 200, insights.text)
        self.assertEqual(insights.json()["method"], "deterministic_aggregate")
        with self.module.SessionLocal() as db:
            event = db.scalar(self.module.select(self.module.LearningAnalytics).where(self.module.LearningAnalytics.school_id == school["id"]))
            self.assertIsNotNone(event)
            self.assertNotEqual(event.learner_token, "HS-001")
            self.assertEqual(len(event.learner_token), 64)

    def test_school_analytics_accepts_xlsx_and_rejects_name_only_headers(self):
        admin = TestClient(self.module.app)
        response = admin.post("/api/v1/auth/register", json={"email": f"analytics-xlsx-{uuid4()}@example.test", "password": "a-secure-test-password"})
        self.assertEqual(response.status_code, 201, response.text)
        school = admin.post("/api/v1/schools", json={"name": f"Trường XLSX {uuid4()}"}).json()
        workbook = Workbook()
        sheet = workbook.active
        sheet.append(["learner_pseudonym", "course_external_id", "lesson_external_id", "activity_date", "completion_percent"])
        sheet.append(["HS-ANON-01", "KHOA-01", "BAI-01", "2026-08-21", 100])
        buffer = io.BytesIO()
        workbook.save(buffer)
        imported = admin.post(
            f"/api/v1/schools/{school['id']}/analytics/imports",
            files={"upload": ("report.xlsx", buffer.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        self.assertEqual(imported.status_code, 201, imported.text)
        bad = b"Ho ten,course_external_id,lesson_external_id\nNguyen Van A,C1,L1\n"
        rejected = admin.post(f"/api/v1/schools/{school['id']}/analytics/imports", files={"upload": ("bad.csv", bad, "text/csv")})
        self.assertEqual(rejected.status_code, 422, rejected.text)
        self.assertIn("learner_identifier", rejected.text)

    def test_first_school_provisioning_is_idempotent_and_does_not_reset_existing_password(self):
        school_name = f"Trường Tiểu học Trần Quốc Toản {uuid4()}"
        email = f"first-admin-{uuid4()}@example.test"
        with self.module.SessionLocal() as db:
            first = provision_school_admin(
                db,
                school_name=school_name,
                admin_email=email,
                admin_password="first-safe-password-123",
                admin_full_name="Quản trị Trần Quốc Toản",
            )
            db.commit()
            original_hash = db.get(self.module.User, first.admin_user_id).password_hash
            second = provision_school_admin(
                db,
                school_name=school_name,
                admin_email=email,
                admin_password="different-safe-password-456",
            )
            db.commit()
            self.assertTrue(first.created_user)
            self.assertTrue(first.created_school)
            self.assertFalse(second.created_user)
            self.assertFalse(second.created_school)
            self.assertEqual(db.get(self.module.User, first.admin_user_id).password_hash, original_hash)
            membership = self.module.membership_for(db, first.school_id, first.admin_user_id)
            self.assertIsNotNone(membership)
            self.assertEqual(membership.role, "school_admin")
            with self.assertRaises(ProvisioningError):
                provision_school_admin(
                    db, school_name=school_name, admin_email="invalid", admin_password="short",
                )

    def test_google_sign_in_creates_verified_identity_and_bootstraps_configured_admin(self):
        client = TestClient(self.module.app)
        email = f"google-admin-{uuid4()}@example.test"
        school_name = f"Trường Tiểu học Trần Quốc Toản {uuid4()}"
        subject = f"google-subject-{uuid4()}"
        environment = {
            "GOOGLE_OAUTH_CLIENT_ID": "test-client.apps.googleusercontent.com",
            "GOOGLE_OAUTH_CLIENT_SECRET": "test-secret-not-a-real-secret",
            "GOOGLE_OAUTH_REDIRECT_URI": "http://127.0.0.1:8000/api/v1/auth/google/callback",
            "GOOGLE_BOOTSTRAP_ADMIN_EMAIL": email,
            "GOOGLE_BOOTSTRAP_SCHOOL_NAME": school_name,
        }
        with patch.dict(os.environ, environment, clear=False), patch.object(
            self.module, "exchange_code", return_value=GoogleProfile(subject=subject, email=email, full_name="Google Admin"),
        ):
            start = client.get("/api/v1/auth/google/start", follow_redirects=False)
            self.assertEqual(start.status_code, 307, start.text)
            self.assertIn("code_challenge_method=S256", start.headers["location"])
            attempt = decode_attempt(client.cookies.get("google_oauth_attempt"))
            callback = client.get(f"/api/v1/auth/google/callback?code=one-time-code&state={attempt.state}", follow_redirects=False)
            self.assertEqual(callback.status_code, 303, callback.text)
            self.assertEqual(callback.headers["location"], "/")
            me = client.get("/api/v1/me")
            self.assertEqual(me.status_code, 200, me.text)
            self.assertEqual(me.json()["email"], email)
            schools = client.get("/api/v1/schools").json()
            self.assertEqual(schools[0]["name"], school_name)
            self.assertEqual(schools[0]["role"], "school_admin")
            self.assertEqual(client.get("/api/v1/auth/google/callback?code=x&state=wrong", follow_redirects=False).headers["location"], "/?auth_error=google")
            with self.module.SessionLocal() as db:
                identities = db.scalars(self.module.select(self.module.OAuthIdentity).where(self.module.OAuthIdentity.provider == "google", self.module.OAuthIdentity.subject == subject)).all()
                self.assertEqual(len(identities), 1)


if __name__ == "__main__":
    unittest.main()
