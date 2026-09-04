import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const runtime = readFileSync(resolve(process.cwd(), "../serverless/studio/runtime.js"), "utf8");
const playerScript = readFileSync(resolve(process.cwd(), "../serverless/studio/player.js"), "utf8");

test("packaged SCORM runtime completes the SCORM 2004 lifecycle against a simulated LMS", async ({ page }) => {
  await page.setContent(`<!doctype html><title>SCORM runtime harness</title><p>Harness</p>`);
  await page.evaluate(() => {
    const values: Record<string, string> = {};
    const calls: string[] = [];
    Object.assign(window, {
      SCORM_CFG: { trackCompletion: true },
      API_1484_11: {
        Initialize: () => { calls.push("Initialize"); return "true"; },
        GetValue: (key: string) => values[key] ?? "",
        SetValue: (key: string, value: string) => { values[key] = String(value); calls.push(`SetValue:${key}`); return "true"; },
        Commit: () => { calls.push("Commit"); return "true"; },
        Terminate: () => { calls.push("Terminate"); return "true"; },
      },
      __scormHarness: { values, calls },
    });
  });
  await page.addScriptTag({ content: runtime });

  await expect.poll(() => page.evaluate(() => (window as typeof window & { Initialize: () => string }).Initialize())).toBe("true");
  const result = await page.evaluate(() => {
    const scormWindow = window as typeof window & {
      SetValue: (key: string, value: string) => string;
      Commit: () => string;
      scormSuspend: (state: object) => string;
      scormResume: () => object;
      scormFinish: () => string;
      __scormHarness: { values: Record<string, string>; calls: string[] };
    };
    scormWindow.SetValue("cmi.location", "2");
    scormWindow.scormSuspend({ location: 2, highestVisited: 3 });
    scormWindow.Commit();
    const resumed = scormWindow.scormResume();
    const terminated = scormWindow.scormFinish();
    return { resumed, terminated, values: scormWindow.__scormHarness.values, calls: scormWindow.__scormHarness.calls };
  });

  expect(result.resumed).toEqual({ location: 2, highestVisited: 3 });
  expect(result.terminated).toBe("true");
  expect(result.values["cmi.completion_status"]).toBe("incomplete");
  expect(result.values["cmi.location"]).toBe("2");
  expect(result.values["cmi.session_time"]).toMatch(/^PT\d+H\d+M\d+S$/);
  expect(result.calls).toEqual(expect.arrayContaining(["Initialize", "Commit", "Terminate"]));
});

test("packaged player restores state, scores a quiz, and keeps success separate from completion", async ({ page }) => {
  const course = {
    id: "scorm-player-test", revision: 1,
    metadata: { title: "Nước", direction: "lesson", language: "vi-VN" }, objectives: [],
    slides: [
      { id: "s1", title: "Khởi động", layout: "content", status: "approved", blocks: [{ id: "b1", type: "text", text: "Nước bốc hơi.", settings: {} }] },
      { id: "s2", title: "Củng cố", layout: "content", status: "approved", blocks: [{ id: "b2", type: "text", text: "Chọn đáp án.", settings: {} }] },
    ],
    question_bank: [{ id: "q1", type: "single", question: "Nước bốc hơi tạo gì?", selected: true, score: 1, difficulty: "understand", correct_answer: "Hơi nước", options: ["Hơi nước", "Đá"], objective_ids: [], settings: {} }],
    theme: { id: "default" }, navigation: { mode: "free", show_menu: true, show_progress: true },
    completion: { viewed_percent: 90, passing_score: 70, require_quiz: true },
    scorm: { standard: "SCORM_2004", preset: "k12online", resume: true, track_score: true, track_completion: true, track_success: true },
  };
  await page.setContent(`<!doctype html><article id="player"></article><button id="back">Back</button><button id="next">Next</button><p id="progress"></p><script id="course-data" type="application/json"></script>`);
  await page.evaluate((payload) => {
    const values: Record<string, string> = { "cmi.suspend_data": JSON.stringify({ location: 1, highestVisited: 1, quizSubmitted: false }) };
    Object.assign(window, {
      SCORM_CFG: { resume: true, trackScore: true, trackCompletion: true, trackSuccess: true },
      API_1484_11: {
        Initialize: () => "true", GetValue: (key: string) => values[key] ?? "",
        SetValue: (key: string, value: string) => { values[key] = String(value); return "true"; },
        Commit: () => "true", Terminate: () => "true",
      },
      __playerHarness: values,
    });
    document.querySelector("#course-data")!.textContent = JSON.stringify(payload);
  }, course);
  await page.addScriptTag({ content: runtime });
  await page.addScriptTag({ content: playerScript });
  await page.evaluate(() => {
    const scormWindow = window as typeof window & { Initialize: () => string; restoreState: () => void };
    scormWindow.Initialize();
    scormWindow.restoreState();
  });

  await expect(page.getByRole("heading", { name: "Củng cố" })).toBeVisible();
  await page.locator('input[value="Hơi nước"]').check();
  await page.getByRole("button", { name: "Nộp bài" }).click();
  await expect(page.locator("#quizResult")).toContainText("Điểm: 100%. Đạt.");
  const values = await page.evaluate(() => (window as typeof window & { __playerHarness: Record<string, string> }).__playerHarness);
  expect(values["cmi.location"]).toBe("1");
  expect(values["cmi.progress_measure"]).toBe("1");
  expect(values["cmi.score.raw"]).toBe("100");
  expect(values["cmi.score.scaled"]).toBe("1");
  expect(values["cmi.success_status"]).toBe("passed");
  expect(values["cmi.completion_status"]).toBe("completed");
});

test("packaged player scores matching, ordering, drag-drop, and HTTPS image questions", async ({ page }) => {
  const course = {
    id: "scorm-advanced-test", revision: 1,
    metadata: { title: "Tương tác", direction: "lesson", language: "vi-VN" }, objectives: [],
    slides: [
      { id: "s1", title: "Khởi động", layout: "content", status: "approved", blocks: [{ id: "b1", type: "text", text: "Bắt đầu.", settings: {} }] },
      { id: "s2", title: "Luyện tập", layout: "content", status: "approved", blocks: [{ id: "b2", type: "text", text: "Thực hành.", settings: {} }] },
    ],
    question_bank: [
      { id: "match", type: "matching", question: "Ghép cặp", selected: true, score: 1, difficulty: "understand", correct_answer: { "Mặt Trời": "Sao", "Trái Đất": "Hành tinh" }, options: ["Hành tinh", "Sao"], objective_ids: [], settings: {} },
      { id: "order", type: "ordering", question: "Sắp xếp", selected: true, score: 1, difficulty: "understand", correct_answer: ["Bốc hơi", "Ngưng tụ"], options: ["Ngưng tụ", "Bốc hơi"], objective_ids: [], settings: {} },
      { id: "drag", type: "dragdrop", question: "Kéo thả", selected: true, score: 1, difficulty: "understand", correct_answer: ["Hơi nước", "Mây"], options: ["Mây", "Hơi nước"], objective_ids: [], settings: {} },
      { id: "image", type: "image", question: "Chọn hình", selected: true, score: 1, difficulty: "understand", correct_answer: "water", options: ["rock", "water"], objective_ids: [], settings: { external_media_rights_confirmed: true, image_options: [{ id: "water", src: "https://example.com/water.png", label: "Giọt nước" }, { id: "rock", src: "https://example.com/rock.png", label: "Hòn đá" }] } },
    ],
    theme: { id: "default" }, navigation: { mode: "free", show_menu: true, show_progress: true },
    completion: { viewed_percent: 90, passing_score: 70, require_quiz: true },
    scorm: { standard: "SCORM_2004", preset: "k12online", resume: true, track_score: true, track_completion: true, track_success: true },
  };
  await page.setContent(`<!doctype html><article id="player"></article><button id="back">Back</button><button id="next">Next</button><p id="progress"></p><script id="course-data" type="application/json"></script>`);
  await page.evaluate((payload) => {
    const values: Record<string, string> = {};
    Object.assign(window, {
      SCORM_CFG: { resume: true, trackScore: true, trackCompletion: true, trackSuccess: true },
      API_1484_11: { Initialize: () => "true", GetValue: (key: string) => values[key] ?? "", SetValue: (key: string, value: string) => { values[key] = String(value); return "true"; }, Commit: () => "true", Terminate: () => "true" },
      __advancedHarness: values,
    });
    document.querySelector("#course-data")!.textContent = JSON.stringify(payload);
  }, course);
  await page.addScriptTag({ content: runtime });
  await page.addScriptTag({ content: playerScript });
  await page.evaluate(() => {
    const scormWindow = window as typeof window & { Initialize: () => string; restoreState: () => void };
    scormWindow.Initialize(); scormWindow.restoreState();
  });
  await page.getByRole("button", { name: "Next" }).click();
  await page.locator('[data-match-left="Mặt Trời"]').selectOption("Sao");
  await page.locator('[data-match-left="Trái Đất"]').selectOption("Hành tinh");
  await page.getByRole("button", { name: "Bốc hơi" }).click();
  await page.getByRole("button", { name: "Ngưng tụ" }).click();
  await page.getByRole("button", { name: "Hơi nước" }).click();
  await page.getByRole("button", { name: "Mây" }).click();
  await page.locator('input[value="water"]').check();
  await expect(page.locator('img[alt="Giọt nước"]')).toBeVisible();
  await page.getByRole("button", { name: "Nộp bài" }).click();
  await expect(page.locator("#quizResult")).toContainText("Điểm: 100%. Đạt.");
  const values = await page.evaluate(() => (window as typeof window & { __advancedHarness: Record<string, string> }).__advancedHarness);
  expect(values["cmi.score.raw"]).toBe("100");
  expect(values["cmi.success_status"]).toBe("passed");
  expect(values["cmi.completion_status"]).toBe("completed");
});
