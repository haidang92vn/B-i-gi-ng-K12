import { describe, expect, it } from "vitest";
import { applyLmsSettings, k12OnlinePreset, lmsWarnings, settingsFromCourse } from "./scorm";
import type { CanonicalCourse } from "./api";

const course: CanonicalCourse = {
  id: "course-1",
  revision: 4,
  metadata: { title: "Bài học", direction: "lesson" },
  objectives: [{ id: "o1", text: "Mục tiêu" }],
  slides: [],
  question_bank: [],
  navigation: { mode: "restricted", show_menu: false, show_progress: true },
  completion: { viewed_percent: 80, passing_score: 75, require_quiz: false },
  scorm: { standard: "SCORM_2004", edition: "4th Edition", preset: "custom", resume: false, track_score: true, track_completion: true, track_success: false },
};

describe("Canonical LMS settings", () => {
  it("reads persisted settings and fills only missing defaults", () => {
    const settings = settingsFromCourse(course);
    expect(settings.navigation.mode).toBe("restricted");
    expect(settings.completion.passing_score).toBe(75);
    expect(settings.completion).toMatchObject({ max_attempts: null, show_feedback: true, show_correct_answer: false });
    expect(settings.scorm.resume).toBe(false);
    expect(settings.scorm.track_success).toBe(false);
  });

  it("updates only canonical LMS sections", () => {
    const updated = applyLmsSettings(course, k12OnlinePreset);
    expect(updated.metadata).toEqual(course.metadata);
    expect(updated.objectives).toEqual(course.objectives);
    expect(updated.navigation?.mode).toBe("free");
    expect(updated.completion).toEqual({ viewed_percent: 90, passing_score: 70, require_quiz: true, max_attempts: null, show_feedback: true, show_correct_answer: false });
    expect(updated.schema_version).toBe("1.1.0");
    expect(updated.scorm?.preset).toBe("k12online");
  });

  it("reports configuration risks without blocking valid custom settings", () => {
    const settings = settingsFromCourse(course);
    settings.completion.require_quiz = true;
    settings.scorm.track_score = false;
    expect(lmsWarnings(settings, 0)).toEqual(expect.arrayContaining([
      expect.stringContaining("chưa có câu hỏi"),
      expect.stringContaining("không nhận điểm"),
    ]));
    settings.completion.show_correct_answer = true;
    settings.completion.show_feedback = false;
    expect(lmsWarnings(settings, 1)).toContain("Đang bật hiện đáp án đúng nhưng phản hồi sau khi nộp đang bị ẩn.");
  });
});
