"""Canonical, versioned course domain model.

The model mirrors ``schemas/course.schema.json``.  It intentionally contains
authoring data only; generated HTML and provider-specific fields stay outside
this module.
"""
from __future__ import annotations

from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Metadata(StrictModel):
    title: str = Field(min_length=1)
    direction: Literal["lesson", "review", "advanced"]
    language: str = "vi-VN"
    subject: str | None = None
    grade: str | None = None
    teacher_name: str | None = None
    school_name: str | None = None


class Objective(StrictModel):
    id: str
    text: str


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
    objectives: list[Objective]
    slides: list[Slide]
    question_bank: list[Question]
    theme: Theme
    navigation: Navigation
    completion: Completion
    scorm: Scorm


def new_course(title: str, direction: Literal["lesson", "review", "advanced"] = "lesson") -> Course:
    """Return the smallest valid canonical course for a newly created project."""
    course_id = str(uuid4())
    return Course(
        id=course_id,
        revision=1,
        metadata=Metadata(title=title, direction=direction),
        objectives=[], slides=[], question_bank=[], theme=Theme(id="default"),
        navigation=Navigation(mode="free", show_menu=True, show_progress=True),
        completion=Completion(viewed_percent=90, passing_score=70, require_quiz=True),
        scorm=Scorm(standard="SCORM_2004", preset="k12online", resume=True,
                    track_score=True, track_completion=True, track_success=True),
    )
