import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearLocalWorkspace, createLocalProject, generateLocalMockCourse, loadLocalWorkspace, parseLocalCourseBackup, restoreLocalCourseBackup, saveLocalSource, updateLocalCanonicalCourse } from "./local-workspace";

beforeEach(() => {
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); },
    removeItem: (key: string) => { items.delete(key); },
  });
});
afterEach(() => { vi.restoreAllMocks(); clearLocalWorkspace(); vi.unstubAllGlobals(); });

describe("local-first workspace", () => {
  it("saves source and metadata together and can retry after a storage error", async () => {
    const created = await createLocalProject("Bài cũ", "lesson", "Nguồn cũ");
    const spy = vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => { throw new Error("quota"); });
    const draft = { title: "Bài mới", direction: "review" as const, sourceText: "Nguồn mới" };
    await expect(saveLocalSource(created, draft)).rejects.toThrow("Không thể lưu");
    expect(loadLocalWorkspace()?.draft.sourceText).toBe("Nguồn cũ");
    expect(loadLocalWorkspace()?.project?.revision).toBe(1);
    await expect(saveLocalSource(created, draft)).resolves.toMatchObject({ title: "Bài mới", revision: 2 });
    expect(loadLocalWorkspace()?.draft).toEqual(draft);
    expect(spy).toHaveBeenCalledTimes(2);
  });
  it("reports a failed write and preserves the last durable course", async () => {
    const created = await createLocalProject("Bài cũ", "lesson", "Nội dung nguồn");
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota"); });
    await expect(updateLocalCanonicalCourse(created, { ...created.course, metadata: { ...created.course.metadata, title: "Bài chưa lưu" } })).rejects.toThrow("Không thể lưu");
    expect(loadLocalWorkspace()?.project?.title).toBe("Bài cũ");
    expect(loadLocalWorkspace()?.project?.revision).toBe(1);
  });

  it("rejects stale edits instead of overwriting another tab", async () => {
    const created = await createLocalProject("Bài cũ", "lesson", "Nguồn");
    await updateLocalCanonicalCourse(created, { ...created.course, metadata: { ...created.course.metadata, title: "Bản mới" } });
    await expect(updateLocalCanonicalCourse(created, created.course)).rejects.toThrow("phiên khác");
    expect(loadLocalWorkspace()?.project?.title).toBe("Bản mới");
  });
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

  it("restores a validated course.json locally and rejects media references", async () => {
    const created = await createLocalProject("Vòng tuần hoàn nước", "lesson", "Nước bốc hơi, ngưng tụ thành mây rồi tạo mưa.");
    const generated = await generateLocalMockCourse(created, "Nước bốc hơi, ngưng tụ thành mây rồi tạo mưa.");
    const backup = { ...generated.course, schema_version: "1.0.0" };

    clearLocalWorkspace();
    const restored = await restoreLocalCourseBackup(backup);
    expect(restored.project.course).toMatchObject({ id: created.id, metadata: { title: "Vòng tuần hoàn nước", direction: "lesson" } });
    expect(restored.project.course).toMatchObject({ schema_version: "1.1.0", completion: { max_attempts: null, show_feedback: true, show_correct_answer: false } });
    expect(restored.draft.sourceText).toContain("bốc hơi");
    expect(loadLocalWorkspace()?.project?.course.question_bank).toHaveLength(8);

    expect(() => parseLocalCourseBackup({ ...backup, slides: [{ ...backup.slides[0], blocks: [{ id: "image", type: "image", asset_id: "unavailable", settings: {} }] }] })).toThrow("không thể khôi phục media");
  });
});
