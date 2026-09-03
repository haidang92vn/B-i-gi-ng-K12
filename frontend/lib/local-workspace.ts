import type { CanonicalCourse, CourseSlide, Project, WorkflowDirection } from "@/lib/api";

export type LocalWorkspace = {
  draft: { title: string; sourceText: string; direction: WorkflowDirection };
  project: Project | null;
};

const STORAGE_KEY = "ai-scorm-studio:local-workspace:v1";
let memoryWorkspace: LocalWorkspace | null = null;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function id(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function read(): LocalWorkspace | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as LocalWorkspace;
  } catch {
    // Browser privacy settings can deny localStorage. Keep the active tab usable.
  }
  return memoryWorkspace ? clone(memoryWorkspace) : null;
}

function write(workspace: LocalWorkspace) {
  const snapshot = clone(workspace);
  memoryWorkspace = snapshot;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // The in-memory fallback deliberately disappears when this tab is closed.
  }
  return snapshot;
}

function emptyCourse(projectId: string, title: string, direction: WorkflowDirection): CanonicalCourse {
  return {
    id: projectId,
    revision: 1,
    metadata: { title, direction, language: "vi-VN" },
    objectives: [],
    slides: [],
    question_bank: [],
    navigation: { mode: "free", show_menu: true, show_progress: true },
    completion: { viewed_percent: 90, passing_score: 70, require_quiz: true },
    scorm: { standard: "SCORM_2004", edition: "4th Edition", preset: "k12online", resume: true, track_score: true, track_completion: true, track_success: true },
  };
}

function requireProject(projectId: string) {
  const workspace = read();
  if (!workspace?.project || workspace.project.id !== projectId) throw new Error("Không tìm thấy bản nháp trên trình duyệt này.");
  return workspace;
}

function saveProject(workspace: LocalWorkspace, project: Project) {
  return write({ ...workspace, draft: { ...workspace.draft, title: project.title, direction: project.course.metadata.direction }, project }).project!;
}

export function loadLocalWorkspace(): LocalWorkspace | null {
  return read();
}

export function clearLocalWorkspace() {
  memoryWorkspace = null;
  try { globalThis.localStorage?.removeItem(STORAGE_KEY); } catch { /* noop */ }
}

export function saveLocalDraft(draft: LocalWorkspace["draft"], project: Project | null) {
  return write({ draft: clone(draft), project: project ? clone(project) : null });
}

export async function createLocalProject(title: string, direction: WorkflowDirection, sourceText: string): Promise<Project> {
  const projectId = id("local-course");
  const project: Project = { id: projectId, title, status: "local", revision: 1, access_level: "owner", course: emptyCourse(projectId, title, direction) };
  write({ draft: { title, sourceText, direction }, project });
  return clone(project);
}

export async function getLocalProject(projectId: string): Promise<Project> {
  return clone(requireProject(projectId).project!);
}

export async function updateLocalProjectTitle(project: Project, title: string): Promise<Project> {
  return updateLocalCanonicalCourse(project, { ...project.course, metadata: { ...project.course.metadata, title } });
}

export async function updateLocalProjectDirection(project: Project, direction: WorkflowDirection): Promise<Project> {
  return updateLocalCanonicalCourse(project, { ...project.course, metadata: { ...project.course.metadata, direction } });
}

export async function updateLocalCanonicalCourse(project: Project, draft: CanonicalCourse): Promise<Project> {
  const workspace = requireProject(project.id);
  const current = workspace.project!;
  const revision = current.revision + 1;
  const course: CanonicalCourse = {
    ...clone(draft),
    id: current.id,
    revision,
    metadata: { ...draft.metadata, title: draft.metadata.title || current.title },
  };
  const next: Project = { ...current, title: String(course.metadata.title), revision, course };
  return clone(saveProject(workspace, next));
}

function sentences(source: string) {
  const values = source.replace(/\s+/g, " ").split(/(?<=[.!?])\s+|[;\n]+/).map((value) => value.trim()).filter((value) => value.length > 12);
  return values.length ? values : ["Giáo viên cần bổ sung ngữ cảnh rõ ràng cho nội dung bài học."];
}

export async function generateLocalMockCourse(project: Project, source: string): Promise<Project> {
  const parts = sentences(source);
  const titles: Record<WorkflowDirection, string[]> = {
    lesson: ["Khởi động", "Kiến thức trọng tâm", "Ví dụ – vận dụng", "Củng cố"],
    review: ["Gợi nhớ kiến thức", "Hệ thống hóa", "Luyện tập", "Tổng kết"],
    advanced: ["Đặt vấn đề", "Mở rộng kiến thức", "Thử thách vận dụng", "Kết luận"],
  };
  const slides: CourseSlide[] = titles[project.course.metadata.direction].map((title, index) => ({
    id: `s${index + 1}`, title, layout: "content", status: "ai_draft",
    blocks: [{ id: `s${index + 1}-text`, type: "text", text: `${parts[(index * 2) % parts.length]}\n\n${parts[(index * 2 + 1) % parts.length]}`, settings: {} }],
    speaker_notes: "AI gợi ý – giáo viên cần kiểm tra trước khi xuất.",
  }));
  const course: CanonicalCourse = {
    ...project.course,
    objectives: [
      { id: "o1", text: `Nêu được các ý chính của chủ đề “${project.title}”.` },
      { id: "o2", text: "Vận dụng kiến thức để trả lời câu hỏi và xử lý tình huống." },
      { id: "o3", text: "Hoàn thành hoạt động theo định hướng bài giảng đã chọn." },
    ],
    slides,
    question_bank: Array.from({ length: 8 }, (_, index) => ({
      id: `q${index + 1}`, type: "single" as const, question: `Câu ${index + 1}: Nhận định nào phù hợp nhất với nội dung “${parts[index % parts.length].slice(0, 120).replace(/[.]$/, "")}?`,
      selected: index < 4, score: 1, difficulty: "understand" as const, correct_answer: "Phương án đúng theo nội dung bài học",
      options: ["Phương án đúng theo nội dung bài học", "Phương án gây nhiễu 1", "Phương án gây nhiễu 2", "Phương án gây nhiễu 3"],
      objective_ids: ["o1"], settings: {}, explanation: "Đối chiếu với nội dung bài học trước khi duyệt.",
    })),
  };
  return updateLocalCanonicalCourse(project, course);
}

export async function regenerateLocalSlide(project: Project, slideId: string, input: { source: string; provider?: string; credentialId?: string }): Promise<Project> {
  const parts = sentences(input.source);
  const course = clone(project.course);
  const index = course.slides.findIndex((slide) => slide.id === slideId);
  if (index < 0) throw new Error("Không tìm thấy slide cần tạo lại.");
  const slide = course.slides[index];
  slide.status = "ai_draft";
  const text = slide.blocks.find((block) => block.type === "text");
  if (text) text.text = `${parts[index % parts.length]}\n\n${parts[(index + 1) % parts.length]}`;
  return updateLocalCanonicalCourse(project, course);
}
