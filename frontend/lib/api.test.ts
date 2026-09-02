import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProject,
  generateCourse,
  getProject,
  populateProjectFromGeneration,
  regenerateProjectSlide,
  updateCanonicalCourse,
  updateProjectDirection,
  updateProjectTitle,
  uploadProjectSource,
  type GenerationResponse,
  type Project,
} from "./api";

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

  it("sends only a credential id to AI generation and keeps the same project id", async () => {
    const generated: GenerationResponse = {
      course: {
        ...project.course,
        id: "temporary-ai-id",
        revision: 1,
        objectives: [{ id: "o1", text: "Mục tiêu" }],
        slides: [{ id: "s1", title: "Slide", layout: "content", status: "ai_draft", blocks: [{ id: "b1", type: "text", text: "Nội dung", settings: {} }] }],
        question_bank: [{ id: "q1", question: "Câu hỏi" }],
      },
      objectives: ["Mục tiêu"],
      sections: [{ id: "s1", title: "Slide", content: "Nội dung", note: "" }],
      quizzes: [{ id: "q1", question: "Câu hỏi", quiz_type: "single", selected: true }],
      notice: "Cần duyệt",
      generation: { id: "run-1", provider: "openai", model: "gpt-test", retries: 0 },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(generated), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...project, revision: 4 }), { status: 200 }));

    const response = await generateCourse({ title: "Bài cũ", source: "Nội dung nguồn", direction: "lesson", provider: "openai", credentialId: "credential-1" });
    await populateProjectFromGeneration(project, response);

    const generationBody = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(generationBody.credential_id).toBe("credential-1");
    expect(JSON.stringify(generationBody)).not.toContain("secret");
    const patchBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(patchBody.expected_revision).toBe(3);
    expect(patchBody.course.id).toBe("course-1");
    expect(patchBody.course.revision).toBe(4);
    expect(patchBody.course.metadata.direction).toBe("lesson");
    expect(patchBody.generation_id).toBe("run-1");
  });

  it("autosaves the edited canonical course against the current revision", async () => {
    const edited = {
      ...project.course,
      objectives: [{ id: "o1", text: "Mục tiêu đã sửa" }],
      slides: [{ id: "s1", title: "Slide đã sửa", layout: "callout", status: "edited" as const, blocks: [{ id: "b1", type: "text" as const, text: "Nội dung", settings: {} }] }],
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ...project, revision: 4, course: { ...edited, revision: 4 } }), { status: 200 }));

    await updateCanonicalCourse(project, edited);

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.expected_revision).toBe(3);
    expect(body.course.id).toBe("course-1");
    expect(body.course.revision).toBe(4);
    expect(body.course.slides[0].status).toBe("edited");
  });

  it("regenerates one slide without sending a credential secret", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ...project, revision: 4 }), { status: 200 }));

    await regenerateProjectSlide(project, "slide/1", { source: "Nguồn bài học", provider: "gemini", credentialId: "credential-2" });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/projects/course-1/slides/slide%2F1/regenerate");
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.expected_revision).toBe(3);
    expect(body.credential_id).toBe("credential-2");
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("reports revision conflicts and can reload the explicit server version", async () => {
    const latest = { ...project, revision: 5, course: { ...project.course, revision: 5 } };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: { code: "COURSE_REVISION_CONFLICT", message: "The project was updated in another session." } }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(latest), { status: 200 }));

    await expect(updateCanonicalCourse(project, project.course)).rejects.toThrow("phiên khác");
    await expect(getProject(project.id)).resolves.toEqual(latest);
  });
});
