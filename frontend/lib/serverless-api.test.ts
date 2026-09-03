import { afterEach, describe, expect, it, vi } from "vitest";
import { serverlessExport } from "./serverless-api";
import type { CanonicalCourse } from "./api";

afterEach(() => vi.restoreAllMocks());

describe("serverless API client", () => {
  it("uses the same-origin API proxy and sends canonical course data only", async () => {
    const course = { id: "local", revision: 1 } as CanonicalCourse;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Blob(["zip"]), { status: 200, headers: { "Content-Disposition": 'attachment; filename="lesson.zip"' } }));
    await expect(serverlessExport(course)).resolves.toMatchObject({ filename: "lesson.zip" });
    expect(fetchMock).toHaveBeenCalledWith("/api/serverless/export", expect.objectContaining({ method: "POST", body: JSON.stringify({ course }) }));
  });
});
