import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addProjectMediaUrl,
  ApiUnavailableError,
  attachProjectMedia,
  createProject,
  currentTeacher,
  exportScorm,
  filenameFromContentDisposition,
  generateSlideTTS,
  generateCourse,
  getProject,
  listExports,
  populateProjectFromGeneration,
  regenerateProjectSlide,
  runQualityCheck,
  updateCanonicalCourse,
  updateProjectDirection,
  updateProjectTitle,
  uploadProjectMedia,
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
  it("identifies a frontend deployed without its backend instead of treating it as a login failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Not Found", { status: 404 }));

    await expect(currentTeacher()).rejects.toBeInstanceOf(ApiUnavailableError);
  });

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
        question_bank: [{ id: "q1", type: "single", question: "Câu hỏi", selected: true, score: 1, difficulty: "recognize", correct_answer: "A", options: ["A", "B"], objective_ids: ["o1"], settings: {} }],
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

  it("keeps provider secrets out of per-slide TTS requests", async () => {
    const media = { id: "asset-1", project_id: project.id, slide_id: "slide/1", kind: "audio" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(media), { status: 201 }));

    await generateSlideTTS(project.id, "slide/1", { text: "Lời đọc", voice: "Kore", provider: "gemini", credentialId: "credential-2" });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/projects/course-1/slides/slide%2F1/tts");
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ text: "Lời đọc", voice: "Kore", provider: "gemini", credential_id: "credential-2" });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("uploads teacher media as multipart and confirms rights server-side", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "asset-1" }), { status: 201 }));

    await uploadProjectMedia(project.id, "slide 1", new File(["image"], "lesson.png", { type: "image/png" }));

    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/projects/course-1/media/upload?slide_id=slide%201&rights_confirmed=true");
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(request.body).toBeInstanceOf(FormData);
    expect(request.headers).toBeUndefined();
  });

  it("confirms URL rights and attaches media with the current revision", async () => {
    const updated = { ...project, revision: 4 };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "asset-url" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(updated), { status: 200 }));

    await addProjectMediaUrl(project.id, "s1", { kind: "image", url: "https://example.test/image.png", label: "Minh họa" });
    await attachProjectMedia(project, "s1", "asset-url");

    const urlBody = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(urlBody.rights_confirmed).toBe(true);
    const attachBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(attachBody).toEqual({ asset_id: "asset-url", expected_revision: 3 });
  });

  it("checks only the saved canonical project for authoring guidance", async () => {
    const report = { course_id: project.id, revision: 3, score: 92, summary: { warnings: 1, info: 0, checked_slides: 1, checked_questions: 0 }, findings: [], blocking: false };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(report), { status: 200 }));

    await expect(runQualityCheck(project.id)).resolves.toEqual(report);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/projects/course-1/quality-check", { credentials: "include" });
  });

  it("requests an export by project id and returns a server-validated ZIP", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Blob(["zip"]), {
      status: 200,
      headers: { "Content-Disposition": "attachment; filename=lesson_SCORM2004.zip", "X-Export-Id": "export-1", "X-SCORM-Warning-Count": "2" },
    }));

    const result = await exportScorm(project);

    expect(fetchMock).toHaveBeenCalledWith("/api/export-scorm", expect.objectContaining({ method: "POST", credentials: "include" }));
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.project_id).toBe(project.id);
    expect(body.title).toBe(project.title);
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(result.filename).toBe("lesson_SCORM2004.zip");
    expect(result.exportId).toBe("export-1");
    expect(result.warningCount).toBe(2);
  });

  it("reads export metadata without requesting an object-storage download", async () => {
    const records = [{ id: "export-1", project_id: project.id, filename: "lesson.zip", byte_size: 100, status: "ready", created_at: null }];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(records), { status: 200 }));

    await expect(listExports()).resolves.toEqual(records);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/exports", { credentials: "include" });
  });

  it("uses a safe fallback filename for incomplete response headers", () => {
    expect(filenameFromContentDisposition("attachment; filename=../lesson.zip")).toBe(".._lesson.zip");
    expect(filenameFromContentDisposition(null)).toBe("bai_giang_SCORM2004.zip");
  });
});
