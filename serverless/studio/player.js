/* Stateless SCORM player. Course data is provided by index.html, never persisted here. */
const course = JSON.parse(document.querySelector("#course-data").textContent);
const CFG = window.SCORM_CFG || {};
const selected = course.question_bank.filter((question) => question.selected);
let i = 0;
let highestVisited = 0;
let quizSubmitted = false;
let draggingToken = null;
const player = document.querySelector("#player");
const back = document.querySelector("#back");
const next = document.querySelector("#next");
const progress = document.querySelector("#progress");

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
  return selected.map((question) => `<section class="question" data-question="${escapeHtml(question.id)}" data-type="${escapeHtml(question.type)}"><strong>${escapeHtml(question.question)}</strong><div class="answers">${answerMarkup(question)}</div></section>`).join("");
}

function selectedAnswer(question) {
  const root = questionElement(question);
  if (!root) return "";
  if (question.type === "fill") return root.querySelector("[data-answer]")?.value || "";
  if (question.type === "matching") return Object.fromEntries([...root.querySelectorAll("[data-match-left]")].map((input) => [input.dataset.matchLeft, input.value]));
  if (["ordering", "dragdrop"].includes(question.type)) return [...root.querySelectorAll("[data-sequence-answer] .sequence-token")].map((token) => token.dataset.value || "");
  return [...root.querySelectorAll("input:checked")].map((input) => input.value);
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
  const total = selected.reduce((sum, question) => sum + Number(question.score), 0);
  const earned = selected.reduce((sum, question) => sum + (isCorrect(question, selectedAnswer(question)) ? Number(question.score) : 0), 0);
  const score = total ? Math.round((earned / total) * 100) : 0;
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

function moveToken(target) {
  const question = target.closest("[data-question]");
  const answer = question?.querySelector("[data-sequence-answer]");
  const bank = question?.querySelector("[data-sequence-bank]");
  if (!answer || !bank) return;
  if (target.closest("[data-sequence-answer]")) bank.appendChild(target); else answer.appendChild(target);
}

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest(".sequence-token") : null;
  if (target) moveToken(target);
});
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
