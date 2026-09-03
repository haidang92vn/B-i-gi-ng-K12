import { expect, test, type Page } from "@playwright/test";

const mockCourse = {
  schema_version: "1.0.0",
  id: "local-course-e2e",
  revision: 1,
  metadata: { title: "Vòng tuần hoàn nước", direction: "lesson", language: "vi-VN" },
  objectives: [{ id: "o1", text: "Mô tả được vòng tuần hoàn nước." }],
  slides: ["Khởi động", "Kiến thức trọng tâm", "Ví dụ – vận dụng", "Củng cố"].map((title, index) => ({
    id: `s${index + 1}`,
    title,
    layout: "content",
    status: "ai_draft",
    blocks: [{ id: `b${index + 1}`, type: "text", text: `Nội dung ${title.toLowerCase()} của vòng tuần hoàn nước.`, settings: {} }],
    speaker_notes: "Giáo viên cần kiểm tra trước khi xuất.",
  })),
  question_bank: Array.from({ length: 8 }, (_, index) => ({
    id: `q${index + 1}`,
    type: "single",
    question: `Câu ${index + 1}: Nước bốc hơi tạo thành gì?`,
    selected: index < 4,
    score: 1,
    difficulty: "understand",
    correct_answer: "Hơi nước",
    options: ["Hơi nước", "Đá"],
    objective_ids: ["o1"],
    settings: {},
  })),
  theme: { id: "default", primary_color: "#3157d5", font_family: null, logo_asset_id: null },
  navigation: { mode: "free", show_menu: true, show_progress: true },
  completion: { viewed_percent: 90, passing_score: 70, require_quiz: true },
  scorm: { standard: "SCORM_2004", edition: "4th Edition", preset: "k12online", resume: true, track_score: true, track_completion: true, track_success: true },
};

async function mockServerless(page: Page) {
  await page.route("**/api/serverless/providers", (route) => route.fulfill({ json: {
    mock: { available: true, model: "mock" },
    openai: { available: false, model: "gpt-4.1-mini" },
    gemini: { available: false, model: "gemini-2.5-flash" },
  } }));
  await page.route("**/api/serverless/generate", (route) => route.fulfill({ json: { course: mockCourse, provider: "mock", model: "mock" } }));
  await page.route("**/api/serverless/quality", (route) => route.fulfill({ json: {
    course_id: mockCourse.id,
    revision: mockCourse.revision,
    score: 60,
    summary: { warnings: 4, info: 0, checked_slides: 4, checked_questions: 8 },
    findings: [],
    blocking: false,
  } }));
  await page.route("**/api/serverless/preview", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Preview</title><p>Player SCORM</p>" }));
  await page.route("**/api/serverless/export", (route) => route.fulfill({
    contentType: "application/zip",
    headers: { "Content-Disposition": 'attachment; filename="Vong_tuan_hoan_nuoc_SCORM2004.zip"' },
    body: "mock-zip",
  }));
}

test("teacher can create with Mock AI, review warnings, and download a SCORM ZIP", async ({ page }) => {
  await mockServerless(page);
  await page.goto("/");

  await page.getByLabel("Tên bài học").fill("Vòng tuần hoàn nước");
  await page.getByLabel("Nội dung nguồn").fill("Nước bốc hơi, ngưng tụ thành mây rồi tạo mưa. Chu trình lặp lại trong tự nhiên.");
  await page.getByRole("button", { name: "Lưu bản nháp trên thiết bị" }).click();
  await expect(page.getByRole("status")).toContainText("Đã lưu trên trình duyệt");

  await page.getByRole("button", { name: "Tiếp tục →" }).click();
  await page.getByRole("button", { name: "Lưu định hướng" }).click();
  await page.getByRole("button", { name: "Tiếp tục →" }).click();
  await expect(page.getByRole("radio", { name: /ChatGPT/ })).toBeDisabled();
  await expect(page.getByRole("radio", { name: /Gemini/ })).toBeDisabled();
  await page.getByRole("button", { name: "Tạo bản nháp bằng Mock AI" }).click();
  await expect(page.getByRole("status")).toContainText("Mock AI đã tạo 4 slide và 8 câu hỏi");

  await page.getByRole("button", { name: /Kiểm tra & xuất/ }).click();
  await page.getByRole("button", { name: "Kiểm tra chất lượng" }).click();
  await expect(page.getByText("4 cảnh báo cần giáo viên xem lại.")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Tải ZIP SCORM" }).click();
  await expect((await download).suggestedFilename()).toBe("Vong_tuan_hoan_nuoc_SCORM2004.zip");
});

test("teacher can restore a valid course.json backup into the review step", async ({ page }) => {
  await mockServerless(page);
  await page.goto("/");

  await page.locator('input[type="file"]').setInputFiles({
    name: "course.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(mockCourse)),
  });

  await expect(page.getByRole("status")).toContainText("Đã khôi phục “Vòng tuần hoàn nước” từ course.json");
  await expect(page.getByRole("heading", { name: "Giáo viên duyệt" })).toBeVisible();
  await expect(page.getByLabel("Tiêu đề")).toHaveValue("Khởi động");
});
