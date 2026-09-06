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
    findings: [
      { code: "SLIDE_NOT_APPROVED", severity: "warning", scope: "slide", item_id: "s3", title: "Slide chưa được duyệt", message: "Ví dụ – vận dụng vẫn là bản nháp.", suggestion: "Duyệt nội dung." },
      { code: "QUESTION_INCOMPLETE", severity: "warning", scope: "question", item_id: "q4", title: "Câu hỏi chưa hoàn chỉnh", message: "Câu 4 thiếu đáp án.", suggestion: "Sửa câu hỏi." },
    ],
    blocking: false,
  } }));
  await page.route("**/api/serverless/preview", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Preview</title><p>Player SCORM</p>" }));
  await page.route("**/api/serverless/export", (route) => route.fulfill({
    contentType: "application/zip",
    headers: { "Content-Disposition": 'attachment; filename="Vong_tuan_hoan_nuoc_SCORM2004.zip"' },
    body: "mock-zip",
  }));
}

async function openReview(page: Page) {
  await mockServerless(page);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "course.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(mockCourse)) });
  await expect(page.getByLabel("Tiêu đề")).toHaveValue("Khởi động");
}

test("leaving review immediately waits for autosave and survives reload", async ({ page }) => {
  await openReview(page);
  await page.getByLabel("Tiêu đề").fill("Tiêu đề vừa sửa");
  await page.getByRole("button", { name: /Kiểm tra & xuất/ }).click();
  await expect(page.getByRole("heading", { name: "Kiểm tra & xuất" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /Giáo viên duyệt/ }).click();
  await expect(page.getByLabel("Tiêu đề")).toHaveValue("Tiêu đề vừa sửa");
});

test("cancelling a new lesson preserves the current draft", async ({ page }) => {
  await openReview(page);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "+ Bài mới" }).click();
  await expect(page.getByLabel("Tiêu đề")).toHaveValue("Khởi động");
  await page.reload();
  await page.getByRole("button", { name: /Giáo viên duyệt/ }).click();
  await expect(page.getByLabel("Tiêu đề")).toHaveValue("Khởi động");
});

test("storage failure keeps unsaved edits visible and retry persists them", async ({ page }) => {
  await openReview(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (!sessionStorage.getItem("audit-storage-recovered")) throw new DOMException("Full", "QuotaExceededError");
      return original.call(this, key, value);
    };
    Object.assign(window, { recoverStorage: () => { Storage.prototype.setItem = original; } });
  });
  await page.getByLabel("Tiêu đề").fill("Giữ lại khi hết chỗ");
  await expect(page.getByRole("status")).toContainText("Không thể lưu trên trình duyệt");
  await page.getByRole("button", { name: /Kiểm tra & xuất/ }).click();
  await expect(page.getByLabel("Tiêu đề")).toHaveValue("Giữ lại khi hết chỗ");
  await page.evaluate(() => (window as typeof window & { recoverStorage: () => void }).recoverStorage());
  await page.getByRole("button", { name: "Thử lưu lại" }).click();
  await expect(page.getByRole("heading", { name: "Kiểm tra & xuất" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /Giáo viên duyệt/ }).click();
  await expect(page.getByLabel("Tiêu đề")).toHaveValue("Giữ lại khi hết chỗ");
});

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
  await expect(page.getByText("4 cảnh báo • 4 slide • 8 câu hỏi")).toBeVisible();
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

test("quality findings take the teacher to the owning slide or quiz editor", async ({ page }) => {
  await openReview(page);
  await page.getByRole("button", { name: /Kiểm tra & xuất/ }).click();
  await page.getByRole("button", { name: "Kiểm tra chất lượng" }).click();
  await expect(page.getByText("Slide chưa được duyệt")).toBeVisible();
  await page.getByRole("button", { name: "Mở Bước 4: Duyệt slide" }).click();
  await expect(page.getByRole("heading", { name: "Giáo viên duyệt" })).toBeVisible();
  await expect(page.getByLabel("Tiêu đề")).toHaveValue("Ví dụ – vận dụng");
  await page.getByRole("button", { name: /Kiểm tra & xuất/ }).click();
  await page.getByRole("button", { name: "Kiểm tra chất lượng" }).click();
  await page.getByRole("button", { name: "Mở Bước 5: Chọn Quiz" }).click();
  await expect(page.getByRole("heading", { name: "Chọn Quiz" })).toBeVisible();
  await expect(page.getByLabel("Nội dung câu hỏi")).toHaveValue("Câu 4: Nước bốc hơi tạo thành gì?");
});

test("teacher quiz policy is saved in canonical course settings", async ({ page }) => {
  await openReview(page);
  await page.getByRole("button", { name: /Cấu hình LMS/ }).click();
  await page.getByLabel(/Số lượt làm quiz/).selectOption("2");
  await page.getByLabel(/Hiện đáp án đúng/).check();
  await expect(page.getByRole("status")).toContainText("Đã lưu cấu hình");
  await page.reload();
  await page.getByRole("button", { name: /Cấu hình LMS/ }).click();
  await expect(page.getByLabel(/Số lượt làm quiz/)).toHaveValue("2");
  await expect(page.getByLabel(/Hiện phản hồi sau khi nộp/)).toBeChecked();
  await expect(page.getByLabel(/Hiện đáp án đúng/)).toBeChecked();
});
