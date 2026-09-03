/* SCORM 2004 RTE adapter. This file is packaged verbatim with every export. */
let API_1484_11 = null;
let scormInitialized = false;
let sessionStartedAt = 0;

function findAPI(startWindow) {
  let current = startWindow;
  for (let attempts = 0; current && attempts < 20; attempts += 1) {
    if (current.API_1484_11) return current.API_1484_11;
    if (!current.parent || current.parent === current) break;
    current = current.parent;
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

function scormSuspend(state) {
  return SetValue("cmi.suspend_data", JSON.stringify(state));
}

function scormResume() {
  try {
    return JSON.parse(GetValue("cmi.suspend_data") || "{}");
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
    SetValue("cmi.session_time", scormDuration(Date.now() - sessionStartedAt));
    Commit();
    return Terminate();
  } catch (_) {
    return "false";
  }
}

window.addEventListener("load", Initialize);
window.addEventListener("beforeunload", scormFinish);
