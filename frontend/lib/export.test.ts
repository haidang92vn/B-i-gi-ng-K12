import { describe, expect, it } from "vitest";
import { formatByteSize, qualityFindingTarget, sortQualityFindings } from "./export";

describe("SCORM export presentation helpers", () => {
  it("formats storage sizes for export history", () => {
    expect(formatByteSize(512)).toBe("512 B");
    expect(formatByteSize(1536)).toBe("1.5 KB");
    expect(formatByteSize(2 * 1024 * 1024)).toBe("2.0 MB");
  });

  it("keeps technical warnings ahead of advisory information", () => {
    const findings = sortQualityFindings([
      { code: "I", severity: "info", scope: "slide", item_id: null, title: "Thông tin", message: "", suggestion: "" },
      { code: "W", severity: "warning", scope: "course", item_id: null, title: "Cảnh báo", message: "", suggestion: "" },
    ]);
    expect(findings.map((finding) => finding.code)).toEqual(["W", "I"]);
  });

  it("routes each actionable quality finding to the editor that owns it", () => {
    expect(qualityFindingTarget({ code: "SLIDE_TOO_SHORT", severity: "warning", scope: "slide", item_id: "s1", title: "", message: "", suggestion: "" })).toEqual({ step: 4, label: "Mở Bước 4: Duyệt slide" });
    expect(qualityFindingTarget({ code: "QUESTION_INCOMPLETE", severity: "warning", scope: "question", item_id: "q1", title: "", message: "", suggestion: "" })).toEqual({ step: 5, label: "Mở Bước 5: Chọn Quiz" });
    expect(qualityFindingTarget({ code: "NO_QUIZ", severity: "warning", scope: "course", item_id: null, title: "", message: "", suggestion: "" })).toEqual({ step: 5, label: "Mở Bước 5: Chọn Quiz" });
  });
});
