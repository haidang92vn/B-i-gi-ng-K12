import { describe, expect, it } from "vitest";
import { formatByteSize, sortQualityFindings } from "./export";

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
});
