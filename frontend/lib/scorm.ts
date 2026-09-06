import type { CanonicalCourse, NavigationMode, ScormPreset } from "./api";

export type LmsSettings = {
  navigation: { mode: NavigationMode; show_menu: boolean; show_progress: boolean };
  completion: { viewed_percent: number; passing_score: number; require_quiz: boolean; max_attempts: number | null; show_feedback: boolean; show_correct_answer: boolean };
  scorm: {
    standard: "SCORM_2004";
    edition: string | null;
    preset: ScormPreset;
    resume: boolean;
    track_score: boolean;
    track_completion: boolean;
    track_success: boolean;
  };
};

export const k12OnlinePreset: LmsSettings = {
  navigation: { mode: "free", show_menu: true, show_progress: true },
  completion: { viewed_percent: 90, passing_score: 70, require_quiz: true, max_attempts: null, show_feedback: true, show_correct_answer: false },
  scorm: {
    standard: "SCORM_2004",
    edition: "4th Edition",
    preset: "k12online",
    resume: true,
    track_score: true,
    track_completion: true,
    track_success: true,
  },
};

export function settingsFromCourse(course: CanonicalCourse): LmsSettings {
  return {
    navigation: { ...k12OnlinePreset.navigation, ...course.navigation },
    completion: { ...k12OnlinePreset.completion, ...course.completion },
    scorm: { ...k12OnlinePreset.scorm, ...course.scorm },
  };
}

export function applyLmsSettings(course: CanonicalCourse, settings: LmsSettings): CanonicalCourse {
  return {
    ...course,
    schema_version: "1.1.0",
    navigation: { ...settings.navigation },
    completion: { ...settings.completion },
    scorm: { ...settings.scorm },
  };
}

export function lmsWarnings(settings: LmsSettings, selectedQuizCount: number): string[] {
  const warnings: string[] = [];
  if (settings.completion.require_quiz && selectedQuizCount === 0) warnings.push("Đang yêu cầu làm quiz nhưng chưa có câu hỏi nào được chọn ở Bước 5.");
  if (!settings.scorm.track_completion) warnings.push("LMS sẽ không nhận trạng thái hoàn thành hoặc tiến độ xem.");
  if (!settings.scorm.track_score) warnings.push("LMS sẽ không nhận điểm số dù người học vẫn thấy kết quả trong player.");
  if (!settings.scorm.track_success) warnings.push("LMS sẽ không nhận trạng thái đạt hoặc chưa đạt.");
  if (!settings.navigation.show_menu && settings.navigation.mode === "free") warnings.push("Điều hướng tự do nhưng menu đang ẩn; người học chỉ có thể dùng nút Trước/Tiếp.");
  if (settings.completion.show_correct_answer && !settings.completion.show_feedback) warnings.push("Đang bật hiện đáp án đúng nhưng phản hồi sau khi nộp đang bị ẩn.");
  return warnings;
}

