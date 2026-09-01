"""Deterministic authoring-quality checks for canonical courses.

The checker is intentionally advisory: it identifies review work without changing
course data or blocking the existing technical SCORM validator.
"""
from __future__ import annotations

from collections import Counter
from typing import Any

from prototype.course_models import Course, Question


def _normalise(value: object) -> str:
    return " ".join(str(value).casefold().split())


def _answer_values(value: Any) -> list[str]:
    if isinstance(value, dict):
        return [_normalise(part) for pair in value.items() for part in pair]
    if isinstance(value, list):
        return [_normalise(part) for part in value]
    return [_normalise(value)] if value is not None else []


def _finding(
    code: str,
    severity: str,
    scope: str,
    item_id: str | None,
    title: str,
    message: str,
    suggestion: str,
) -> dict[str, str | None]:
    return {
        "code": code,
        "severity": severity,
        "scope": scope,
        "item_id": item_id,
        "title": title,
        "message": message,
        "suggestion": suggestion,
    }


def _question_findings(question: Question) -> list[dict[str, str | None]]:
    findings: list[dict[str, str | None]] = []
    stem_length = len(question.question.strip())
    if stem_length < 18:
        findings.append(_finding(
            "QUESTION_STEM_TOO_SHORT", "warning", "question", question.id, "Câu hỏi quá ngắn",
            "Câu hỏi chưa đủ ngữ cảnh để học sinh xác định yêu cầu.",
            "Viết rõ kiến thức hoặc tình huống mà câu hỏi muốn kiểm tra.",
        ))
    elif stem_length > 360:
        findings.append(_finding(
            "QUESTION_STEM_TOO_LONG", "info", "question", question.id, "Câu hỏi dài",
            "Câu hỏi dài có thể làm tăng tải đọc và che mất yêu cầu chính.",
            "Tách bối cảnh khỏi yêu cầu, hoặc rút gọn còn một nhiệm vụ rõ ràng.",
        ))

    options = [_normalise(option) for option in question.options if _normalise(option)]
    option_types = {"single", "multiple", "truefalse"}
    if question.type in option_types and len(options) < 2:
        findings.append(_finding(
            "QUESTION_OPTIONS_INSUFFICIENT", "warning", "question", question.id, "Thiếu phương án",
            "Dạng câu hỏi đã chọn cần ít nhất hai phương án.",
            "Bổ sung phương án hợp lệ trước khi chọn câu hỏi này để xuất.",
        ))
    if len(options) != len(set(options)):
        findings.append(_finding(
            "QUESTION_OPTIONS_DUPLICATE", "warning", "question", question.id, "Phương án bị trùng",
            "Có từ hai phương án trở lên có nội dung giống nhau.",
            "Giữ một phương án duy nhất và thay các phương án nhiễu bằng nội dung khác biệt.",
        ))

    answers = _answer_values(question.correct_answer)
    if not any(answers):
        findings.append(_finding(
            "QUESTION_ANSWER_MISSING", "warning", "question", question.id, "Thiếu đáp án đúng",
            "Câu hỏi chưa có đáp án dùng để chấm điểm.",
            "Nhập đáp án đúng và kiểm tra lại định dạng theo loại câu hỏi.",
        ))
    elif question.type in {"single", "truefalse"} and options and answers[0] not in options:
        findings.append(_finding(
            "QUESTION_ANSWER_NOT_IN_OPTIONS", "warning", "question", question.id, "Đáp án không khớp phương án",
            "Đáp án đúng không trùng với bất kỳ phương án nào sau khi chuẩn hóa.",
            "Chọn một phương án hiện có làm đáp án hoặc sửa lại nội dung phương án.",
        ))
    if question.type == "multiple" and not isinstance(question.correct_answer, list):
        findings.append(_finding(
            "QUESTION_MULTIPLE_ANSWER_FORMAT", "warning", "question", question.id, "Định dạng nhiều đáp án chưa đúng",
            "Dạng nhiều đáp án nên lưu một danh sách các phương án đúng.",
            "Nhập đáp án dưới dạng JSON, ví dụ [\"A\", \"C\"].",
        ))
    if question.type == "matching" and not isinstance(question.correct_answer, dict):
        findings.append(_finding(
            "QUESTION_MATCHING_ANSWER_FORMAT", "warning", "question", question.id, "Định dạng ghép đôi chưa đúng",
            "Dạng ghép đôi cần ánh xạ từng vế trái sang vế phải.",
            "Nhập đáp án dưới dạng JSON, ví dụ {\"A\":\"1\", \"B\":\"2\"}.",
        ))
    if question.type == "ordering" and not isinstance(question.correct_answer, list):
        findings.append(_finding(
            "QUESTION_ORDERING_ANSWER_FORMAT", "warning", "question", question.id, "Định dạng sắp xếp chưa đúng",
            "Dạng sắp xếp cần lưu danh sách theo đúng thứ tự.",
            "Nhập đáp án dưới dạng JSON, ví dụ [\"Bước 1\", \"Bước 2\"].",
        ))
    if question.selected and question.score <= 0:
        findings.append(_finding(
            "QUESTION_ZERO_SCORE", "warning", "question", question.id, "Câu được chọn không có điểm",
            "Câu hỏi này được chọn cho quiz nhưng điểm số bằng 0.",
            "Đặt điểm lớn hơn 0 hoặc bỏ chọn câu hỏi nếu chỉ dùng để luyện tập.",
        ))
    if question.selected and not question.objective_ids:
        findings.append(_finding(
            "QUESTION_OBJECTIVE_UNLINKED", "info", "question", question.id, "Chưa liên kết mục tiêu",
            "Câu hỏi được chọn chưa chỉ rõ mục tiêu bài học mà nó đánh giá.",
            "Chọn ít nhất một mục tiêu liên quan trong trình soạn quiz.",
        ))
    return findings


def analyze_course(course: Course) -> dict[str, object]:
    """Return a stable, non-blocking quality report for the current course revision."""
    findings: list[dict[str, str | None]] = []
    if len(course.objectives) < 3:
        findings.append(_finding(
            "COURSE_OBJECTIVES_FEW", "warning", "course", None, "Ít mục tiêu bài học",
            "Bài học có ít hơn ba mục tiêu, nên khó kiểm tra mức độ bao quát của nội dung và quiz.",
            "Bổ sung các mục tiêu có thể quan sát hoặc đánh giá được.",
        ))
    if not course.slides:
        findings.append(_finding(
            "COURSE_SLIDES_EMPTY", "warning", "course", None, "Chưa có slide",
            "Bài học chưa có nội dung slide để kiểm tra.",
            "Tạo ít nhất một slide nội dung trước khi xuất.",
        ))
    for slide in course.slides:
        content = " ".join(block.text or "" for block in slide.blocks if block.type in {"heading", "text", "callout"})
        characters = len(content.strip())
        words = len(content.split())
        if characters > 850:
            findings.append(_finding(
                "SLIDE_TEXT_VERY_DENSE", "warning", "slide", slide.id, "Slide quá nhiều chữ",
                f"Slide có khoảng {words} từ ({characters} ký tự), dễ gây quá tải khi trình chiếu.",
                "Tách slide thành hai hoặc ba ý, ưu tiên gạch đầu dòng và ví dụ ngắn.",
            ))
        elif characters > 500:
            findings.append(_finding(
                "SLIDE_TEXT_DENSE", "info", "slide", slide.id, "Slide có mật độ chữ cao",
                f"Slide có khoảng {words} từ ({characters} ký tự).",
                "Cân nhắc rút gọn câu hoặc chuyển chi tiết sang ghi chú giáo viên.",
            ))
        elif characters < 24:
            findings.append(_finding(
                "SLIDE_TEXT_SPARSE", "info", "slide", slide.id, "Slide có ít nội dung",
                "Slide có rất ít văn bản và có thể thiếu ngữ cảnh nếu không có media kèm theo.",
                "Bổ sung ý chính, ví dụ, hoặc xác nhận slide này có media/hướng dẫn nói kèm theo.",
            ))
        if slide.status == "ai_draft":
            findings.append(_finding(
                "SLIDE_NOT_REVIEWED", "info", "slide", slide.id, "Slide AI nháp chưa được duyệt",
                "Slide vẫn ở trạng thái AI nháp.",
                "Giáo viên cần kiểm tra nội dung rồi chuyển thành Đã sửa hoặc Đã duyệt.",
            ))

    selected = [question for question in course.question_bank if question.selected]
    if course.completion.require_quiz and not selected:
        findings.append(_finding(
            "COURSE_SELECTED_QUIZ_EMPTY", "warning", "course", None, "Chưa chọn câu hỏi quiz",
            "Cấu hình yêu cầu quiz nhưng chưa có câu hỏi nào được chọn.",
            "Chọn ít nhất một câu hỏi hoặc tắt yêu cầu quiz trong cấu hình hoàn thành.",
        ))
    question_stems: Counter[str] = Counter()
    for question in course.question_bank:
        findings.extend(_question_findings(question))
        if question.selected:
            question_stems[_normalise(question.question)] += 1
    for question in selected:
        if question_stems[_normalise(question.question)] > 1:
            findings.append(_finding(
                "QUESTION_STEM_DUPLICATE", "warning", "question", question.id, "Câu hỏi bị lặp",
                "Có nhiều câu hỏi được chọn có cùng nội dung sau khi chuẩn hóa.",
                "Giữ một câu hỏi và thay các câu còn lại bằng kiến thức hoặc tình huống khác.",
            ))

    warning_count = sum(item["severity"] == "warning" for item in findings)
    info_count = sum(item["severity"] == "info" for item in findings)
    score = max(0, 100 - warning_count * 8 - info_count * 2)
    return {
        "course_id": course.id,
        "revision": course.revision,
        "score": score,
        "summary": {"warnings": warning_count, "info": info_count, "checked_slides": len(course.slides), "checked_questions": len(course.question_bank)},
        "findings": findings,
        "blocking": False,
    }
