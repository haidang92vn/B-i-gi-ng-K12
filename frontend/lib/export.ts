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
