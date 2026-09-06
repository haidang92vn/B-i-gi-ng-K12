import type { QualityFinding } from "./api";

export function formatByteSize(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatExportTime(value: string | null) {
  if (!value) return "Không rõ thời điểm";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Không rõ thời điểm" : new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function sortQualityFindings(findings: QualityFinding[]) {
  return [...findings].sort((left, right) => (left.severity === right.severity ? left.title.localeCompare(right.title, "vi") : left.severity === "warning" ? -1 : 1));
}

export function qualityFindingTarget(finding: QualityFinding) {
  if (finding.scope === "slide") return { step: 4, label: "Mở Bước 4: Duyệt slide" };
  if (finding.scope === "question" || finding.code === "NO_QUIZ") return { step: 5, label: "Mở Bước 5: Chọn Quiz" };
  return { step: 7, label: "Mở Bước 7: Cấu hình LMS" };
}

const QUALITY_FOCUS_KEY = "ai-scorm-studio:quality-focus";

export function saveQualityFocus(finding: QualityFinding) {
  if (typeof sessionStorage === "undefined") return;
  if (finding.item_id && (finding.scope === "slide" || finding.scope === "question")) {
    sessionStorage.setItem(QUALITY_FOCUS_KEY, JSON.stringify({ scope: finding.scope, itemId: finding.item_id }));
  } else {
    sessionStorage.removeItem(QUALITY_FOCUS_KEY);
  }
}

export function consumeQualityFocus(scope: "slide" | "question", validIds: string[]) {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(QUALITY_FOCUS_KEY) || "null") as { scope?: string; itemId?: string } | null;
    if (saved?.scope !== scope || !saved.itemId || !validIds.includes(saved.itemId)) return null;
    sessionStorage.removeItem(QUALITY_FOCUS_KEY);
    return saved.itemId;
  } catch {
    sessionStorage.removeItem(QUALITY_FOCUS_KEY);
    return null;
  }
}
