"""Contract tests for the self-contained Vercel API project."""
from __future__ import annotations

import io
from pathlib import Path
import sys
import unittest
import zipfile

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "serverless"))

from studio.app import app  # noqa: E402


class ServerlessDeploymentTests(unittest.TestCase):
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
        self.assertIn("runtime.js", client.post("/api/serverless/preview", json=course).text)
        exported = client.post("/api/serverless/export", json={"course": course})
        self.assertEqual(exported.status_code, 200, exported.text)
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            self.assertEqual(set(archive.namelist()), {"imsmanifest.xml", "index.html", "runtime.js"})

    def test_export_rejects_media_assets_before_packaging(self):
        course = {"id": "local-2", "revision": 1, "metadata": {"title": "Có media", "direction": "lesson"}, "objectives": [], "slides": [{"id": "s1", "title": "Slide", "layout": "content", "status": "approved", "blocks": [{"id": "image", "type": "image", "asset_id": "a1", "settings": {}}]}], "question_bank": [], "theme": {"id": "default"}, "navigation": {"mode": "free", "show_menu": True, "show_progress": True}, "completion": {"viewed_percent": 90, "passing_score": 70, "require_quiz": False}, "scorm": {"standard": "SCORM_2004", "preset": "k12online", "resume": True, "track_score": True, "track_completion": True, "track_success": True}}
        response = TestClient(app).post("/api/serverless/export", json={"course": course})
        self.assertEqual(response.status_code, 422)
        self.assertIn("không đóng gói", response.json()["detail"])
