import { afterEach, describe, expect, it, vi } from "vitest";
import { serverlessExport, serverlessGenerate, serverlessProviders } from "./serverless-api";
import type { CanonicalCourse } from "./api";

afterEach(() => vi.restoreAllMocks());

describe("serverless API client", () => {
  it("uses the same-origin API proxy and sends canonical course data only", async () => {
    const course = { id: "local", revision: 1 } as CanonicalCourse;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Blob(["zip"]), { status: 200, headers: { "Content-Disposition": 'attachment; filename="lesson.zip"' } }));
    await expect(serverlessExport(course)).resolves.toMatchObject({ filename: "lesson.zip" });
    expect(fetchMock).toHaveBeenCalledWith("/api/serverless/export", expect.objectContaining({ method: "POST", body: JSON.stringify({ course }) }));
  });

  it("reads provider availability and sends only generation input through the proxy", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ mock: { available: true, model: "mock" }, openai: { available: false, model: "gpt-4.1-mini" }, gemini: { available: false, model: "gemini-2.5-flash" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ course: { id: "local", revision: 1 }, provider: "mock", model: "mock" }), { status: 200 }));

    await expect(serverlessProviders()).resolves.toMatchObject({ mock: { available: true }, openai: { available: false } });
    await expect(serverlessGenerate({ title: "Bài học", source: "Nội dung nguồn đầy đủ để tạo nháp.", direction: "lesson", provider: "mock" })).resolves.toMatchObject({ provider: "mock", model: "mock" });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/serverless/providers");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/serverless/generate", expect.objectContaining({ method: "POST", body: JSON.stringify({ title: "Bài học", source: "Nội dung nguồn đầy đủ để tạo nháp.", direction: "lesson", provider: "mock" }) }));
  });
});
