"""Database-free core for the temporary, serverless authoring mode.

The core deliberately owns no session, storage adapter or provider credential.  A
thin FastAPI/Vercel entry point supplies a renderer and, later, a server-only AI
provider adapter.  This keeps canonical ``course.json`` validation and package
limits testable without starting SQLAlchemy or writing any state.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import io
import re
import zipfile

from pydantic import BaseModel, ConfigDict, Field

from prototype.course_models import Block, Course, Objective, Question, Slide, new_course
from prototype.quality import analyze_course


MAX_SERVERLESS_ZIP_BYTES = 4 * 1024 * 1024


class StatelessModeError(ValueError):
    """A request needs persistent storage or exceeds the serverless contract."""


class StatelessGenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=300)
    source: str = Field(min_length=1, max_length=24_000)
    direction: str = Field(default="lesson", pattern="^(lesson|review|advanced)$")


class StatelessExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    course: Course


@dataclass(frozen=True)
class ScormRenderer:
    """Pure-function boundary supplied by the backend renderer implementation."""

    to_export_request: Callable[[Course], object]
    render_html: Callable[[object], str]
    runtime: Callable[[], str]
    manifest: Callable[[str], str]
    validate_files: Callable[[dict[str, bytes], int, int], list[str]]
    validate_zip: Callable[[bytes], list[str]]


def _sentences(source: str) -> list[str]:
    compact = re.sub(r"\s+", " ", source).strip()
    values = [part.strip(" -•") for part in re.split(r"(?<=[.!?。])\s+|[;\n]+", compact) if len(part.strip(" -•")) > 12]
    return values or ["Giáo viên cần bổ sung ngữ cảnh rõ ràng cho nội dung bài học."]


def make_mock_course(request: StatelessGenerateRequest | dict[str, object]) -> Course:
    """Build a deterministic canonical draft without an AI key or server state."""
    if not isinstance(request, StatelessGenerateRequest):
        request = StatelessGenerateRequest.model_validate(request)
    course = new_course(request.title, request.direction)  # type: ignore[arg-type]
    direction_names = {"lesson": "Bài học mới", "review": "Ôn tập – củng cố", "advanced": "Nâng cao – mở rộng"}
    section_titles = {
        "lesson": ["Khởi động", "Kiến thức trọng tâm", "Ví dụ – vận dụng", "Củng cố"],
        "review": ["Gợi nhớ kiến thức", "Hệ thống hóa", "Luyện tập", "Tổng kết"],
        "advanced": ["Đặt vấn đề", "Mở rộng kiến thức", "Thử thách vận dụng", "Kết luận"],
    }[request.direction]
    sentences = _sentences(request.source)
    course.objectives = [
        Objective(id="o1", text=f"Nêu được các ý chính của chủ đề “{request.title}”."),
        Objective(id="o2", text="Vận dụng kiến thức để trả lời câu hỏi và xử lý tình huống."),
        Objective(id="o3", text=f"Hoàn thành hoạt động theo định hướng: {direction_names[request.direction]}.")
    ]
    course.slides = [
        Slide(
            id=f"s{index + 1}", title=title, layout="content", status="ai_draft",
            blocks=[Block(id=f"s{index + 1}-text", type="text", text=f"{sentences[(index * 2) % len(sentences)]}\n\n{sentences[(index * 2 + 1) % len(sentences)]}")],
            speaker_notes="AI gợi ý – giáo viên cần kiểm tra trước khi xuất.",
        )
        for index, title in enumerate(section_titles)
    ]
    course.question_bank = [
        Question(
            id=f"q{index + 1}", type="single",
            question=f"Câu {index + 1}: Nhận định nào phù hợp nhất với nội dung “{sentence[:120].rstrip('.')}”?",
            options=["Phương án đúng theo nội dung bài học", "Phương án gây nhiễu 1", "Phương án gây nhiễu 2", "Phương án gây nhiễu 3"],
            correct_answer="Phương án đúng theo nội dung bài học", selected=index < 4,
            score=1, difficulty="understand", objective_ids=["o1"],
        )
        for index, sentence in enumerate((sentences * 8)[:8])
    ]
    return course


def quality_report(course: Course) -> dict[str, object]:
    """Run deterministic advisory checks over already-validated canonical data."""
    return analyze_course(course)


def _assert_no_serverless_assets(course: Course) -> None:
    asset_ids = [block.asset_id for slide in course.slides for block in slide.blocks if block.asset_id]
    if asset_ids:
        raise StatelessModeError("Chế độ serverless không đóng gói media. Hãy bỏ media hoặc dùng bản có R2/VPS.")
    if any(block.type in {"audio", "video"} for slide in course.slides for block in slide.blocks):
        raise StatelessModeError("Chế độ serverless không hỗ trợ audio hoặc video nhúng.")


def preview_course(course: Course, renderer: ScormRenderer) -> str:
    """Render a disposable player page from canonical data only."""
    _assert_no_serverless_assets(course)
    return renderer.render_html(renderer.to_export_request(course))


def package_course(course: Course, renderer: ScormRenderer, *, max_bytes: int = MAX_SERVERLESS_ZIP_BYTES) -> tuple[bytes, str]:
    """Render, validate and return a small SCORM ZIP without writing it anywhere."""
    _assert_no_serverless_assets(course)
    files = {
        "imsmanifest.xml": renderer.manifest(course.metadata.title).encode(),
        "index.html": preview_course(course, renderer).encode(),
        "runtime.js": renderer.runtime().encode(),
    }
    errors = renderer.validate_files(files, course.completion.passing_score, course.completion.viewed_percent)
    if errors:
        raise StatelessModeError("; ".join(errors))
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    package = buffer.getvalue()
    if len(package) > max_bytes:
        raise StatelessModeError(f"ZIP vượt giới hạn {max_bytes // (1024 * 1024)} MB của chế độ serverless.")
    zip_errors = renderer.validate_zip(package)
    if zip_errors:
        raise StatelessModeError("; ".join(zip_errors))
    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", course.metadata.title).strip("_") or "bai_giang"
    return package, f"{safe_name}_SCORM2004.zip"
