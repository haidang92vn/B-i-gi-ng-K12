/* SCORM 2004 RTE adapter. This file is packaged verbatim with every export. */
let API_1484_11 = null;
let scormInitialized = false;
let sessionStartedAt = 0;
// SCORM 2004 defines an SPM of 64,000 characters. Keep headroom for LMS quirks.
const SCORM_SUSPEND_DATA_BUDGET = 60000;

function findAPI(startWindow) {
  let current = startWindow;
  for (let attempts = 0; current && attempts < 20; attempts += 1) {
    try {
      if (current.API_1484_11) return current.API_1484_11;
      if (!current.parent || current.parent === current) break;
      current = current.parent;
    } catch (_) {
      // Sandboxed preview cannot inspect its parent. It can still render without an LMS.
      break;
    }
  }
  try {
    if (window.opener && window.opener.API_1484_11) return window.opener.API_1484_11;
  } catch (_) {
    // A cross-origin opener is not a usable SCORM API host.
  }
  return null;
}

function Initialize() {
  if (scormInitialized) return "true";
  API_1484_11 = findAPI(window);
  if (!API_1484_11) return "false";
  try {
    const result = API_1484_11.Initialize("");
    if (result !== "true") return result || "false";
    scormInitialized = true;
    sessionStartedAt = Date.now();
    const cfg = window.SCORM_CFG || {};
    if (cfg.trackCompletion !== false) {
      const status = GetValue("cmi.completion_status");
      if (!status || status === "unknown" || status === "not attempted") {
        SetValue("cmi.completion_status", "incomplete");
        Commit();
      }
    }
    return "true";
  } catch (_) {
    return "false";
  }
}

function GetValue(key) {
  try {
    return API_1484_11 ? (API_1484_11.GetValue(key) || "") : "";
  } catch (_) {
    return "";
  }
}

function SetValue(key, value) {
  try {
    return API_1484_11 ? API_1484_11.SetValue(key, String(value)) : "false";
  } catch (_) {
    return "false";
  }
}

function Commit() {
  try {
    return API_1484_11 ? API_1484_11.Commit("") : "false";
  } catch (_) {
    return "false";
  }
}

function Terminate() {
  try {
    const result = API_1484_11 ? API_1484_11.Terminate("") : "false";
    if (result === "true") scormInitialized = false;
    return result;
  } catch (_) {
    return "false";
  }
}

function suspendCore(state) {
  return {
    location: state.location,
    highestVisited: state.highestVisited,
    visitedSlideRanges: compressNumberRanges(state.visitedSlides),
    quizSubmitted: state.quizSubmitted === true,
    quizAnswers: {},
    quizScore: Number.isFinite(state.quizScore) ? state.quizScore : null,
    quizAttempts: Number.isInteger(state.quizAttempts) && state.quizAttempts >= 0 ? state.quizAttempts : 0,
    suspendDataTruncated: true,
  };
}

function compressNumberRanges(values) {
  const numbers = [...new Set((Array.isArray(values) ? values : []).filter(Number.isInteger).filter((value) => value >= 0))].sort((left, right) => left - right);
  const ranges = [];
  numbers.forEach((value) => {
    const current = ranges[ranges.length - 1];
    if (current && value === current[1] + 1) current[1] = value;
    else ranges.push([value, value]);
  });
  return ranges;
}

function expandNumberRanges(ranges) {
  const values = [];
  (Array.isArray(ranges) ? ranges : []).forEach((range) => {
    if (!Array.isArray(range) || range.length !== 2 || !Number.isInteger(range[0]) || !Number.isInteger(range[1]) || range[0] < 0 || range[1] < range[0]) return;
    // The player never needs indices outside its own slide list; this guard also
    // prevents malformed LMS data from causing an unbounded loop.
    if (range[1] - range[0] > 10000) return;
    for (let value = range[0]; value <= range[1]; value += 1) values.push(value);
  });
  return values;
}

function fitSuspendState(state) {
  const full = JSON.stringify(state);
  if (full.length <= SCORM_SUSPEND_DATA_BUDGET) return { value: full, truncated: state.suspendDataTruncated === true };
  const compact = suspendCore(state);
  const answers = state.quizAnswers && typeof state.quizAnswers === "object" && !Array.isArray(state.quizAnswers) ? state.quizAnswers : {};
  Object.entries(answers).forEach(([questionId, answer]) => {
    const candidate = { ...compact, quizAnswers: { ...compact.quizAnswers, [questionId]: answer } };
    if (JSON.stringify(candidate).length <= SCORM_SUSPEND_DATA_BUDGET) compact.quizAnswers[questionId] = answer;
  });
  let value = JSON.stringify(compact);
  if (value.length > SCORM_SUSPEND_DATA_BUDGET) {
    compact.visitedSlideRanges = [];
    compact.visitedSlidesOmitted = true;
    value = JSON.stringify(compact);
  }
  return { value, truncated: true };
}

function reportSuspendState(detail) {
  try {
    window.dispatchEvent(new CustomEvent("scorm:suspend-status", { detail }));
  } catch (_) {
    // Reporting must never prevent the LMS save attempt.
  }
}

function scormSuspend(state) {
  // Standalone preview intentionally has no LMS host; do not show a false save warning there.
  if (!API_1484_11) return "false";
  const fitted = fitSuspendState(state);
  let result = SetValue("cmi.suspend_data", fitted.value);
  let truncated = fitted.truncated;
  let value = fitted.value;
  if (result !== "true" && state.quizAnswers && Object.keys(state.quizAnswers).length) {
    value = JSON.stringify(suspendCore(state));
    result = SetValue("cmi.suspend_data", value);
    truncated = true;
  }
  reportSuspendState({ saved: result === "true", truncated, characters: value.length, budget: SCORM_SUSPEND_DATA_BUDGET });
  return result;
}

function scormResume() {
  try {
    const state = JSON.parse(GetValue("cmi.suspend_data") || "{}");
    if (!Array.isArray(state.visitedSlides) && Array.isArray(state.visitedSlideRanges)) state.visitedSlides = expandNumberRanges(state.visitedSlideRanges);
    return state;
  } catch (_) {
    return {};
  }
}

function scormDuration(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `PT${Math.floor(seconds / 3600)}H${Math.floor((seconds % 3600) / 60)}M${seconds % 60}S`;
}

function scormFinish() {
  if (!API_1484_11 || !scormInitialized) return "false";
  try {
    window.dispatchEvent(new Event("scorm:before-finish"));
    SetValue("cmi.session_time", scormDuration(Date.now() - sessionStartedAt));
    Commit();
    return Terminate();
  } catch (_) {
    return "false";
  }
}

window.addEventListener("load", Initialize);
window.addEventListener("beforeunload", scormFinish);
