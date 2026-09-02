import type { CourseQuestion, QuestionType } from "@/lib/api";

export type ImageOption = { id: string; asset_id: string; label: string };

export function answerToEditorText(answer: unknown, type: QuestionType): string {
  if (type === "matching" && answer && typeof answer === "object" && !Array.isArray(answer)) {
    return Object.entries(answer as Record<string, unknown>).map(([left, right]) => `${left} => ${String(right)}`).join("\n");
  }
  if (Array.isArray(answer)) return answer.map(String).join("\n");
  return answer == null ? "" : String(answer);
}

export function parseEditorAnswer(value: string, type: QuestionType): unknown {
  const lines = value.split("\n").map((item) => item.trim()).filter(Boolean);
  if (type === "matching") {
    return Object.fromEntries(lines.map((line) => line.split(/=>|\|/, 2).map((item) => item.trim())).filter((parts) => parts.length === 2 && parts[0] && parts[1]));
  }
  if (["multiple", "ordering", "dragdrop"].includes(type)) return lines;
  return value.trim();
}

export function imageOptionsToEditorText(settings: Record<string, unknown>): string {
  const options = Array.isArray(settings.image_options) ? settings.image_options : [];
  return options.map((item) => {
    const option = item as Partial<ImageOption>;
    return `${option.id ?? ""} | ${option.asset_id ?? ""} | ${option.label ?? ""}`;
  }).join("\n");
}

export function parseImageOptions(value: string): ImageOption[] {
  return value.split("\n")
    .map((line) => line.split("|").map((part) => part.trim()))
    .filter((parts) => parts[0] && parts[1])
    .map(([id, asset_id, label]) => ({ id, asset_id, label: label || id }));
}

export function questionWarnings(question: CourseQuestion): string[] {
  const warnings: string[] = [];
  if (!question.question.trim()) warnings.push("Cần nhập nội dung câu hỏi.");
  if (question.score <= 0) warnings.push("Câu hỏi đang có 0 điểm.");
  if (["single", "multiple", "ordering", "dragdrop", "matching"].includes(question.type) && question.options.length < 2) warnings.push("Cần ít nhất hai phương án.");
  if (question.type === "image" && parseImageOptions(imageOptionsToEditorText(question.settings)).length < 2) warnings.push("Cần ít nhất hai ảnh lựa chọn hợp lệ.");
  const answer = question.correct_answer;
  if (answer == null || answer === "" || (Array.isArray(answer) && answer.length === 0) || (typeof answer === "object" && !Array.isArray(answer) && Object.keys(answer as object).length === 0)) warnings.push("Cần khai báo đáp án đúng.");
  if (question.objective_ids.length === 0) warnings.push("Chưa liên kết mục tiêu học tập.");
  return warnings;
}
