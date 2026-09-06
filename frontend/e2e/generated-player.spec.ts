import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Exercise generated artifacts, including script paths, rather than injecting hand-built HTML.
const root = resolve(process.cwd(), "..");
const localPython = resolve(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const python = process.env.TEST_PYTHON || (existsSync(localPython) ? localPython : "python");
const artifacts = JSON.parse(execFileSync(python, ["-X", "utf8", "-c", `
import sys, json, io, zipfile
sys.path.insert(0, 'serverless')
from studio.app import GenerationPayload, mock_course, render_html, make_zip
course = mock_course(GenerationPayload(title='Browser audit', source='Nội dung bài học đủ dài để kiểm tra player.', direction='lesson'))
course.question_bank = course.question_bank[:1]
course.slides[0].blocks[0].text = '</script><script>window.injected = true</script>'
package, _ = make_zip(course)
with zipfile.ZipFile(io.BytesIO(package)) as archive:
    files = {name: archive.read(name).decode() for name in archive.namelist()}
preview = render_html(course, standalone_preview=True)
variants = {}
for mode in ['free', 'sequential', 'restricted', 'hidden']:
    course.navigation.mode = 'free' if mode == 'hidden' else mode
    course.navigation.show_menu = mode != 'hidden'
    course.navigation.show_progress = mode != 'hidden'
    course.slides[0].layout = 'two_column'
    course.slides[1].layout = 'callout'
    course.theme.primary_color = '#123456'
    package, _ = make_zip(course)
    with zipfile.ZipFile(io.BytesIO(package)) as archive:
        variants[mode] = {'preview': render_html(course, standalone_preview=True), 'files': {name: archive.read(name).decode() for name in archive.namelist()}}
print(json.dumps({'preview': preview, 'files': files, 'variants': variants}, ensure_ascii=True))
`], { cwd: root, encoding: "utf8" })) as { preview: string; files: Record<string, string>; variants: Record<string, { preview: string; files: Record<string, string> }> };

test("generated preview renders and scores inside the actual sandbox policy", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<iframe title="Preview" sandbox="allow-scripts"></iframe>');
  await page.locator("iframe").evaluate((frame, html) => { (frame as HTMLIFrameElement).srcdoc = html; }, artifacts.preview);
  const frame = page.frameLocator("iframe");
  await expect(frame.getByRole("heading", { name: "Khởi động" })).toBeVisible();
  await expect(frame.locator("#resume-warning")).toBeHidden();
  for (let index = 0; index < 3; index++) await frame.getByRole("button", { name: "Tiếp →" }).click();
  await frame.getByRole("radio", { name: "Phương án đúng theo nội dung bài học", exact: true }).check();
  await frame.getByRole("button", { name: "Nộp bài" }).click();
  await expect(frame.locator("#quizResult")).toContainText("100%");
  expect(errors).toEqual([]);
});

for (const format of ["preview", "zip"]) {
  for (const mode of ["free", "sequential", "restricted", "hidden"]) {
    test(`${format} respects ${mode} navigation and layout settings`, async ({ page }) => {
      const artifact = artifacts.variants[mode];
      await page.setViewportSize({ width: 1280, height: 900 });
      if (format === "preview") {
        await page.setContent('<iframe style="width:100%;height:800px" sandbox="allow-scripts"></iframe>');
        await page.locator("iframe").evaluate((frame, html) => { (frame as HTMLIFrameElement).srcdoc = html; }, artifact.preview);
      } else {
        await page.route("https://scorm.test/**", (route) => {
          const name = new URL(route.request().url()).pathname.slice(1);
          return route.fulfill({ contentType: name.endsWith(".js") ? "text/javascript" : "text/html", body: artifact.files[name] ?? "" });
        });
        await page.goto("https://scorm.test/index.html");
      }
      const surface = format === "preview" ? page.frameLocator("iframe") : page;
      await expect(surface.locator(".slide-body")).toHaveCSS("column-count", "2");
      await page.setViewportSize({ width: 600, height: 900 });
      await expect(surface.locator(".slide-body")).toHaveCSS("column-count", "1");
      const menu = surface.locator("#slide-menu");
      const buttons = menu.getByRole("button");
      if (mode === "hidden") {
        await expect(menu).toBeHidden();
        await expect(surface.locator("#progress")).toBeHidden();
      } else if (mode === "free") {
        await buttons.nth(3).click();
        await expect(surface.locator("#progress")).toContainText("50%");
      } else {
        await expect(buttons.nth(3)).toBeDisabled();
        await surface.getByRole("button", { name: "Tiếp →" }).click();
        await expect(surface.locator("#player")).toHaveClass("layout-callout");
        await expect(surface.locator(".slide-body")).toHaveCSS("border-left-color", "rgb(18, 52, 86)");
        await surface.getByRole("button", { name: "Tiếp →" }).click();
        if (mode === "restricted") await expect(buttons.nth(0)).toBeDisabled();
        else await expect(buttons.nth(0)).toBeEnabled();
        await expect(buttons.nth(3)).toBeEnabled();
      }
    });
  }
}

test("real ZIP assets resolve and authored script text is not executed", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://scorm.test/**", (route) => {
    const name = new URL(route.request().url()).pathname.slice(1);
    const body = artifacts.files[name];
    return route.fulfill({ status: body === undefined ? 404 : 200, contentType: name.endsWith(".js") ? "text/javascript" : "text/html", body: body ?? "Not found" });
  });
  await page.goto("https://scorm.test/index.html");
  await expect(page.getByRole("heading", { name: "Khởi động" })).toBeVisible();
  expect(await page.evaluate(() => "injected" in window)).toBe(false);
  for (let index = 0; index < 3; index++) await page.getByRole("button", { name: "Tiếp →" }).click();
  await page.getByRole("radio", { name: "Phương án đúng theo nội dung bài học", exact: true }).check();
  await page.getByRole("button", { name: "Nộp bài" }).click();
  await expect(page.locator("#quizResult")).toContainText("100%");
  expect(errors).toEqual([]);
});
