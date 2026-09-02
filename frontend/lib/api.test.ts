import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject, updateProjectDirection, updateProjectTitle, uploadProjectSource, type Project } from "./api";

const project: Project = {
  id: "course-1",
  title: "Bài cũ",
  status: "active",
  revision: 3,
  access_level: "owner",
  course: {
    id: "course-1",
    revision: 3,
    metadata: { title: "Bài cũ", direction: "lesson", language: "vi-VN" },
    objectives: [],
    slides: [],
    question_bank: [],
  },
};

afterEach(() => vi.restoreAllMocks());

describe("Canonical project API", () => {
  it("creates one canonical draft with the selected direction", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(project), { status: 201 }));

    await createProject("Bài mới", "review");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/projects", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ title: "Bài mới", direction: "review" }),
    }));
  });

  it("updates title by advancing the canonical revision exactly once", async () => {
    const updated = { ...project, title: "Bài mới", revision: 4, course: { ...project.course, revision: 4 } };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(updated), { status: 200 }));

    await updateProjectTitle(project, "Bài mới");

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.expected_revision).toBe(3);
    expect(body.course.id).toBe("course-1");
    expect(body.course.revision).toBe(4);
    expect(body.course.metadata.title).toBe("Bài mới");
  });

  it("persists direction with an optimistic canonical revision", async () => {
    const updated = { ...project, revision: 4, course: { ...project.course, revision: 4, metadata: { ...project.course.metadata, direction: "advanced" } } };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(updated), { status: 200 }));

    await updateProjectDirection(project, "advanced");

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.expected_revision).toBe(3);
    expect(body.course.revision).toBe(4);
    expect(body.course.metadata.direction).toBe("advanced");
    expect(body.course.metadata.title).toBe("Bài cũ");
  });

  it("uploads source bytes as multipart data without setting a content-type header", async () => {
    const source = { id: "source-1", original_name: "lesson.txt", mime_type: "text/plain", byte_size: 3, extracted_text: "abc", created_at: null };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(source), { status: 201 }));

    await uploadProjectSource("course-1", new File(["abc"], "lesson.txt", { type: "text/plain" }));

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(request.method).toBe("POST");
    expect(request.headers).toBeUndefined();
    expect(request.body).toBeInstanceOf(FormData);
  });
});
