"""Testable SCORM 2004 runtime policy, mirrored by the browser runtime."""
from __future__ import annotations

import json
from dataclasses import dataclass, field


@dataclass
class FakeScorm2004API:
    values: dict[str, str] = field(default_factory=dict)
    initialized: bool = False
    terminated: bool = False
    commits: int = 0

    def Initialize(self, _: str) -> str:
        self.initialized = True
        return "true"

    def GetValue(self, key: str) -> str:
        return self.values.get(key, "")

    def SetValue(self, key: str, value: str) -> str:
        self.values[key] = str(value)
        return "true"

    def Commit(self, _: str) -> str:
        self.commits += 1
        return "true"

    def Terminate(self, _: str) -> str:
        self.terminated = True
        return "true"


class ScormRuntime:
    def __init__(self, api: FakeScorm2004API, *, completion_percent: int, passing_score: int, require_quiz: bool = False):
        self.api, self.completion_percent, self.passing_score = api, completion_percent, passing_score
        self.require_quiz = require_quiz
        self.quiz_submitted = False
        self.highest_visited = -1

    def initialize(self) -> None:
        self.api.Initialize("")
        if self.api.GetValue("cmi.completion_status") in {"", "unknown", "not attempted"}:
            self.api.SetValue("cmi.completion_status", "incomplete")
        self.api.Commit("")

    def resume(self) -> dict:
        try:
            return json.loads(self.api.GetValue("cmi.suspend_data") or "{}")
        except json.JSONDecodeError:
            return {}

    def view_slide(self, location: int, total_slides: int) -> None:
        progress = round((location + 1) / max(total_slides, 1) * 100)
        self.highest_visited = max(self.highest_visited, location)
        self.api.SetValue("cmi.location", str(location))
        self.api.SetValue("cmi.progress_measure", str(progress / 100))
        self.api.SetValue("cmi.suspend_data", json.dumps({"location": location, "highestVisited": self.highest_visited}))
        if progress >= self.completion_percent and (not self.require_quiz or self.quiz_submitted):
            self.api.SetValue("cmi.completion_status", "completed")
        self.api.Commit("")

    def submit_score(self, score: float) -> None:
        self.api.SetValue("cmi.score.raw", str(score))
        self.api.SetValue("cmi.score.min", "0")
        self.api.SetValue("cmi.score.max", "100")
        self.api.SetValue("cmi.score.scaled", str(score / 100))
        self.api.SetValue("cmi.success_status", "passed" if score >= self.passing_score else "failed")
        self.quiz_submitted = True
        progress = float(self.api.GetValue("cmi.progress_measure") or 0) * 100
        if progress >= self.completion_percent:
            self.api.SetValue("cmi.completion_status", "completed")
        self.api.Commit("")

    def finish(self, seconds: int) -> None:
        seconds = max(0, seconds)
        self.api.SetValue("cmi.session_time", f"PT{seconds // 3600}H{(seconds % 3600) // 60}M{seconds % 60}S")
        self.api.Commit("")
        self.api.Terminate("")
