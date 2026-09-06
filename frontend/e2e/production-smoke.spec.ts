import { expect, test } from "@playwright/test";

const productionBaseUrl = process.env.PRODUCTION_BASE_URL;

test.skip(!productionBaseUrl, "Set PRODUCTION_BASE_URL to run the public deployment smoke test.");

test("public deployment creates, previews, validates, and downloads a SCORM lesson", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(productionBaseUrl!);

  await page.getByLabel("Tên bài học").fill("Kiểm thử production SCORM");
  await page.getByLabel("Nội dung nguồn").fill("Nước nhận nhiệt sẽ bay hơi. Hơi nước gặp lạnh ngưng tụ thành giọt nước. Đây là dữ liệu giả dùng để kiểm tra triển khai.");
  await page.getByRole("button", { name: "Lưu bản nháp trên thiết bị" }).click();
  await expect(page.getByRole("status")).toContainText("Đã lưu trên trình duyệt");

  await page.getByRole("button", { name: "Tiếp tục →" }).click();
  await page.getByRole("button", { name: "Lưu định hướng" }).click();
  await page.getByRole("button", { name: "Tiếp tục →" }).click();
  await page.getByRole("button", { name: "Tạo bản nháp bằng Mock AI" }).click();
  await expect(page.getByRole("status")).toContainText("Mock AI đã tạo 4 slide và 8 câu hỏi");

  await page.getByRole("button", { name: /Dựng bài giảng/ }).click();
  await page.getByRole("button", { name: "Dựng player SCORM" }).click();
  const preview = page.frameLocator('iframe[title^="Player SCORM"]');
  await expect(preview.getByRole("heading", { name: "Khởi động" })).toBeVisible();

  await page.getByRole("button", { name: /Kiểm tra & xuất/ }).click();
  await page.getByRole("button", { name: "Kiểm tra chất lượng" }).click();
  await expect(page.getByText(/cảnh báo • 4 slide • 8 câu hỏi/)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Tải ZIP SCORM" }).click();
  await expect((await download).suggestedFilename()).toBe("Kiem_thu_production_SCORM_SCORM2004.zip");
});
