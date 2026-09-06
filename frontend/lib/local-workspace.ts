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
  try {
    if (!globalThis.localStorage) throw new Error("Storage unavailable");
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    throw new Error("Không thể lưu trên trình duyệt (hết chỗ hoặc bị chặn). Giữ tab này mở, cho phép lưu trữ hoặc giải phóng dung lượng rồi thử lưu lại.");
  }
  memoryWorkspace = snapshot;
  return snapshot;
}

function emptyCourse(projectId: string, title: string, direction: WorkflowDirection): CanonicalCourse {
  return {
    schema_version: "1.1.0",
    id: projectId,
    revision: 1,
    metadata: { title, direction, language: "vi-VN" },
    objectives: [],
    slides: [],
    question_bank: [],
    theme: { id: "default", primary_color: "#3157d5", font_family: null, logo_asset_id: null },
    navigation: { mode: "free", show_menu: true, show_progress: true },
    completion: { viewed_percent: 90, passing_score: 70, require_quiz: true, max_attempts: null, show_feedback: true, show_correct_answer: false },
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
  try { globalThis.localStorage?.removeItem(STORAGE_KEY); }
  catch { throw new Error("Không thể mở bài mới vì trình duyệt đang chặn lưu trữ. Bài hiện tại vẫn được giữ."); }
  memoryWorkspace = null;
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

export async function saveLocalSource(project: Project | null, draft: LocalWorkspace["draft"]): Promise<Project> {
  if (!project) return createLocalProject(draft.title, draft.direction, draft.sourceText);
  const current = requireProject(project.id).project!;
  if (current.revision !== project.revision) throw new Error("Bài đã thay đổi ở phiên khác. Hãy tải lại bản mới nhất trước khi lưu.");
  const revision = current.revision + 1;
  const next = { ...current, title: draft.title, revision, course: {
    ...current.course, revision, metadata: { ...current.course.metadata, title: draft.title, direction: draft.direction },
  } };
  // One durable write keeps source, metadata and revision together even when storage is full.
  return clone(write({ draft, project: next }).project!);
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
  if (current.revision !== project.revision) throw new Error("Bài đã thay đổi ở phiên khác. Hãy giữ nội dung hiện tại và tải lại bản mới nhất.");
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

export async function saveGeneratedCourse(project: Project, course: CanonicalCourse): Promise<Project> {
  return updateLocalCanonicalCourse(project, course);
}

const directionValues = new Set<WorkflowDirection>(["lesson", "review", "advanced"]);
const blockTypes = new Set(["heading", "text", "image", "audio", "video", "callout", "quiz", "embed"]);
const questionTypes = new Set(["single", "multiple", "truefalse", "fill", "matching", "ordering", "dragdrop", "image"]);
const difficultyValues = new Set(["recognize", "understand", "apply", "advanced"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertBackup(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`course.json không hợp lệ: ${message}`);
}

function stringValue(value: unknown, message: string) {
  assertBackup(typeof value === "string" && value.trim().length > 0, message);
  return value;
}

function recordValue(value: unknown, message: string) {
  assertBackup(isRecord(value), message);
  return value;
}

function arrayValue(value: unknown, message: string) {
  assertBackup(Array.isArray(value), message);
  return value;
}

/**
 * Browser-side guard for an untrusted backup file. The server validates again
 * before preview/quality/export; this guard prevents a malformed file from
 * reaching the local editors.
 */
export function parseLocalCourseBackup(value: unknown): CanonicalCourse {
  const course = recordValue(value, "gốc phải là một object.");
  assertBackup(course.schema_version === "1.0.0" || course.schema_version === "1.1.0", "chỉ hỗ trợ schema_version 1.0.0 hoặc 1.1.0.");
  stringValue(course.id, "thiếu id.");
  assertBackup(Number.isInteger(course.revision) && Number(course.revision) >= 1, "revision phải là số nguyên dương.");

  const metadata = recordValue(course.metadata, "thiếu metadata.");
  stringValue(metadata.title, "metadata.title bị thiếu.");
  assertBackup(directionValues.has(metadata.direction as WorkflowDirection), "metadata.direction không được hỗ trợ.");
  stringValue(metadata.language, "metadata.language bị thiếu.");

  const objectives = arrayValue(course.objectives, "objectives phải là mảng.");
  objectives.forEach((objective, index) => {
    const item = recordValue(objective, `objectives[${index}] không hợp lệ.`);
    stringValue(item.id, `objectives[${index}].id bị thiếu.`);
    stringValue(item.text, `objectives[${index}].text bị thiếu.`);
  });

  const slides = arrayValue(course.slides, "slides phải là mảng.");
  slides.forEach((slide, index) => {
    const item = recordValue(slide, `slides[${index}] không hợp lệ.`);
    stringValue(item.id, `slides[${index}].id bị thiếu.`);
    stringValue(item.title, `slides[${index}].title bị thiếu.`);
    stringValue(item.layout, `slides[${index}].layout bị thiếu.`);
    assertBackup(["ai_draft", "edited", "approved"].includes(String(item.status)), `slides[${index}].status không hợp lệ.`);
    arrayValue(item.blocks, `slides[${index}].blocks phải là mảng.`).forEach((block, blockIndex) => {
      const blockItem = recordValue(block, `slides[${index}].blocks[${blockIndex}] không hợp lệ.`);
      stringValue(blockItem.id, `slides[${index}].blocks[${blockIndex}].id bị thiếu.`);
      assertBackup(blockTypes.has(String(blockItem.type)), `slides[${index}].blocks[${blockIndex}].type không được hỗ trợ.`);
      assertBackup(!blockItem.asset_id && !["image", "audio", "video"].includes(String(blockItem.type)), "bản không lưu trữ không thể khôi phục media.");
      assertBackup(blockItem.settings === undefined || isRecord(blockItem.settings), `slides[${index}].blocks[${blockIndex}].settings không hợp lệ.`);
    });
  });

  const questions = arrayValue(course.question_bank, "question_bank phải là mảng.");
  questions.forEach((question, index) => {
    const item = recordValue(question, `question_bank[${index}] không hợp lệ.`);
    stringValue(item.id, `question_bank[${index}].id bị thiếu.`);
    assertBackup(questionTypes.has(String(item.type)), `question_bank[${index}].type không được hỗ trợ.`);
    stringValue(item.question, `question_bank[${index}].question bị thiếu.`);
    assertBackup(typeof item.selected === "boolean", `question_bank[${index}].selected không hợp lệ.`);
    assertBackup(typeof item.score === "number" && Number.isFinite(item.score) && item.score >= 0, `question_bank[${index}].score không hợp lệ.`);
    assertBackup(difficultyValues.has(String(item.difficulty)), `question_bank[${index}].difficulty không hợp lệ.`);
    assertBackup(Object.hasOwn(item, "correct_answer"), `question_bank[${index}].correct_answer bị thiếu.`);
    assertBackup(item.options === undefined || (Array.isArray(item.options) && item.options.every((option) => typeof option === "string")), `question_bank[${index}].options không hợp lệ.`);
    assertBackup(item.objective_ids === undefined || (Array.isArray(item.objective_ids) && item.objective_ids.every((objectiveId) => typeof objectiveId === "string")), `question_bank[${index}].objective_ids không hợp lệ.`);
    assertBackup(item.settings === undefined || isRecord(item.settings), `question_bank[${index}].settings không hợp lệ.`);
  });

  const theme = recordValue(course.theme, "thiếu theme.");
  stringValue(theme.id, "theme.id bị thiếu.");
  const navigation = recordValue(course.navigation, "thiếu navigation.");
  assertBackup(["free", "sequential", "restricted"].includes(String(navigation.mode)), "navigation.mode không hợp lệ.");
  assertBackup(typeof navigation.show_menu === "boolean" && typeof navigation.show_progress === "boolean", "navigation không hợp lệ.");
  const completion = recordValue(course.completion, "thiếu completion.");
  assertBackup(Number.isInteger(completion.viewed_percent) && Number(completion.viewed_percent) >= 0 && Number(completion.viewed_percent) <= 100, "completion.viewed_percent không hợp lệ.");
  assertBackup(Number.isInteger(completion.passing_score) && Number(completion.passing_score) >= 0 && Number(completion.passing_score) <= 100, "completion.passing_score không hợp lệ.");
  assertBackup(typeof completion.require_quiz === "boolean", "completion.require_quiz không hợp lệ.");
  assertBackup(completion.max_attempts === undefined || completion.max_attempts === null || (Number.isInteger(completion.max_attempts) && Number(completion.max_attempts) >= 1 && Number(completion.max_attempts) <= 10), "completion.max_attempts không hợp lệ.");
  assertBackup(completion.show_feedback === undefined || typeof completion.show_feedback === "boolean", "completion.show_feedback không hợp lệ.");
  assertBackup(completion.show_correct_answer === undefined || typeof completion.show_correct_answer === "boolean", "completion.show_correct_answer không hợp lệ.");
  const scorm = recordValue(course.scorm, "thiếu scorm.");
  assertBackup(scorm.standard === "SCORM_2004" && ["k12online", "custom"].includes(String(scorm.preset)), "scorm không hợp lệ.");
  assertBackup(["resume", "track_score", "track_completion", "track_success"].every((key) => typeof scorm[key] === "boolean"), "cấu hình SCORM không hợp lệ.");

  const normalized = clone(course) as CanonicalCourse;
  normalized.schema_version = "1.1.0";
  normalized.completion = { ...normalized.completion!, max_attempts: normalized.completion?.max_attempts ?? null, show_feedback: normalized.completion?.show_feedback ?? true, show_correct_answer: normalized.completion?.show_correct_answer ?? false };
  normalized.question_bank = normalized.question_bank.map((question) => ({ ...question, options: question.options || [], objective_ids: question.objective_ids || [], settings: question.settings || {} }));
  normalized.slides = normalized.slides.map((slide) => ({ ...slide, blocks: slide.blocks.map((block) => ({ ...block, settings: block.settings || {} })) }));
  return normalized;
}

export function sourceTextFromCourse(course: CanonicalCourse) {
  const restored = course.slides.flatMap((slide) => slide.blocks).filter((block) => ["heading", "text", "callout"].includes(block.type)).map((block) => block.text?.trim()).filter((text): text is string => Boolean(text)).join("\n\n").slice(0, 24_000);
  return restored || "Đã khôi phục từ course.json. Bản sao không chứa nội dung nguồn ban đầu.";
}

export async function restoreLocalCourseBackup(value: unknown): Promise<LocalWorkspace & { project: Project }> {
  const course = parseLocalCourseBackup(value);
  const project: Project = { id: course.id, title: course.metadata.title, status: "local", revision: course.revision, access_level: "owner", course };
  const workspace = write({ draft: { title: project.title, sourceText: sourceTextFromCourse(course), direction: course.metadata.direction }, project });
  return { ...workspace, project: workspace.project! };
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
