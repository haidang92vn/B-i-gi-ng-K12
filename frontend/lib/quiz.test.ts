import { describe, expect, it } from "vitest";
import { answerToEditorText, imageOptionsToEditorText, parseEditorAnswer, parseImageOptions, questionWarnings } from "./quiz";
import type { CourseQuestion } from "./api";

const question: CourseQuestion = {
  id: "q1", type: "matching", question: "Ghép cặp", selected: true, score: 2,
  difficulty: "understand", correct_answer: { A: "1", B: "2" }, options: ["1", "2"],
  objective_ids: ["o1"], settings: {},
};

describe("Quiz authoring helpers", () => {
  it("round-trips matching and ordered answers without losing structure", () => {
    const matchingText = answerToEditorText(question.correct_answer, "matching");
    expect(parseEditorAnswer(matchingText, "matching")).toEqual({ A: "1", B: "2" });
    expect(parseEditorAnswer("Bước 1\nBước 2", "ordering")).toEqual(["Bước 1", "Bước 2"]);
  });

  it("parses image choices into canonical settings", () => {
    const options = parseImageOptions("img-1 | asset-1 | Tam giác\nimg-2 | asset-2 | Hình vuông");
    expect(options).toEqual([{ id: "img-1", asset_id: "asset-1", label: "Tam giác" }, { id: "img-2", asset_id: "asset-2", label: "Hình vuông" }]);
    expect(imageOptionsToEditorText({ image_options: options })).toContain("asset-2");
  });

  it("reports actionable authoring warnings", () => {
    expect(questionWarnings({ ...question, question: "", score: 0, options: [], correct_answer: {}, objective_ids: [] })).toEqual([
      "Cần nhập nội dung câu hỏi.", "Câu hỏi đang có 0 điểm.", "Cần ít nhất hai phương án.", "Cần khai báo đáp án đúng.", "Chưa liên kết mục tiêu học tập.",
    ]);
  });
});
