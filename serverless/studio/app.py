"""Self-contained FastAPI app: no database, session, storage or provider key."""
from __future__ import annotations

import html
import io
import json
import os
import re
import zipfile
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse
from uuid import uuid4
from xml.etree import ElementTree

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

MAX_ZIP_BYTES = 4 * 1024 * 1024


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Metadata(StrictModel):
    title: str = Field(min_length=1, max_length=300)
    direction: Literal["lesson", "review", "advanced"]
    language: str = "vi-VN"
    subject: str | None = None
    grade: str | None = None
    teacher_name: str | None = None
    school_name: str | None = None


class Block(StrictModel):
    id: str
    type: Literal["heading", "text", "image", "audio", "video", "callout", "quiz", "embed"]
    text: str | None = None
    asset_id: str | None = None
    question_id: str | None = None
    settings: dict[str, Any] = Field(default_factory=dict)


class Slide(StrictModel):
    id: str
    title: str
    layout: str
    status: Literal["ai_draft", "edited", "approved"]
    blocks: list[Block]
    speaker_notes: str | None = None


class Question(StrictModel):
    id: str
    type: Literal["single", "multiple", "truefalse", "fill", "matching", "ordering", "dragdrop", "image"]
    question: str
    selected: bool
    score: float = Field(ge=0)
    difficulty: Literal["recognize", "understand", "apply", "advanced"]
    correct_answer: Any
    options: list[str] = Field(default_factory=list)
    explanation: str | None = None
    feedback_correct: str | None = None
    feedback_incorrect: str | None = None
    objective_ids: list[str] = Field(default_factory=list)
    settings: dict[str, Any] = Field(default_factory=dict)


class Theme(StrictModel):
    id: str
    primary_color: str | None = None
    font_family: str | None = None
    logo_asset_id: str | None = None


class Navigation(StrictModel):
    mode: Literal["free", "sequential", "restricted"]
    show_menu: bool
    show_progress: bool


class Completion(StrictModel):
    viewed_percent: int = Field(ge=0, le=100)
    passing_score: int = Field(ge=0, le=100)
    require_quiz: bool


class Scorm(StrictModel):
    standard: Literal["SCORM_2004"]
    preset: Literal["k12online", "custom"]
    resume: bool
    track_score: bool
    track_completion: bool
    track_success: bool
    edition: str | None = None


class Course(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    id: str
    revision: int = Field(ge=1)
    metadata: Metadata
    objectives: list[dict[str, str]]
    slides: list[Slide]
    question_bank: list[Question]
    theme: Theme
    navigation: Navigation
    completion: Completion
    scorm: Scorm


class ExportPayload(StrictModel):
    course: Course


class GenerationPayload(StrictModel):
    title: str = Field(min_length=1, max_length=300)
    source: str = Field(min_length=1, max_length=24_000)
    direction: Literal["lesson", "review", "advanced"]
    provider: Literal["mock", "openai", "gemini"] = "mock"


def _safe_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def _assert_serverless_course(course: Course) -> None:
    if any(block.asset_id or block.type in {"image", "audio", "video"} for slide in course.slides for block in slide.blocks):
        raise ValueError("Chế độ serverless không đóng gói ảnh, audio hoặc video. Hãy bỏ media trước khi xuất.")
    interaction_errors = [error for question in course.question_bank if question.selected for error in [_interaction_error(question)] if error]
    if interaction_errors:
        raise ValueError("; ".join(interaction_errors))


def _image_options(question: Question) -> list[dict[str, Any]]:
    options = question.settings.get("image_options", [])
    return [item for item in options if isinstance(item, dict)] if isinstance(options, list) else []


def _is_safe_https_url(value: object) -> bool:
    if not isinstance(value, str) or len(value) > 2_000:
        return False
    parsed = urlparse(value)
    return parsed.scheme == "https" and bool(parsed.netloc) and not parsed.username and not parsed.password


def _interaction_error(question: Question) -> str | None:
    prefix = f"Câu hỏi “{question.question[:80]}”"
    if not question.question.strip():
        return f"{prefix} thiếu nội dung."
    if question.score <= 0:
        return f"{prefix} phải có điểm lớn hơn 0."
    if question.correct_answer in (None, "", [], {}):
        return f"{prefix} thiếu đáp án đúng."
    if question.type in {"single", "multiple", "truefalse", "ordering", "dragdrop"} and len(question.options) < 2:
        return f"{prefix} cần ít nhất hai phương án."
    if question.type in {"multiple", "ordering", "dragdrop"}:
        if not isinstance(question.correct_answer, list) or not question.correct_answer:
            return f"{prefix} cần đáp án dạng danh sách theo thứ tự."
        if not all(isinstance(item, str) and item.strip() for item in question.correct_answer):
            return f"{prefix} có đáp án danh sách không hợp lệ."
        if any(str(item) not in question.options for item in question.correct_answer):
            return f"{prefix} có đáp án không nằm trong các phương án."
    if question.type == "matching":
        if not isinstance(question.correct_answer, dict) or len(question.correct_answer) < 2:
            return f"{prefix} cần ít nhất hai cặp ghép."
        if not all(isinstance(left, str) and left.strip() and isinstance(right, str) and right.strip() for left, right in question.correct_answer.items()):
            return f"{prefix} có cặp ghép không hợp lệ."
    if question.type == "image":
        options = _image_options(question)
        if len(options) < 2:
            return f"{prefix} cần ít nhất hai ảnh lựa chọn."
        ids = [str(item.get("id", "")).strip() for item in options]
        if not all(ids) or len(ids) != len(set(ids)) or str(question.correct_answer) not in ids:
            return f"{prefix} có mã ảnh hoặc đáp án ảnh không hợp lệ."
        if any("asset_id" in item for item in options):
            return f"{prefix} đang dùng asset ảnh; chế độ serverless chỉ hỗ trợ URL HTTPS, không đóng gói media."
        if not all(_is_safe_https_url(item.get("src")) for item in options):
            return f"{prefix} cần URL ảnh HTTPS hợp lệ."
        if not question.settings.get("external_media_rights_confirmed"):
            return f"{prefix} cần xác nhận quyền sử dụng ảnh URL bên ngoài trước khi xuất."
    return None


def quality_report(course: Course) -> dict[str, object]:
    findings: list[dict[str, object]] = []
    for slide in course.slides:
        text = " ".join(block.text or "" for block in slide.blocks if block.type in {"heading", "text", "callout"}).strip()
        if slide.status != "approved": findings.append({"code": "SLIDE_NOT_APPROVED", "severity": "warning", "scope": "slide", "item_id": slide.id, "title": "Slide chưa được duyệt", "message": f"{slide.title} vẫn ở trạng thái nháp hoặc đang sửa.", "suggestion": "Kiểm tra chuyên môn rồi đánh dấu Đã duyệt."})
        if len(text) < 20: findings.append({"code": "SLIDE_TOO_SHORT", "severity": "warning", "scope": "slide", "item_id": slide.id, "title": "Slide thiếu nội dung", "message": f"{slide.title} có quá ít văn bản.", "suggestion": "Bổ sung nội dung để học sinh có thể tự học."})
    selected = [question for question in course.question_bank if question.selected]
    if not selected: findings.append({"code": "NO_QUIZ", "severity": "warning", "scope": "course", "item_id": None, "title": "Chưa có quiz", "message": "Không có câu hỏi nào được chọn.", "suggestion": "Chọn ít nhất một câu hỏi ở Bước 5."})
    for question in selected:
        if not question.question.strip() or question.correct_answer in (None, "", []): findings.append({"code": "QUESTION_INCOMPLETE", "severity": "warning", "scope": "question", "item_id": question.id, "title": "Câu hỏi chưa hoàn chỉnh", "message": "Thiếu nội dung hoặc đáp án đúng.", "suggestion": "Bổ sung câu hỏi, đáp án và kiểm tra cách chấm."})
        error = _interaction_error(question)
        if error:
            findings.append({"code": "QUESTION_INTERACTION_INVALID", "severity": "warning", "scope": "question", "item_id": question.id, "title": "Cấu hình tương tác chưa xuất được", "message": error, "suggestion": "Sửa dữ liệu câu hỏi trước khi xuất ZIP SCORM."})
    warnings = sum(item["severity"] == "warning" for item in findings)
    return {"course_id": course.id, "revision": course.revision, "score": max(0, 100 - warnings * 10), "summary": {"warnings": warnings, "info": 0, "checked_slides": len(course.slides), "checked_questions": len(course.question_bank)}, "findings": findings, "blocking": False}


def _sentences(source: str) -> list[str]:
    values = [item.strip() for item in re.split(r"(?<=[.!?。])\s+|[;\n]+", re.sub(r"\s+", " ", source)) if len(item.strip()) > 12]
    return values or ["Giáo viên cần bổ sung ngữ cảnh rõ ràng cho nội dung bài học."]


def mock_course(payload: GenerationPayload) -> Course:
    sections = {"lesson": ["Khởi động", "Kiến thức trọng tâm", "Ví dụ – vận dụng", "Củng cố"], "review": ["Gợi nhớ kiến thức", "Hệ thống hóa", "Luyện tập", "Tổng kết"], "advanced": ["Đặt vấn đề", "Mở rộng kiến thức", "Thử thách vận dụng", "Kết luận"]}[payload.direction]
    source = _sentences(payload.source)
    return Course(id=str(uuid4()), revision=1, metadata=Metadata(title=payload.title, direction=payload.direction), objectives=[{"id": "o1", "text": f"Nêu được các ý chính của chủ đề “{payload.title}”."}, {"id": "o2", "text": "Vận dụng kiến thức để trả lời câu hỏi và xử lý tình huống."}], slides=[Slide(id=f"s{index + 1}", title=title, layout="content", status="ai_draft", blocks=[Block(id=f"s{index + 1}-text", type="text", text=f"{source[(index * 2) % len(source)]}\n\n{source[(index * 2 + 1) % len(source)]}")], speaker_notes="AI gợi ý – giáo viên cần kiểm tra trước khi xuất.") for index, title in enumerate(sections)], question_bank=[Question(id=f"q{index + 1}", type="single", question=f"Câu {index + 1}: Nhận định nào phù hợp nhất với nội dung “{item[:120].rstrip('.')}”?", selected=index < 4, score=1, difficulty="understand", correct_answer="Phương án đúng theo nội dung bài học", options=["Phương án đúng theo nội dung bài học", "Phương án gây nhiễu 1", "Phương án gây nhiễu 2", "Phương án gây nhiễu 3"], objective_ids=["o1"]) for index, item in enumerate((source * 8)[:8])], theme=Theme(id="default", primary_color="#3157d5"), navigation=Navigation(mode="free", show_menu=True, show_progress=True), completion=Completion(viewed_percent=90, passing_score=70, require_quiz=True), scorm=Scorm(standard="SCORM_2004", preset="k12online", edition="4th Edition", resume=True, track_score=True, track_completion=True, track_success=True))


def configured_providers() -> dict[str, dict[str, object]]:
    return {"mock": {"available": True, "model": "mock", "notice": "Không gửi nội dung ra dịch vụ bên ngoài."}, "openai": {"available": bool(os.getenv("OPENAI_API_KEY")), "model": os.getenv("OPENAI_MODEL", "gpt-4.1-mini")}, "gemini": {"available": bool(os.getenv("GEMINI_API_KEY")), "model": os.getenv("GEMINI_MODEL", "gemini-2.5-flash")}}


def provider_course(payload: GenerationPayload) -> tuple[Course, str]:
    status = configured_providers()[payload.provider]
    if not status["available"]: raise ValueError(f"{payload.provider} chưa được cấu hình trên máy chủ.")
    if payload.provider == "mock": return mock_course(payload), "mock"
    schema = Course.model_json_schema()
    prompt = f"Tạo một course.json hợp lệ bằng tiếng Việt theo schema, không thêm markdown. Tiêu đề: {payload.title}. Định hướng: {payload.direction}. Nguồn: {payload.source}"
    try:
        if payload.provider == "openai":
            from openai import OpenAI
            response = OpenAI(api_key=os.environ["OPENAI_API_KEY"]).responses.create(model=str(status["model"]), input=prompt, store=False, text={"format": {"type": "json_schema", "name": "course", "strict": False, "schema": schema}})
            return Course.model_validate(json.loads(response.output_text)), str(status["model"])
        from google import genai
        response = genai.Client(api_key=os.environ["GEMINI_API_KEY"]).models.generate_content(model=str(status["model"]), contents=prompt, config={"response_mime_type": "application/json", "response_json_schema": schema})
        return Course.model_validate(json.loads(response.text)), str(status["model"])
    except Exception as exc:
        raise RuntimeError("AI không tạo được course.json hợp lệ. Hãy thử lại hoặc dùng Mock AI.") from exc


def runtime_js() -> str:
    return (Path(__file__).with_name("runtime.js")).read_text(encoding="utf-8")


def player_js() -> str:
    return (Path(__file__).with_name("player.js")).read_text(encoding="utf-8")


def manifest(title: str) -> str:
    safe = html.escape(title)
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="AI_SCORM_STUDIO" xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3" xmlns:imsss="http://www.imsglobal.org/xsd/imsss"><metadata><schema>ADL SCORM</schema><schemaversion>2004 4th Edition</schemaversion></metadata><organizations default="ORG-1"><organization identifier="ORG-1"><title>{safe}</title><item identifier="ITEM-1" identifierref="RES-1"><title>{safe}</title></item></organization></organizations><resources><resource identifier="RES-1" type="webcontent" adlcp:scormType="sco" href="index.html"><file href="index.html"/><file href="runtime.js"/><file href="player.js"/></resource></resources></manifest>'''


def render_html(course: Course) -> str:
    title = html.escape(course.metadata.title)
    payload = _safe_json(course.model_dump(mode="json"))
    config = _safe_json({
        "resume": course.scorm.resume,
        "trackScore": course.scorm.track_score,
        "trackCompletion": course.scorm.track_completion,
        "trackSuccess": course.scorm.track_success,
    })
    return f'''<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title>
<style>
body{{margin:0;font:18px system-ui;background:#f4f7fb;color:#10233f}}main{{max-width:920px;margin:0 auto;padding:32px}}article{{background:#fff;border-radius:16px;padding:32px;box-shadow:0 8px 30px #10233f18}}.eyebrow{{color:#3157d5;font-weight:700;font-size:13px}}button{{padding:10px 16px;margin:16px 8px 0 0}}#progress{{font-size:14px;color:#52647a}}.question{{margin-top:18px;padding:16px;border:1px solid #dfe6f0;border-radius:12px}}.option{{display:block;margin:8px 0}}.answer{{width:100%;padding:9px;box-sizing:border-box}}.answers{{display:grid;gap:10px;margin-top:14px}}.matching-option{{display:grid;grid-template-columns:minmax(0,1fr) minmax(180px,1fr);gap:12px;align-items:center;background:#fff;padding:10px;border-radius:8px}}.matching-option select{{padding:9px}}.sequence-bank,.sequence-answer{{min-height:54px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px;border:1px solid #cbd5e1;border-radius:10px;background:#fff}}.sequence-answer{{margin:8px 0;padding-left:36px;border:2px dashed #8297ca}}.sequence-token{{margin:0;background:#eef3ff;border:1px solid #9eb0de;border-radius:8px;cursor:grab}}.drag-over{{background:#e7efff}}.interaction-help{{margin:0;color:#52647a;font-size:14px}}.image-option{{display:grid;grid-template-columns:22px minmax(96px,160px) 1fr;gap:10px;align-items:center;background:#fff;padding:10px;border-radius:8px}}.image-option img{{width:160px;height:96px;object-fit:cover;border-radius:8px;border:1px solid #d6dde9}}@media(max-width:600px){{main{{padding:16px}}.matching-option{{grid-template-columns:1fr}}.image-option{{grid-template-columns:22px 1fr}}.image-option img{{grid-column:2;width:100%;height:auto}}}}
</style></head><body><main><p class="eyebrow">AI SCORM STUDIO • SCORM 2004</p><article id="player"></article><button id="back">← Trước</button><button id="next">Tiếp →</button><p id="progress"></p></main>
<script>window.SCORM_CFG={config};</script>
<script id="course-data" type="application/json">{payload}</script>
<script src="runtime.js"></script><script src="player.js"></script>
</body></html>'''


def validate(files: dict[str, bytes], course: Course) -> list[str]:
    required = {"imsmanifest.xml", "index.html", "runtime.js", "player.js"}
    errors = [f"Thiếu tệp {name}." for name in sorted(required - set(files))]
    for name in files:
        if not name or "\\" in name or name.startswith("/") or ".." in name.split("/"): errors.append(f"Đường dẫn không an toàn: {name}.")
    try:
        root = ElementTree.fromstring(files["imsmanifest.xml"])
        version = next((node.text for node in root.iter() if node.tag.endswith("schemaversion")), None)
        resources = [node for node in root.iter() if node.tag.endswith("resource")]
        sco = [node for node in resources if node.attrib.get("{http://www.adlnet.org/xsd/adlcp_v1p3}scormType") == "sco"]
        hrefs = {node.attrib.get("href") for node in root.iter() if node.attrib.get("href")}
        if version != "2004 4th Edition": errors.append("Manifest phải là SCORM 2004 4th Edition.")
        if len(sco) != 1: errors.append("Manifest cần đúng một SCO resource.")
        if not {"index.html", "runtime.js", "player.js"}.issubset(hrefs): errors.append("Manifest phải tham chiếu index.html, runtime.js và player.js.")
    except ElementTree.ParseError: errors.append("imsmanifest.xml không hợp lệ.")
    runtime = files["runtime.js"]
    required_runtime_tokens = (b"API_1484_11", b"Initialize", b"GetValue", b"SetValue", b"Commit", b"Terminate", b"cmi.session_time")
    if any(token not in runtime for token in required_runtime_tokens): errors.append("Thiếu SCORM 2004 runtime đầy đủ.")
    if not 0 <= course.completion.passing_score <= 100: errors.append("Điểm đạt không hợp lệ.")
    return errors


def make_zip(course: Course) -> tuple[bytes, str]:
    _assert_serverless_course(course)
    files = {
        "imsmanifest.xml": manifest(course.metadata.title).encode(),
        "index.html": render_html(course).encode(),
        "runtime.js": runtime_js().encode(),
        "player.js": player_js().encode(),
    }
    errors = validate(files, course)
    if errors: raise ValueError("; ".join(errors))
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items(): archive.writestr(name, content)
    package = buffer.getvalue()
    if len(package) > MAX_ZIP_BYTES: raise ValueError("ZIP vượt giới hạn 4 MB của chế độ serverless.")
    if zipfile.ZipFile(io.BytesIO(package)).testzip(): raise ValueError("ZIP SCORM bị lỗi.")
    name = re.sub(r"[^A-Za-z0-9_-]+", "_", course.metadata.title).strip("_") or "bai_giang"
    return package, f"{name}_SCORM2004.zip"


app = FastAPI(title="AI SCORM Studio stateless API")
origins = [item.strip() for item in os.getenv("ALLOWED_ORIGINS", "").split(",") if item.strip()]
if origins: app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["POST", "GET"], allow_headers=["content-type"])


@app.get("/healthz")
def healthz(): return {"status": "ok", "mode": "stateless"}


@app.get("/api/serverless/providers")
def providers(): return configured_providers()


@app.post("/api/serverless/generate")
def generate(payload: GenerationPayload):
    try: course, model = provider_course(payload)
    except ValueError as exc: raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RuntimeError as exc: raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"course": course.model_dump(mode="json"), "provider": payload.provider, "model": model, "notice": "AI tạo nháp; giáo viên phải duyệt trước khi xuất."}


@app.post("/api/serverless/quality")
def quality(course: Course): return quality_report(course)


@app.post("/api/serverless/preview", response_class=HTMLResponse)
def preview(course: Course):
    try:
        _assert_serverless_course(course)
        return render_html(course)
    except ValueError as exc: raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/serverless/export")
def export(payload: ExportPayload):
    try: package, filename = make_zip(payload.course)
    except ValueError as exc: raise HTTPException(status_code=422, detail=str(exc)) from exc
    return StreamingResponse(io.BytesIO(package), media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{filename}"'})
