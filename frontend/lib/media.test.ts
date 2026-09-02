import { describe, expect, it } from "vitest";
import { formatMediaSize, slideNarration, validateMediaFile } from "./media";

describe("Step 6 media helpers", () => {
  it("rejects unsupported and oversized media before upload", () => {
    expect(validateMediaFile({ type: "application/pdf", size: 100 })).toContain("Chỉ nhận");
    expect(validateMediaFile({ type: "image/png", size: 11 * 1024 * 1024 })).toContain("10 MB");
    expect(validateMediaFile({ type: "video/mp4", size: 199 * 1024 * 1024 })).toBeNull();
  });

  it("builds narration only from authored textual blocks", () => {
    expect(slideNarration({
      id: "s1",
      title: "Tiêu đề",
      layout: "content",
      status: "approved",
      blocks: [
        { id: "b1", type: "text", text: "Nội dung chính", settings: {} },
        { id: "b2", type: "image", asset_id: "asset-1", settings: {} },
      ],
      speaker_notes: "Ghi chú",
    })).toBe("Nội dung chính");
  });

  it("formats stored bytes and distinguishes external URLs", () => {
    expect(formatMediaSize(0)).toBe("URL ngoài");
    expect(formatMediaSize(1536)).toBe("2 KB");
    expect(formatMediaSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });
});
