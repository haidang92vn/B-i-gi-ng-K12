"""Contract tests for the self-contained Vercel API project."""
from __future__ import annotations

import copy
import io
import json
from pathlib import Path
import sys
import unittest
import zipfile

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "serverless"))

from studio.app import app, player_js, runtime_js, mock_course, GenerationPayload  # noqa: E402


class ServerlessDeploymentTests(unittest.TestCase):
    def test_invalid_courses_are_rejected_by_preview_and_export(self):
        base = mock_course(GenerationPayload(title="Audit", source="Nội dung bài học đủ dài cho kiểm tra.", direction="lesson")).model_dump()
        cases = []
        course = copy.deepcopy(base); course["slides"] = []; cases.append(course)
        course = copy.deepcopy(base); course["slides"][1]["id"] = course["slides"][0]["id"]; cases.append(course)
        course = copy.deepcopy(base); course["question_bank"] = []; cases.append(course)
        for fields in (
            {"correct_answer": "Không có trong lựa chọn"},
            {"options": ["A", " a "], "correct_answer": "A"},
            {"type": "fill", "correct_answer": ["A"]},
            {"type": "truefalse", "options": ["A", "B", "C"], "correct_answer": "A"},
            {"type": "multiple", "options": ["A", "B"], "correct_answer": ["A", "A"]},
            {"type": "ordering", "options": ["A", "B"], "correct_answer": ["A"]},
            {"objective_ids": ["missing"]},
        ):
            course = copy.deepcopy(base); course["question_bank"][0].update(fields); cases.append(course)
        client = TestClient(app)
        for index, course in enumerate(cases):
            with self.subTest(case=index):
                self.assertEqual(client.post("/api/serverless/preview", json=course).status_code, 422)
                self.assertEqual(client.post("/api/serverless/export", json={"course": course}).status_code, 422)

    def test_preview_is_self_contained_but_export_keeps_packaged_scripts(self):
        course = mock_course(GenerationPayload(title="Audit", source="Nội dung bài học đủ dài cho kiểm tra.", direction="lesson")).model_dump()
        client = TestClient(app)
        preview = client.post("/api/serverless/preview", json=course)
        self.assertEqual(preview.status_code, 200)
        self.assertNotIn('<script src=', preview.text)
        self.assertIn("function render()", preview.text)
        course["question_bank"] = []
        course["completion"]["require_quiz"] = False
        exported = client.post("/api/serverless/export", json={"course": course})
        self.assertEqual(exported.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            self.assertIn('<script src="player.js">', archive.read("index.html").decode())

    def test_vercel_function_includes_packaged_runtime_files(self):
        config = json.loads((ROOT / "serverless" / "vercel.json").read_text(encoding="utf-8"))
        self.assertEqual(config["functions"]["api/index.py"]["includeFiles"], "studio/*.js")

    def test_export_runtime_has_scorm_2004_lifecycle_and_tracking_contract(self):
        runtime = runtime_js()
        for token in (
            "API_1484_11", "Initialize", "GetValue", "SetValue", "Commit", "Terminate",
            "cmi.suspend_data", "cmi.session_time", "scormResume", "scormFinish",
            "SCORM_SUSPEND_DATA_BUDGET", "scorm:suspend-status",
        ):
            self.assertIn(token, runtime)
        player = player_js()
        for token in ("cmi.interactions", ".learner_response", ".result", ".latency"):
            self.assertIn(token, player)

    def test_export_filename_transliterates_vietnamese_safely(self):
        course = mock_course(GenerationPayload(title="Kiểm thử tiếng Việt", source="Nội dung đủ dài để tạo bài kiểm thử.", direction="lesson"))
        response = TestClient(app).post("/api/serverless/export", json={"course": course.model_dump(mode="json")})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn('filename="Kiem_thu_tieng_Viet_SCORM2004.zip"', response.headers["Content-Disposition"])

    def test_provider_catalog_exposes_capability_not_credentials(self):
        response = TestClient(app).get("/api/serverless/providers")
        self.assertEqual(response.status_code, 200, response.text)
        providers = response.json()
        self.assertEqual(providers["mock"]["available"], True)
        self.assertEqual(providers["mock"]["model"], "mock")
        for name in ("openai", "gemini"):
            self.assertIn("available", providers[name])
            self.assertIn("model", providers[name])
            self.assertNotIn("api_key", providers[name])
            self.assertNotIn("key", providers[name])

    def test_mock_generation_returns_a_canonical_course_without_provider_key(self):
        response = TestClient(app).post("/api/serverless/generate", json={
            "title": "Vòng tuần hoàn nước",
            "source": "Nước bốc hơi, ngưng tụ thành mây rồi tạo mưa. Quá trình này lặp lại trong tự nhiên.",
            "direction": "lesson",
            "provider": "mock",
        })
        self.assertEqual(response.status_code, 200, response.text)
        generated = response.json()
        self.assertEqual(generated["provider"], "mock")
        self.assertEqual(generated["model"], "mock")
        self.assertEqual(len(generated["course"]["slides"]), 4)
        self.assertEqual(len(generated["course"]["question_bank"]), 8)

    def test_health_quality_preview_and_export_never_need_persistence(self):
        course = {
            "id": "local-1", "revision": 3,
            "metadata": {"title": "Vòng tuần hoàn nước", "direction": "lesson", "language": "vi-VN"},
            "objectives": [{"id": "o1", "text": "Nêu được quá trình tuần hoàn của nước."}],
            "slides": [{"id": "s1", "title": "Khởi động", "layout": "content", "status": "approved", "blocks": [{"id": "b1", "type": "text", "text": "Nước bốc hơi, ngưng tụ thành mây và tạo mưa.", "settings": {}}]}],
            "question_bank": [{"id": "q1", "type": "single", "question": "Nước bốc hơi tạo thành gì?", "selected": True, "score": 1, "difficulty": "understand", "correct_answer": "Hơi nước", "options": ["Hơi nước", "Đá"], "objective_ids": ["o1"], "settings": {}}],
            "theme": {"id": "default", "primary_color": "#3157d5", "font_family": None, "logo_asset_id": None},
            "navigation": {"mode": "free", "show_menu": True, "show_progress": True},
            "completion": {"viewed_percent": 90, "passing_score": 70, "require_quiz": True},
            "scorm": {"standard": "SCORM_2004", "edition": "4th Edition", "preset": "k12online", "resume": True, "track_score": True, "track_completion": True, "track_success": True},
        }
        client = TestClient(app)
        self.assertEqual(client.get("/healthz").json()["mode"], "stateless")
        self.assertEqual(client.post("/api/serverless/quality", json=course).status_code, 200)
        self.assertIn("function Initialize()", client.post("/api/serverless/preview", json=course).text)
        exported = client.post("/api/serverless/export", json={"course": course})
        self.assertEqual(exported.status_code, 200, exported.text)
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            self.assertEqual(set(archive.namelist()), {"imsmanifest.xml", "index.html", "runtime.js", "player.js"})
            self.assertEqual(archive.read("runtime.js").decode(), runtime_js())
            self.assertEqual(archive.read("player.js").decode(), player_js())
            index = archive.read("index.html").decode()
            player = archive.read("player.js").decode()
        for token in ("window.SCORM_CFG", "player.js", "course-data"):
            self.assertIn(token, index)
        for token in ("cmi.progress_measure", "cmi.completion_status", "cmi.score.scaled", "cmi.success_status", "submitQuiz", "restoreState"):
            self.assertIn(token, player)

    def test_export_rejects_media_assets_before_packaging(self):
        course = {"id": "local-2", "revision": 1, "metadata": {"title": "Có media", "direction": "lesson"}, "objectives": [], "slides": [{"id": "s1", "title": "Slide", "layout": "content", "status": "approved", "blocks": [{"id": "image", "type": "image", "asset_id": "a1", "settings": {}}]}], "question_bank": [], "theme": {"id": "default"}, "navigation": {"mode": "free", "show_menu": True, "show_progress": True}, "completion": {"viewed_percent": 90, "passing_score": 70, "require_quiz": False}, "scorm": {"standard": "SCORM_2004", "preset": "k12online", "resume": True, "track_score": True, "track_completion": True, "track_success": True}}
        response = TestClient(app).post("/api/serverless/export", json={"course": course})
        self.assertEqual(response.status_code, 422)
        self.assertIn("không đóng gói", response.json()["detail"])

    def test_advanced_interactions_export_only_when_their_canonical_configuration_is_safe(self):
        course = {
            "id": "advanced-1", "revision": 1,
            "metadata": {"title": "Tương tác", "direction": "lesson"}, "objectives": [],
            "slides": [{"id": "s1", "title": "Luyện tập", "layout": "content", "status": "approved", "blocks": [{"id": "b1", "type": "text", "text": "Hoàn thành các câu hỏi tương tác.", "settings": {}}]}],
            "question_bank": [
                {"id": "match", "type": "matching", "question": "Ghép cặp hành tinh", "selected": True, "score": 1, "difficulty": "understand", "correct_answer": {"Trái Đất": "Hành tinh", "Mặt Trời": "Sao"}, "options": ["Sao", "Hành tinh"], "objective_ids": [], "settings": {}},
                {"id": "order", "type": "ordering", "question": "Sắp xếp chu trình", "selected": True, "score": 1, "difficulty": "understand", "correct_answer": ["Bốc hơi", "Ngưng tụ"], "options": ["Ngưng tụ", "Bốc hơi"], "objective_ids": [], "settings": {}},
                {"id": "drag", "type": "dragdrop", "question": "Kéo thả chu trình", "selected": True, "score": 1, "difficulty": "understand", "correct_answer": ["Hơi nước", "Mây"], "options": ["Mây", "Hơi nước"], "objective_ids": [], "settings": {}},
                {"id": "image", "type": "image", "question": "Chọn nước", "selected": True, "score": 1, "difficulty": "understand", "correct_answer": "water", "options": ["water", "rock"], "objective_ids": [], "settings": {"external_media_rights_confirmed": True, "image_options": [{"id": "water", "src": "https://example.com/water.png", "label": "Nước"}, {"id": "rock", "src": "https://example.com/rock.png", "label": "Đá"}]}},
            ],
            "theme": {"id": "default"}, "navigation": {"mode": "free", "show_menu": True, "show_progress": True},
            "completion": {"viewed_percent": 90, "passing_score": 70, "require_quiz": True},
            "scorm": {"standard": "SCORM_2004", "preset": "k12online", "resume": True, "track_score": True, "track_completion": True, "track_success": True},
        }
        client = TestClient(app)
        self.assertEqual(client.post("/api/serverless/preview", json=course).status_code, 200)
        exported = client.post("/api/serverless/export", json={"course": course})
        self.assertEqual(exported.status_code, 200, exported.text)
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            player = archive.read("player.js").decode()
        for token in ("matchingMarkup", "sequenceMarkup", "imageMarkup", "safeImageUrl", "samePairs"):
            self.assertIn(token, player)

        no_rights = copy.deepcopy(course)
        no_rights["question_bank"][3]["settings"]["external_media_rights_confirmed"] = False
        rejected = client.post("/api/serverless/export", json={"course": no_rights})
        self.assertEqual(rejected.status_code, 422)
        self.assertIn("quyền sử dụng", rejected.json()["detail"])

        asset_backed = copy.deepcopy(course)
        asset_backed["question_bank"][3]["settings"]["image_options"][0] = {"id": "water", "asset_id": "asset-water", "label": "Nước"}
        rejected_asset = client.post("/api/serverless/export", json={"course": asset_backed})
        self.assertEqual(rejected_asset.status_code, 422)
        self.assertIn("asset ảnh", rejected_asset.json()["detail"])
