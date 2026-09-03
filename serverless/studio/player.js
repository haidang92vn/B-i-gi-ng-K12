/* Stateless SCORM player. Course data is provided by index.html, never persisted here. */
const course = JSON.parse(document.querySelector("#course-data").textContent);
const CFG = window.SCORM_CFG || {};
const selected = course.question_bank.filter((question) => question.selected);
let i = 0;
let highestVisited = 0;
let quizSubmitted = false;
const player = document.querySelector("#player");
const back = document.querySelector("#back");
const next = document.querySelector("#next");
const progress = document.querySelector("#progress");

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function answerMarkup(question) {
  const options = Array.isArray(question.options) ? question.options : [];
  if (["single", "truefalse"].includes(question.type)) {
    return options.map((option) => `<label class="option"><input type="radio" name="q-${escapeHtml(question.id)}" value="${escapeHtml(option)}"> ${escapeHtml(option)}</label>`).join("");
  }
  if (question.type === "multiple") {
    return options.map((option) => `<label class="option"><input type="checkbox" name="q-${escapeHtml(question.id)}" value="${escapeHtml(option)}"> ${escapeHtml(option)}</label>`).join("");
  }
  if (question.type === "fill") return `<input class="answer" data-answer="${escapeHtml(question.id)}" placeholder="Nhập câu trả lời">`;
  return `<p>Câu hỏi dạng ${escapeHtml(question.type)} cần được kiểm tra trong LMS đích; bản serverless hiện chỉ chấm các dạng chọn một, đúng/sai, chọn nhiều và điền đáp án.</p>`;
}

function quizMarkup() {
  return selected.map((question) => `<section class="question" data-question="${escapeHtml(question.id)}"><strong>${escapeHtml(question.question)}</strong>${answerMarkup(question)}</section>`).join("");
}

function normalise(value) {
  return String(value ?? "").trim().toLocaleLowerCase("vi-VN");
}

function selectedAnswer(question) {
  if (question.type === "fill") return [...document.querySelectorAll("[data-answer]")].find((input) => input.dataset.answer === question.id)?.value || "";
  return [...document.getElementsByName(`q-${question.id}`)].filter((input) => input.checked).map((input) => input.value);
}

function isCorrect(question, answer) {
  const expected = question.correct_answer;
  if (Array.isArray(expected)) return Array.isArray(answer) && expected.map(normalise).sort().join("|") === answer.map(normalise).sort().join("|");
  const actual = Array.isArray(answer) ? answer[0] : answer;
  return normalise(expected) === normalise(actual);
}

function saveState() {
  const viewed = Math.round(((highestVisited + 1) / Math.max(course.slides.length, 1)) * 100);
  if (CFG.resume) {
    SetValue("cmi.location", String(i));
    scormSuspend({ location: i, highestVisited, quizSubmitted });
  }
  if (CFG.trackCompletion) {
    SetValue("cmi.progress_measure", String(Math.min(1, viewed / 100)));
    if (viewed >= course.completion.viewed_percent && (!course.completion.require_quiz || quizSubmitted)) SetValue("cmi.completion_status", "completed");
  }
  Commit();
}

function render() {
  const slide = course.slides[i];
  const body = slide.blocks.filter((block) => ["heading", "text", "callout"].includes(block.type)).map((block) => `<p>${escapeHtml(block.text).replace(/\n/g, "<br>")}</p>`).join("");
  const quiz = i === course.slides.length - 1 && selected.length ? `<h2>Tự kiểm tra</h2>${quizMarkup()}<button id="submitQuiz">Nộp bài</button><p id="quizResult"></p>` : "";
  player.innerHTML = `<h1>${escapeHtml(slide.title)}</h1>${body}${quiz}`;
  if (quiz) document.querySelector("#submitQuiz").onclick = submitQuiz;
  progress.textContent = `Slide ${i + 1}/${course.slides.length}`;
  back.disabled = i === 0;
  next.disabled = i === course.slides.length - 1;
  highestVisited = Math.max(highestVisited, i);
  saveState();
}

function submitQuiz() {
  const supported = selected.filter((question) => ["single", "truefalse", "multiple", "fill"].includes(question.type));
  if (!supported.length) {
    document.querySelector("#quizResult").textContent = "Chưa có câu hỏi nào hỗ trợ chấm trong chế độ serverless.";
    return;
  }
  const total = supported.reduce((sum, question) => sum + Math.max(Number(question.score) || 0, 1), 0);
  const earned = supported.reduce((sum, question) => sum + (isCorrect(question, selectedAnswer(question)) ? Math.max(Number(question.score) || 0, 1) : 0), 0);
  const score = Math.round((earned / total) * 100);
  quizSubmitted = true;
  if (CFG.trackScore) {
    SetValue("cmi.score.raw", String(score));
    SetValue("cmi.score.min", "0");
    SetValue("cmi.score.max", "100");
    SetValue("cmi.score.scaled", String(score / 100));
  }
  if (CFG.trackSuccess) SetValue("cmi.success_status", score >= course.completion.passing_score ? "passed" : "failed");
  saveState();
  document.querySelector("#quizResult").textContent = `Điểm: ${score}%. ${score >= course.completion.passing_score ? "Đạt" : "Chưa đạt"}.`;
}

function restoreState() {
  if (!CFG.resume) return render();
  const saved = scormResume();
  const location = Number(saved.location ?? GetValue("cmi.location"));
  if (Number.isInteger(location) && location >= 0 && location < course.slides.length) i = location;
  if (Number.isInteger(saved.highestVisited) && saved.highestVisited >= 0) highestVisited = Math.min(saved.highestVisited, course.slides.length - 1);
  quizSubmitted = saved.quizSubmitted === true;
  render();
}

back.onclick = () => { i -= 1; render(); };
next.onclick = () => { i += 1; render(); };
window.addEventListener("load", restoreState);
render();
