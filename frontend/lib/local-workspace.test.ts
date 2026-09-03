import { afterEach, describe, expect, it, vi } from "vitest";
import { clearLocalWorkspace, createLocalProject, generateLocalMockCourse, loadLocalWorkspace, updateLocalCanonicalCourse } from "./local-workspace";

afterEach(() => clearLocalWorkspace());

describe("local-first workspace", () => {
  it("persists one canonical course draft without calling a backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const created = await createLocalProject("Vòng tuần hoàn nước", "lesson", "Nước bốc hơi, ngưng tụ thành mây rồi tạo mưa.");
    const generated = await generateLocalMockCourse(created, "Nước bốc hơi, ngưng tụ thành mây rồi tạo mưa.");
    const updated = await updateLocalCanonicalCourse(generated, {
      ...generated.course,
      slides: generated.course.slides.map((slide, index) => index ? slide : { ...slide, status: "approved" }),
    });

    expect(updated.revision).toBe(3);
    expect(updated.course.id).toBe(created.id);
    expect(updated.course.slides).toHaveLength(4);
    expect(updated.course.question_bank).toHaveLength(8);
    expect(loadLocalWorkspace()).toMatchObject({ draft: { title: "Vòng tuần hoàn nước", sourceText: expect.stringContaining("bốc hơi") }, project: { id: created.id, revision: 3 } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
