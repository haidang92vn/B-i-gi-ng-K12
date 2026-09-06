/* Stateless SCORM player. Course data is provided by index.html, never persisted here. */
const course = JSON.parse(document.querySelector("#course-data").textContent);
const CFG = window.SCORM_CFG || {};
const selected = course.question_bank.filter((question) => question.selected);
let i = 0;
let highestVisited = 0;
const visitedSlides = new Set();
let quizSubmitted = false;
let quizAnswers = {};
let quizScore = null;
let quizAttempts = 0;
let resumeDataTruncated = false;
let draggingToken = null;
let quizSaveTimer = null;
let quizAttemptStartedAt = null;
let nextInteractionIndex = null;
const player = document.querySelector("#player");
const back = document.querySelector("#back");
const next = document.querySelector("#next");
const progress = document.querySelector("#progress");
const navigation = course.navigation || {};
const quizPolicy = { max_attempts: null, show_feedback: true, show_correct_answer: false, ...(course.completion || {}) };
const resumeWarning = document.createElement("p");
resumeWarning.id = "resume-warning";
resumeWarning.className = "resume-warning";
resumeWarning.setAttribute("role", "status");
resumeWarning.setAttribute("aria-live", "polite");
resumeWarning.hidden = true;
player.before(resumeWarning);
const menu = document.createElement("nav");
menu.id = "slide-menu";
menu.setAttribute("aria-label", "Danh sách slide");
player.before(menu);
menu.hidden = navigation.show_menu === false;
progress.hidden = navigation.show_progress === false;
const accent = course.theme?.primary_color;
if (typeof accent === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(accent)) {
  document.documentElement.style.setProperty("--accent", accent);
}

function showResumeWarning(saved) {
  if (saved) resumeDataTruncated = true;
  resumeWarning.hidden = false;
  resumeWarning.textContent = saved
    ? "LMS đã lưu tiến độ, nhưng một số câu trả lời quá dài không được lưu đầy đủ. Hãy nộp bài trước khi thoát."
    : "LMS chưa lưu được tiến độ phiên này. Hãy giữ trang mở và báo cho giáo viên hoặc quản trị LMS.";
}

window.addEventListener("scorm:suspend-status", (event) => {
  if (event.detail?.saved === true && event.detail?.truncated !== true) {
    resumeDataTruncated = false;
    resumeWarning.hidden = true;
    resumeWarning.textContent = "";
    return;
  }
  showResumeWarning(event.detail?.saved === true);
});

function canNavigate(target) {
  if (!Number.isInteger(target) || target < 0 || target >= course.slides.length) return false;
  if (navigation.mode === "sequential") return target <= highestVisited + 1;
  if (navigation.mode === "restricted") return Math.abs(target - i) <= 1;
  return true;
}

function navigate(target) {
  if (!canNavigate(target)) return;
  captureQuizAnswers();
  i = target;
  render();
}

function renderMenu() {
  menu.replaceChildren(...course.slides.map((slide, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${index + 1}. ${slide.title}`;
    button.disabled = !canNavigate(index);
    if (index === i) button.setAttribute("aria-current", "step");
    button.onclick = () => navigate(index);
    return button;
  }));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function normalise(value) {
  return String(value ?? "").trim().toLocaleLowerCase("vi-VN");
}

function questionElement(question) {
  return [...document.querySelectorAll("[data-question]")].find((element) => element.dataset.question === question.id);
}

function stableShuffle(question, options) {
  let seed = [...String(question.id)].reduce((total, character) => ((total * 31) + character.charCodeAt(0)) >>> 0, 0);
  return [...options].map((value, index) => ({ value, index, sort: (seed = (seed * 1664525 + 1013904223) >>> 0) }))
    .sort((left, right) => left.sort - right.sort || left.index - right.index).map((item) => item.value);
}

function safeImageUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && url.hostname ? url.href : "";
  } catch (_) {
    return "";
  }
}

function imageOptions(question) {
  const configured = Array.isArray(question.settings?.image_options) ? question.settings.image_options : [];
  return configured.filter((item) => item && typeof item === "object" && String(item.id || "") && safeImageUrl(item.src));
}

function matchingMarkup(question) {
  const pairs = question.correct_answer && typeof question.correct_answer === "object" && !Array.isArray(question.correct_answer) ? question.correct_answer : {};
  const values = [...new Set([...Object.values(pairs), ...(Array.isArray(question.options) ? question.options : [])].map(String))];
  return Object.keys(pairs).map((left) => `<label class="matching-option"><span>${escapeHtml(left)}</span><select data-match-left="${escapeHtml(left)}"><option value="">Chọn đáp án</option>${values.map((right) => `<option value="${escapeHtml(right)}">${escapeHtml(right)}</option>`).join("")}</select></label>`).join("");
}

function sequenceMarkup(question) {
  const options = stableShuffle(question, Array.isArray(question.options) ? question.options : []);
  const tokens = options.map((option) => `<button type="button" class="sequence-token" draggable="true" data-value="${escapeHtml(option)}">${escapeHtml(option)}</button>`).join("");
  const label = question.type === "ordering" ? "Sắp xếp các thẻ theo thứ tự đúng." : "Kéo hoặc bấm chọn thẻ theo thứ tự đúng.";
  return `<p class="interaction-help">${label}</p><div class="sequence-bank" data-sequence-bank>${tokens}</div><ol class="sequence-answer" data-sequence-answer aria-label="Đáp án đã chọn"></ol>`;
}

function imageMarkup(question) {
  return imageOptions(question).map((option) => {
    const src = safeImageUrl(option.src);
    const label = String(option.label || option.id);
    return `<label class="image-option"><input type="radio" name="q-${escapeHtml(question.id)}" value="${escapeHtml(option.id)}"><img loading="lazy" src="${escapeHtml(src)}" alt="${escapeHtml(label)}"><span>${escapeHtml(label)}</span></label>`;
  }).join("");
}

function answerMarkup(question) {
  const options = Array.isArray(question.options) ? question.options : [];
  if (["single", "truefalse"].includes(question.type)) return options.map((option) => `<label class="option"><input type="radio" name="q-${escapeHtml(question.id)}" value="${escapeHtml(option)}"> ${escapeHtml(option)}</label>`).join("");
  if (question.type === "multiple") return options.map((option) => `<label class="option"><input type="checkbox" name="q-${escapeHtml(question.id)}" value="${escapeHtml(option)}"> ${escapeHtml(option)}</label>`).join("");
  if (question.type === "fill") return `<input class="answer" data-answer="${escapeHtml(question.id)}" placeholder="Nhập câu trả lời">`;
  if (question.type === "matching") return matchingMarkup(question);
  if (["ordering", "dragdrop"].includes(question.type)) return sequenceMarkup(question);
  if (question.type === "image") return imageMarkup(question);
  return "<p>Không nhận diện được dạng câu hỏi.</p>";
}

function quizMarkup() {
  return selected.map((question) => `<section class="question" data-question="${escapeHtml(question.id)}" data-type="${escapeHtml(question.type)}"><strong>${escapeHtml(question.question)}</strong><div class="answers">${answerMarkup(question)}</div><p class="question-feedback" data-feedback aria-live="polite"></p></section>`).join("");
}

function selectedAnswer(question) {
  const root = questionElement(question);
  if (!root) return "";
  if (question.type === "fill") return root.querySelector("[data-answer]")?.value || "";
  if (question.type === "matching") return Object.fromEntries([...root.querySelectorAll("[data-match-left]")].map((input) => [input.dataset.matchLeft, input.value]));
  if (["ordering", "dragdrop"].includes(question.type)) return [...root.querySelectorAll("[data-sequence-answer] .sequence-token")].map((token) => token.dataset.value || "");
  return [...root.querySelectorAll("input:checked")].map((input) => input.value);
}

function captureQuizAnswers() {
  selected.forEach((question) => {
    if (questionElement(question)) quizAnswers[question.id] = selectedAnswer(question);
  });
}

function restoreQuizAnswers() {
  selected.forEach((question) => {
    const root = questionElement(question);
    if (!root || !Object.prototype.hasOwnProperty.call(quizAnswers, question.id)) return;
    const answer = quizAnswers[question.id];
    if (question.type === "fill") {
      const input = root.querySelector("[data-answer]");
      if (input) input.value = typeof answer === "string" ? answer : "";
      return;
    }
    if (question.type === "matching") {
      const pairs = answer && typeof answer === "object" && !Array.isArray(answer) ? answer : {};
      root.querySelectorAll("[data-match-left]").forEach((input) => {
        const value = String(pairs[input.dataset.matchLeft] ?? "");
        input.value = [...input.options].some((option) => option.value === value) ? value : "";
      });
      return;
    }
    if (["ordering", "dragdrop"].includes(question.type)) {
      const answerRoot = root.querySelector("[data-sequence-answer]");
      const bank = root.querySelector("[data-sequence-bank]");
      if (!answerRoot || !bank) return;
      (Array.isArray(answer) ? answer : []).forEach((value) => {
        const token = [...bank.querySelectorAll(".sequence-token")].find((item) => item.dataset.value === String(value));
        if (token) answerRoot.appendChild(token);
      });
      return;
    }
    const values = new Set((Array.isArray(answer) ? answer : [answer]).map(String));
    root.querySelectorAll("input").forEach((input) => { input.checked = values.has(input.value); });
  });
}

function persistQuizDraft() {
  if (quizSaveTimer !== null) window.clearTimeout(quizSaveTimer);
  quizSaveTimer = null;
  if (!selected.some((question) => questionElement(question))) return;
  captureQuizAnswers();
  saveState();
}

function scheduleQuizDraft() {
  if (quizSaveTimer !== null) window.clearTimeout(quizSaveTimer);
  quizSaveTimer = window.setTimeout(persistQuizDraft, 300);
}

function samePairs(value, expected) {
  if (!value || !expected || typeof value !== "object" || typeof expected !== "object" || Array.isArray(value) || Array.isArray(expected)) return false;
  const received = Object.entries(value).map(([left, right]) => [normalise(left), normalise(right)]).sort(([left], [right]) => left.localeCompare(right));
  const wanted = Object.entries(expected).map(([left, right]) => [normalise(left), normalise(right)]).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(received) === JSON.stringify(wanted);
}

function sameSequence(value, expected) {
  const wanted = Array.isArray(expected) ? expected : [expected];
  return Array.isArray(value) && value.map(normalise).join("|") === wanted.map(normalise).join("|");
}

function isCorrect(question, answer) {
  const expected = question.correct_answer;
  if (question.type === "matching") return samePairs(answer, expected);
  if (["ordering", "dragdrop"].includes(question.type)) return sameSequence(answer, expected);
  if (question.type === "multiple") return Array.isArray(answer) && Array.isArray(expected) && answer.map(normalise).sort().join("|") === expected.map(normalise).sort().join("|");
  const actual = Array.isArray(answer) ? answer[0] : answer;
  return normalise(expected) === normalise(actual);
}

function feedbackText(question, correct) {
  const custom = correct ? question.feedback_correct : question.feedback_incorrect;
  const parts = [correct ? "Đúng." : "Chưa đúng."];
  if (typeof custom === "string" && custom.trim()) parts.push(custom.trim());
  if (typeof question.explanation === "string" && question.explanation.trim()) parts.push(`Giải thích: ${question.explanation.trim()}`);
  if (quizPolicy.show_correct_answer) parts.push(`Đáp án đúng: ${answerText(question.correct_answer)}.`);
  return parts.join(" ");
}

function answerText(answer) {
  if (Array.isArray(answer)) return answer.map(String).join(", ");
  if (answer && typeof answer === "object") return Object.entries(answer).map(([left, right]) => `${left} → ${right}`).join("; ");
  return String(answer ?? "");
}

function canRetryQuiz() {
  return quizPolicy.max_attempts === null || quizAttempts < quizPolicy.max_attempts;
}

function interactionType(question) {
  if (question.type === "truefalse") return "true-false";
  if (["single", "multiple", "image"].includes(question.type)) return "choice";
  if (question.type === "fill") return "fill-in";
  if (question.type === "matching") return "matching";
  if (["ordering", "dragdrop"].includes(question.type)) return "sequencing";
  return "other";
}

function choiceToken(question, value) {
  const options = question.type === "image" ? imageOptions(question).map((option) => option.id) : (Array.isArray(question.options) ? question.options : []);
  const index = options.findIndex((option) => String(option) === String(value));
  return index >= 0 ? `choice-${index + 1}` : "choice-unrecognised";
}

function interactionResponse(question, answer) {
  if (question.type === "truefalse") {
    const value = normalise(Array.isArray(answer) ? answer[0] : answer);
    if (!value) return "";
    return ["true", "đúng", "dung", "1"].includes(value) ? "true" : "false";
  }
  if (["single", "multiple", "image"].includes(question.type)) {
    return (Array.isArray(answer) ? answer : [answer]).filter((value) => value !== "" && value !== undefined).map((value) => choiceToken(question, value)).join("[,]");
  }
  if (question.type === "matching") {
    const pairs = question.correct_answer && typeof question.correct_answer === "object" && !Array.isArray(question.correct_answer) ? question.correct_answer : {};
    const leftValues = Object.keys(pairs);
    const rightValues = [...new Set([...Object.values(pairs), ...(Array.isArray(question.options) ? question.options : [])].map(String))];
    const responses = answer && typeof answer === "object" && !Array.isArray(answer) ? answer : {};
    return leftValues.map((left, index) => {
      const targetIndex = rightValues.indexOf(String(responses[left]));
      return `source-${index + 1}[.]target-${targetIndex >= 0 ? targetIndex + 1 : 0}`;
    }).join("[,]");
  }
  if (["ordering", "dragdrop"].includes(question.type)) {
    const options = Array.isArray(question.options) ? question.options : [];
    return (Array.isArray(answer) ? answer : []).map((value) => {
      const index = options.findIndex((option) => String(option) === String(value));
      return `choice-${index >= 0 ? index + 1 : 0}`;
    }).join("[,]");
  }
  return String(Array.isArray(answer) ? answer.join(", ") : (answer ?? "")).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 1000);
}

function interactionId(question, attempt) {
  return `urn:ai-scorm-studio:${encodeURIComponent(String(course.id))}:${encodeURIComponent(String(question.id))}:attempt-${attempt}`;
}

function interactionTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function reportQuizInteractions() {
  if (nextInteractionIndex === null) {
    const count = Number(GetValue("cmi.interactions._count"));
    nextInteractionIndex = Number.isInteger(count) && count >= 0 ? count : 0;
  }
  const latency = typeof scormDuration === "function" ? scormDuration(Date.now() - (quizAttemptStartedAt || Date.now())) : "PT0H0M0S";
  for (const question of selected) {
    const index = nextInteractionIndex;
    const prefix = `cmi.interactions.${index}`;
    const answer = quizAnswers[question.id];
    // Interaction reporting is optional analytics. Stop cleanly if the LMS does
    // not expose the packed interactions array; core score/completion still save.
    if (SetValue(`${prefix}.id`, interactionId(question, quizAttempts)) !== "true") break;
    nextInteractionIndex += 1;
    SetValue(`${prefix}.type`, interactionType(question));
    SetValue(`${prefix}.timestamp`, interactionTimestamp());
    SetValue(`${prefix}.description`, String(question.question || "").slice(0, 250));
    SetValue(`${prefix}.learner_response`, interactionResponse(question, answer));
    SetValue(`${prefix}.result`, isCorrect(question, answer) ? "correct" : "incorrect");
    SetValue(`${prefix}.latency`, latency);
  }
}

function showQuizFeedback() {
  selected.forEach((question) => {
    const root = questionElement(question);
    if (!root) return;
    root.classList.remove("correct", "incorrect");
    root.querySelectorAll("input, select, button").forEach((control) => { control.disabled = quizSubmitted; });
    const feedback = root.querySelector("[data-feedback]");
    if (!quizSubmitted || !quizPolicy.show_feedback) {
      if (feedback) feedback.textContent = "";
      return;
    }
    const correct = isCorrect(question, quizAnswers[question.id]);
    root.classList.add(correct ? "correct" : "incorrect");
    if (feedback) feedback.textContent = feedbackText(question, correct);
  });
  const submit = document.querySelector("#submitQuiz");
  const retry = document.querySelector("#retryQuiz");
  const attemptStatus = document.querySelector("#attemptStatus");
  if (submit) submit.hidden = quizSubmitted || !canRetryQuiz();
  if (retry) retry.hidden = !quizSubmitted || !canRetryQuiz();
  if (attemptStatus) attemptStatus.textContent = quizPolicy.max_attempts === null
    ? quizAttempts > 0
      ? `Đã nộp ${quizAttempts} lượt • không giới hạn số lượt làm.`
      : "Không giới hạn số lượt làm • chưa nộp."
    : `${quizSubmitted ? "Đã nộp" : "Lượt làm"} ${Math.min(quizAttempts + (quizSubmitted ? 0 : 1), quizPolicy.max_attempts)}/${quizPolicy.max_attempts}.`;
}

function saveState() {
  const viewed = (visitedSlides.size / Math.max(course.slides.length, 1)) * 100;
  if (CFG.resume) {
    SetValue("cmi.location", String(i));
    scormSuspend({ location: i, highestVisited, visitedSlides: [...visitedSlides], quizSubmitted, quizAnswers, quizScore, quizAttempts, ...(resumeDataTruncated ? { suspendDataTruncated: true } : {}) });
  }
  if (CFG.trackCompletion) {
    SetValue("cmi.progress_measure", String(Math.min(1, viewed / 100)));
    if (viewed >= course.completion.viewed_percent && (!course.completion.require_quiz || quizSubmitted)) SetValue("cmi.completion_status", "completed");
  }
  Commit();
}

function render() {
  const slide = course.slides[i];
  const body = slide.blocks.filter((block) => ["heading", "text", "callout"].includes(block.type)).map((block) => {
    const text = escapeHtml(block.text).replace(/\n/g, "<br>");
    return block.type === "heading" ? `<h2>${text}</h2>` : `<p${block.type === "callout" ? ' class="callout-block"' : ""}>${text}</p>`;
  }).join("");
  const quiz = i === course.slides.length - 1 && selected.length ? `<h2>Tự kiểm tra</h2><p id="attemptStatus"></p>${quizMarkup()}<button id="submitQuiz">Nộp bài</button><button id="retryQuiz" hidden>Làm lại quiz</button><p id="quizResult" aria-live="polite"></p>` : "";
  player.className = `layout-${["content", "two_column", "callout", "quiz"].includes(slide.layout) ? slide.layout : "content"}`;
  player.innerHTML = `<h1>${escapeHtml(slide.title)}</h1><div class="slide-body">${body}</div>${quiz}`;
  if (quiz) {
    document.querySelector("#submitQuiz").onclick = submitQuiz;
    document.querySelector("#retryQuiz").onclick = retryQuiz;
    restoreQuizAnswers();
    if (!quizSubmitted && quizAttemptStartedAt === null) quizAttemptStartedAt = Date.now();
    if (quizSubmitted && Number.isFinite(quizScore)) document.querySelector("#quizResult").textContent = `Điểm: ${quizScore}%. ${quizScore >= course.completion.passing_score ? "Đạt" : "Chưa đạt"}.`;
    showQuizFeedback();
  }
  visitedSlides.add(i);
  progress.textContent = `Slide ${i + 1}/${course.slides.length} • Đã xem ${Math.round(visitedSlides.size / course.slides.length * 100)}%`;
  back.disabled = i === 0;
  next.disabled = i === course.slides.length - 1;
  highestVisited = Math.max(highestVisited, i);
  renderMenu();
  saveState();
}

function submitQuiz() {
  if (!canRetryQuiz()) return;
  captureQuizAnswers();
  const total = selected.reduce((sum, question) => sum + Number(question.score), 0);
  const earned = selected.reduce((sum, question) => sum + (isCorrect(question, quizAnswers[question.id]) ? Number(question.score) : 0), 0);
  const score = total ? Math.round((earned / total) * 100) : 0;
  quizSubmitted = true;
  quizScore = score;
  quizAttempts += 1;
  resumeDataTruncated = false;
  reportQuizInteractions();
  if (CFG.trackScore) {
    SetValue("cmi.score.raw", String(score));
    SetValue("cmi.score.min", "0");
    SetValue("cmi.score.max", "100");
    SetValue("cmi.score.scaled", String(score / 100));
  }
  if (CFG.trackSuccess) SetValue("cmi.success_status", score >= course.completion.passing_score ? "passed" : "failed");
  saveState();
  document.querySelector("#quizResult").textContent = `Điểm: ${score}%. ${score >= course.completion.passing_score ? "Đạt" : "Chưa đạt"}.`;
  showQuizFeedback();
}

function retryQuiz() {
  quizSubmitted = false;
  quizAnswers = {};
  quizScore = null;
  resumeDataTruncated = false;
  quizAttemptStartedAt = Date.now();
  if (CFG.trackScore) {
    SetValue("cmi.score.raw", "0");
    SetValue("cmi.score.scaled", "0");
  }
  if (CFG.trackSuccess) SetValue("cmi.success_status", "unknown");
  if (CFG.trackCompletion && course.completion.require_quiz) SetValue("cmi.completion_status", "incomplete");
  render();
}

function moveToken(target) {
  const question = target.closest("[data-question]");
  const answer = question?.querySelector("[data-sequence-answer]");
  const bank = question?.querySelector("[data-sequence-bank]");
  if (!answer || !bank) return;
  if (target.closest("[data-sequence-answer]")) bank.appendChild(target); else answer.appendChild(target);
}

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest(".sequence-token") : null;
  if (target) { moveToken(target); persistQuizDraft(); }
});
document.addEventListener("change", (event) => {
  if (event.target instanceof Element && event.target.closest("[data-question]")) persistQuizDraft();
});
document.addEventListener("input", (event) => {
  if (event.target instanceof Element && event.target.matches("[data-answer]")) scheduleQuizDraft();
});
window.addEventListener("scorm:before-finish", persistQuizDraft);
document.addEventListener("dragstart", (event) => {
  const target = event.target instanceof Element ? event.target.closest(".sequence-token") : null;
  if (target) draggingToken = target;
});
document.addEventListener("dragover", (event) => {
  const target = event.target instanceof Element ? event.target.closest("[data-sequence-answer], [data-sequence-bank]") : null;
  if (target && draggingToken) { event.preventDefault(); target.classList.add("drag-over"); }
});
document.addEventListener("dragleave", (event) => {
  const target = event.target instanceof Element ? event.target.closest("[data-sequence-answer], [data-sequence-bank]") : null;
  target?.classList.remove("drag-over");
});
document.addEventListener("drop", (event) => {
  const target = event.target instanceof Element ? event.target.closest("[data-sequence-answer], [data-sequence-bank]") : null;
  if (target && draggingToken) { event.preventDefault(); target.classList.remove("drag-over"); target.appendChild(draggingToken); draggingToken = null; }
});

function restoreState() {
  if (!CFG.resume) return render();
  const saved = scormResume();
  resumeDataTruncated = saved.suspendDataTruncated === true;
  if (resumeDataTruncated) showResumeWarning(true);
  const location = Number(saved.location ?? GetValue("cmi.location"));
  if (Number.isInteger(location) && location >= 0 && location < course.slides.length) i = location;
  if (Number.isInteger(saved.highestVisited) && saved.highestVisited >= 0) highestVisited = Math.min(saved.highestVisited, course.slides.length - 1);
  visitedSlides.clear();
  if (Array.isArray(saved.visitedSlides)) {
    saved.visitedSlides.filter((index) => Number.isInteger(index) && index >= 0 && index < course.slides.length).forEach((index) => visitedSlides.add(index));
  } else if (Number.isInteger(saved.highestVisited)) {
    // Preserve progress from older packages which stored only the furthest slide.
    for (let index = 0; index <= highestVisited; index++) visitedSlides.add(index);
  }
  quizSubmitted = saved.quizSubmitted === true;
  quizAnswers = saved.quizAnswers && typeof saved.quizAnswers === "object" && !Array.isArray(saved.quizAnswers)
    ? Object.fromEntries(selected.filter((question) => Object.prototype.hasOwnProperty.call(saved.quizAnswers, question.id)).map((question) => [question.id, saved.quizAnswers[question.id]]))
    : {};
  quizScore = Number.isFinite(saved.quizScore) ? saved.quizScore : null;
  quizAttempts = Number.isInteger(saved.quizAttempts) && saved.quizAttempts >= 0 ? saved.quizAttempts : (quizSubmitted ? 1 : 0);
  render();
}

back.onclick = () => navigate(i - 1);
next.onclick = () => navigate(i + 1);
window.addEventListener("load", restoreState);
render();
