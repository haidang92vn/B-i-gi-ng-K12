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
    window.addEventListener("scorm:before-finish", () => calls.push("before-finish"));
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
  expect(result.calls).toEqual(expect.arrayContaining(["Initialize", "Commit", "before-finish", "Terminate"]));
});

test("suspend data stays inside its safety budget and preserves core resume state", async ({ page }) => {
  await page.setContent(`<!doctype html><title>Suspend budget harness</title>`);
  await page.evaluate(() => {
    const values: Record<string, string> = {};
    const statuses: Array<Record<string, unknown>> = [];
    const controls = { maxLength: Number.POSITIVE_INFINITY, suspendWriteLengths: [] as number[] };
    window.addEventListener("scorm:suspend-status", (event: Event) => {
      statuses.push((event as CustomEvent).detail);
    });
    Object.assign(window, {
      API_1484_11: {
        Initialize: () => "true", GetValue: (key: string) => values[key] ?? "",
        SetValue: (key: string, value: string) => {
          if (key === "cmi.suspend_data") controls.suspendWriteLengths.push(String(value).length);
          if (key === "cmi.suspend_data" && String(value).length > controls.maxLength) return "false";
          values[key] = String(value); return "true";
        },
        Commit: () => "true", Terminate: () => "true",
      },
      __budgetHarness: { values, statuses, controls },
    });
  });
  await page.addScriptTag({ content: runtime });
  const result = await page.evaluate(() => {
    const scormWindow = window as typeof window & {
      Initialize: () => string;
      scormSuspend: (state: object) => string;
      scormResume: () => Record<string, unknown>;
      __budgetHarness: { values: Record<string, string>; statuses: Array<Record<string, unknown>>; controls: { maxLength: number; suspendWriteLengths: number[] } };
    };
    scormWindow.Initialize();
    const saved = scormWindow.scormSuspend({
      location: 4, highestVisited: 6, visitedSlides: [0, 1, 2, 4, 6], quizSubmitted: false,
      quizAnswers: { huge: "x".repeat(70000), small: ["B"] }, quizScore: null, quizAttempts: 2,
    });
    const first = {
      saved,
      raw: scormWindow.__budgetHarness.values["cmi.suspend_data"],
      resumed: scormWindow.scormResume(),
      statuses: scormWindow.__budgetHarness.statuses,
    };
    scormWindow.__budgetHarness.controls.maxLength = 300;
    scormWindow.__budgetHarness.controls.suspendWriteLengths = [];
    const retried = scormWindow.scormSuspend({
      location: 2, highestVisited: 2, visitedSlides: [0, 1, 2], quizSubmitted: false,
      quizAnswers: { fill: "y".repeat(1000) }, quizScore: null, quizAttempts: 0,
    });
    return { first, retried, retryRaw: scormWindow.__budgetHarness.values["cmi.suspend_data"], retryLengths: scormWindow.__budgetHarness.controls.suspendWriteLengths };
  });

  expect(result.first.saved).toBe("true");
  expect(result.first.raw.length).toBeLessThanOrEqual(60000);
  expect(result.first.resumed).toMatchObject({
    location: 4, highestVisited: 6, visitedSlides: [0, 1, 2, 4, 6], quizAttempts: 2,
    quizAnswers: { small: ["B"] }, suspendDataTruncated: true,
  });
  expect(result.first.resumed.quizAnswers).not.toHaveProperty("huge");
  expect(result.first.statuses.at(0)).toMatchObject({ saved: true, truncated: true, budget: 60000 });
  expect(result.retried).toBe("true");
  expect(result.retryLengths).toHaveLength(2);
  expect(result.retryLengths[0]).toBeGreaterThan(300);
  expect(result.retryLengths[1]).toBeLessThanOrEqual(300);
  expect(JSON.parse(result.retryRaw)).toMatchObject({ location: 2, quizAnswers: {}, suspendDataTruncated: true });
  expect(result.first.statuses.at(-1)).toMatchObject({ saved: true, truncated: true });
});

test("packaged player restores state, scores a quiz, and keeps success separate from completion", async ({ page }) => {
  const course = {
    id: "scorm-player-test", revision: 1,
    metadata: { title: "Nước", direction: "lesson", language: "vi-VN" }, objectives: [],
    slides: [
      { id: "s1", title: "Khởi động", layout: "content", status: "approved", blocks: [{ id: "b1", type: "text", text: "Nước bốc hơi.", settings: {} }] },
      { id: "s2", title: "Củng cố", layout: "content", status: "approved", blocks: [{ id: "b2", type: "text", text: "Chọn đáp án.", settings: {} }] },
    ],
    question_bank: [{ id: "q1", type: "single", question: "Nước bốc hơi tạo gì?", selected: true, score: 1, difficulty: "understand", correct_answer: "Hơi nước", options: ["Hơi nước", "Đá"], explanation: "Nước chuyển từ thể lỏng sang thể khí.", feedback_correct: "Em đã nhận biết đúng quá trình.", feedback_incorrect: "Hãy xem lại khái niệm bay hơi.", objective_ids: [], settings: {} }],
    theme: { id: "default" }, navigation: { mode: "free", show_menu: true, show_progress: true },
    completion: { viewed_percent: 90, passing_score: 70, require_quiz: true, max_attempts: 2, show_feedback: true, show_correct_answer: true },
    scorm: { standard: "SCORM_2004", preset: "k12online", resume: true, track_score: true, track_completion: true, track_success: true },
  };
  await page.setContent(`<!doctype html><article id="player"></article><button id="back">Back</button><button id="next">Next</button><p id="progress"></p><script id="course-data" type="application/json"></script>`);
  await page.evaluate((payload) => {
    const values: Record<string, string> = { "cmi.suspend_data": JSON.stringify({ location: 1, highestVisited: 1, quizSubmitted: false, quizAnswers: { q1: ["Đá"] }, quizScore: null }) };
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
  await expect(page.locator('input[value="Đá"]')).toBeChecked();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.locator('input[value="Đá"]')).toBeChecked();
  await page.getByRole("button", { name: "Nộp bài" }).click();
  await expect(page.locator("[data-question='q1']")).toHaveClass(/incorrect/);
  await expect(page.locator("[data-feedback]")).toContainText("Hãy xem lại khái niệm bay hơi.");
  await expect(page.locator("[data-feedback]")).toContainText("Giải thích: Nước chuyển từ thể lỏng sang thể khí.");
  await expect(page.locator("[data-feedback]")).toContainText("Đáp án đúng: Hơi nước.");
  await page.getByRole("button", { name: "Làm lại quiz" }).click();
  await expect(page.locator("[data-question='q1'] input:checked")).toHaveCount(0);
  let retryValues = await page.evaluate(() => (window as typeof window & { __playerHarness: Record<string, string> }).__playerHarness);
  expect(retryValues["cmi.completion_status"]).toBe("incomplete");
  expect(retryValues["cmi.success_status"]).toBe("unknown");
  expect(JSON.parse(retryValues["cmi.suspend_data"]).quizSubmitted).toBe(false);
  await page.locator('input[value="Hơi nước"]').check();
  await page.getByRole("button", { name: "Nộp bài" }).click();
  await expect(page.locator("#quizResult")).toContainText("Điểm: 100%. Đạt.");
  await expect(page.locator("[data-question='q1']")).toHaveClass(/correct/);
  await expect(page.locator("[data-feedback]")).toContainText("Em đã nhận biết đúng quá trình.");
  await expect(page.getByRole("button", { name: "Làm lại quiz" })).toBeHidden();
  await expect(page.locator("#attemptStatus")).toContainText("Đã nộp 2/2");
  const values = await page.evaluate(() => (window as typeof window & { __playerHarness: Record<string, string> }).__playerHarness);
  expect(values["cmi.location"]).toBe("1");
  expect(values["cmi.progress_measure"]).toBe("1");
  expect(values["cmi.score.raw"]).toBe("100");
  expect(values["cmi.score.scaled"]).toBe("1");
  expect(values["cmi.success_status"]).toBe("passed");
  expect(values["cmi.completion_status"]).toBe("completed");
  expect(values["cmi.interactions.0.type"]).toBe("choice");
  expect(values["cmi.interactions.0.learner_response"]).toBe("choice-2");
  expect(values["cmi.interactions.0.result"]).toBe("incorrect");
  expect(values["cmi.interactions.1.id"]).toContain("q1:attempt-2");
  expect(values["cmi.interactions.1.description"]).toBe("Nước bốc hơi tạo gì?");
  expect(values["cmi.interactions.1.learner_response"]).toBe("choice-1");
  expect(values["cmi.interactions.1.result"]).toBe("correct");
  expect(values["cmi.interactions.1.timestamp"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  expect(values["cmi.interactions.1.latency"]).toMatch(/^PT\d+H\d+M\d+S$/);
  expect(JSON.parse(values["cmi.suspend_data"]).quizAnswers).toEqual({ q1: ["Hơi nước"] });
  expect(JSON.parse(values["cmi.suspend_data"]).quizScore).toBe(100);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("scorm:suspend-status", { detail: { saved: true, truncated: true } })));
  await expect(page.locator("#resume-warning")).toContainText("một số câu trả lời quá dài");
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
      { id: "multiple", type: "multiple", question: "Chọn hai quá trình", selected: true, score: 1, difficulty: "understand", correct_answer: ["Bay hơi", "Ngưng tụ"], options: ["Bay hơi", "Ngưng tụ", "Đóng băng"], objective_ids: [], settings: {} },
      { id: "fill", type: "fill", question: "Điền hiện tượng", selected: true, score: 1, difficulty: "understand", correct_answer: "Mưa", options: [], objective_ids: [], settings: {} },
    ],
    theme: { id: "default" }, navigation: { mode: "free", show_menu: true, show_progress: true },
    completion: { viewed_percent: 90, passing_score: 70, require_quiz: true, max_attempts: null, show_feedback: false, show_correct_answer: false },
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
  await page.locator('input[value="Bay hơi"]').check();
  await page.locator('input[value="Ngưng tụ"]').check();
  await page.locator('[data-answer="fill"]').fill("Mưa");
  await page.evaluate(() => window.dispatchEvent(new Event("scorm:before-finish")));
  const draft = await page.evaluate(() => JSON.parse((window as typeof window & { __advancedHarness: Record<string, string> }).__advancedHarness["cmi.suspend_data"]));
  expect(draft.quizAnswers.fill).toBe("Mưa");
  await expect(page.locator('img[alt="Giọt nước"]')).toBeVisible();
  await page.getByRole("button", { name: "Nộp bài" }).click();
  await expect(page.locator("#quizResult")).toContainText("Điểm: 100%. Đạt.");
  await expect(page.locator("[data-feedback]").first()).toBeEmpty();
  await expect(page.locator(".question.correct, .question.incorrect")).toHaveCount(0);
  const values = await page.evaluate(() => (window as typeof window & { __advancedHarness: Record<string, string> }).__advancedHarness);
  expect(values["cmi.score.raw"]).toBe("100");
  expect(values["cmi.success_status"]).toBe("passed");
  expect(values["cmi.completion_status"]).toBe("completed");
  expect(values["cmi.interactions.0.type"]).toBe("matching");
  expect(values["cmi.interactions.0.learner_response"]).toBe("source-1[.]target-1[,]source-2[.]target-2");
  expect(values["cmi.interactions.1.type"]).toBe("sequencing");
  expect(values["cmi.interactions.1.learner_response"]).toBe("choice-2[,]choice-1");
  expect(values["cmi.interactions.2.type"]).toBe("sequencing");
  expect(values["cmi.interactions.3.type"]).toBe("choice");
  expect(values["cmi.interactions.4.learner_response"]).toBe("choice-1[,]choice-2");
  expect(values["cmi.interactions.5.type"]).toBe("fill-in");
  expect(values["cmi.interactions.5.learner_response"]).toBe("Mưa");
  for (let index = 0; index < 6; index++) expect(values[`cmi.interactions.${index}.result`]).toBe("correct");
  const suspended = JSON.parse(values["cmi.suspend_data"]);
  expect(suspended.quizAnswers.match).toEqual({ "Mặt Trời": "Sao", "Trái Đất": "Hành tinh" });
  expect(suspended.quizAnswers.order).toEqual(["Bốc hơi", "Ngưng tụ"]);
  expect(suspended.quizAnswers.drag).toEqual(["Hơi nước", "Mây"]);
  expect(suspended.quizAnswers.image).toEqual(["water"]);
  expect(suspended.quizAnswers.multiple).toEqual(["Bay hơi", "Ngưng tụ"]);
  expect(suspended.quizAnswers.fill).toBe("Mưa");
});
