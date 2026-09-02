"""Deterministic scoring for canonical quiz questions."""
from __future__ import annotations

from typing import Any

from prototype.course_models import Question


def normalise(value: Any) -> str:
    return str(value).strip().casefold()


def normalise_set(value: Any) -> set[str]:
    if isinstance(value, (list, tuple, set)):
        return {normalise(item) for item in value}
    return {normalise(value)}


def normalise_matching(value: Any) -> set[tuple[str, str]]:
    if isinstance(value, dict):
        return {(normalise(key), normalise(item)) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        pairs = set()
        for item in value:
            if isinstance(item, (list, tuple)) and len(item) == 2:
                pairs.add((normalise(item[0]), normalise(item[1])))
            else:
                pairs.add((normalise(item), ""))
        return pairs
    return {(normalise(value), "")}


def score_question(question: Question, answer: Any) -> tuple[bool, float]:
    """Return an exact-match result and awarded score without random partial credit."""
    if question.type == "matching":
        is_correct = normalise_matching(answer) == normalise_matching(question.correct_answer)
    elif question.type == "multiple":
        correct = normalise_set(question.correct_answer)
        submitted = normalise_set(answer)
        is_correct = submitted == correct
    elif question.type in {"ordering", "dragdrop"}:
        correct = [normalise(item) for item in question.correct_answer]
        submitted = [normalise(item) for item in answer] if isinstance(answer, (list, tuple)) else [normalise(answer)]
        is_correct = submitted == correct
    else:
        is_correct = normalise(answer) == normalise(question.correct_answer)
    return is_correct, question.score if is_correct else 0.0
