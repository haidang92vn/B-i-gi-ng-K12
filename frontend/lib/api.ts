export type Teacher = {
  id: string;
  email: string;
  full_name: string | null;
  school_name: string | null;
};

export type WorkflowDirection = "lesson" | "review" | "advanced";
export type AIProvider = "mock" | "openai" | "gemini";

export type CourseBlock = {
  id: string;
  type: "heading" | "text" | "image" | "audio" | "video" | "callout" | "quiz" | "embed";
  text?: string | null;
  asset_id?: string | null;
  question_id?: string | null;
  settings: Record<string, unknown>;
};

export type CourseSlide = {
  id: string;
  title: string;
  layout: string;
  status: "ai_draft" | "edited" | "approved";
  blocks: CourseBlock[];
  speaker_notes?: string | null;
};

export type QuestionType = "single" | "multiple" | "truefalse" | "fill" | "matching" | "ordering" | "dragdrop" | "image";
export type QuestionDifficulty = "recognize" | "understand" | "apply" | "advanced";

export type CourseQuestion = {
  id: string;
  type: QuestionType;
  question: string;
  selected: boolean;
  score: number;
  difficulty: QuestionDifficulty;
  correct_answer: unknown;
  options: string[];
  explanation?: string | null;
  feedback_correct?: string | null;
  feedback_incorrect?: string | null;
  objective_ids: string[];
  settings: Record<string, unknown>;
};

export type CanonicalCourse = {
  id: string;
  revision: number;
  metadata: {
    title: string;
    direction: WorkflowDirection;
    [key: string]: unknown;
  };
  objectives: Array<{ id: string; text: string }>;
  slides: CourseSlide[];
  question_bank: CourseQuestion[];
  [key: string]: unknown;
};

export type Project = {
  id: string;
  title: string;
  status: string;
  revision: number;
  course: CanonicalCourse;
  access_level: "owner" | "viewer" | "editor";
};

export type SourceMaterial = {
  id: string;
  original_name: string;
  mime_type: string;
  byte_size: number;
  extracted_text: string | null;
  created_at: string | null;
};

export type AICredential = {
  id: string;
  provider: "openai" | "gemini";
  label: string | null;
  secret_last4: string;
  model_default: string | null;
  status: string;
};

export type GenerationResponse = {
  course: CanonicalCourse;
  objectives: string[];
  sections: Array<{ id: string; title: string; content: string; note: string }>;
  quizzes: Array<{ id: string; question: string; quiz_type: string; selected: boolean }>;
  notice: string;
  generation: {
    id: string;
    provider: AIProvider;
    model?: string;
    retries: number;
    request_id?: string;
    input_tokens?: number;
    output_tokens?: number;
  };
};

async function message(response: Response) {
  try {
    const body = (await response.json()) as { detail?: string | { message?: string } };
    if (typeof body.detail === "string") return body.detail;
    return body.detail?.message ?? "";
  } catch {
    return "";
  }
}

export async function currentTeacher(): Promise<Teacher | null> {
  const response = await fetch("/api/v1/me", { credentials: "include" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error((await message(response)) || "Không thể kết nối máy chủ.");
  return response.json() as Promise<Teacher>;
}

export async function authenticate(email: string, password: string): Promise<Teacher> {
  const options: RequestInit = {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  };
  let response = await fetch("/api/v1/auth/login", options);
  if (response.status === 401) response = await fetch("/api/v1/auth/register", options);
  if (!response.ok) throw new Error((await message(response)) || "Không thể đăng nhập hoặc tạo tài khoản.");
  return response.json() as Promise<Teacher>;
}

export async function signOut() {
  const response = await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" });
  if (!response.ok) throw new Error("Không thể đăng xuất.");
}

export async function listProjects(): Promise<Project[]> {
  const response = await fetch("/api/v1/projects", { credentials: "include" });
  if (!response.ok) throw new Error((await message(response)) || "Không thể tải danh sách bài giảng.");
  return response.json() as Promise<Project[]>;
}

export async function getProject(projectId: string): Promise<Project> {
  const response = await fetch(`/api/v1/projects/${projectId}`, { credentials: "include" });
  if (!response.ok) throw new Error((await message(response)) || "Không thể tải bài giảng.");
  return response.json() as Promise<Project>;
}

export async function createProject(title: string, direction: WorkflowDirection): Promise<Project> {
  const response = await fetch("/api/v1/projects", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, direction }),
  });
  if (!response.ok) throw new Error((await message(response)) || "Không thể tạo bản nháp bài giảng.");
  return response.json() as Promise<Project>;
}

export async function updateProjectTitle(project: Project, title: string): Promise<Project> {
  const course: CanonicalCourse = {
    ...project.course,
    revision: project.revision + 1,
    metadata: { ...project.course.metadata, title },
  };
  const response = await fetch(`/api/v1/projects/${project.id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expected_revision: project.revision, course }),
  });
  if (!response.ok) throw new Error((await message(response)) || "Không thể cập nhật tên bài giảng.");
  return response.json() as Promise<Project>;
}

export async function updateProjectDirection(project: Project, direction: WorkflowDirection): Promise<Project> {
  const course: CanonicalCourse = {
    ...project.course,
    revision: project.revision + 1,
    metadata: { ...project.course.metadata, direction },
  };
  const response = await fetch(`/api/v1/projects/${project.id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expected_revision: project.revision, course }),
  });
  if (!response.ok) throw new Error((await message(response)) || "Không thể lưu định hướng bài giảng.");
  return response.json() as Promise<Project>;
}

export async function listProjectSources(projectId: string): Promise<SourceMaterial[]> {
  const response = await fetch(`/api/v1/projects/${projectId}/sources`, { credentials: "include" });
  if (!response.ok) throw new Error((await message(response)) || "Không thể tải học liệu của bài giảng.");
  return response.json() as Promise<SourceMaterial[]>;
}

export async function uploadProjectSource(projectId: string, file: File): Promise<SourceMaterial> {
  const form = new FormData();
  form.append("upload", file);
  const response = await fetch(`/api/v1/projects/${projectId}/sources`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!response.ok) throw new Error((await message(response)) || "Không thể tải học liệu.");
  return response.json() as Promise<SourceMaterial>;
}

export async function listAICredentials(): Promise<AICredential[]> {
  const response = await fetch("/api/v1/ai/credentials", { credentials: "include" });
  if (!response.ok) throw new Error((await message(response)) || "Không thể tải danh sách API key.");
  return response.json() as Promise<AICredential[]>;
}

export async function generateCourse(input: {
  title: string;
  source: string;
  direction: WorkflowDirection;
  provider: AIProvider;
  credentialId?: string;
}): Promise<GenerationResponse> {
  const response = await fetch("/api/generate", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: input.title,
      source: input.source.slice(0, 24000),
      direction: input.direction,
      provider: input.provider,
      credential_id: input.provider === "mock" ? null : input.credentialId || null,
    }),
  });
  if (!response.ok) throw new Error((await message(response)) || "Không thể tạo nội dung bằng AI.");
  return response.json() as Promise<GenerationResponse>;
}

export async function populateProjectFromGeneration(project: Project, generated: GenerationResponse): Promise<Project> {
  const course: CanonicalCourse = {
    ...generated.course,
    id: project.id,
    revision: project.revision + 1,
    metadata: {
      ...generated.course.metadata,
      title: project.title,
      direction: project.course.metadata.direction,
    },
  };
  const response = await fetch(`/api/v1/projects/${project.id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expected_revision: project.revision, course, generation_id: generated.generation.id }),
  });
  if (!response.ok) throw new Error((await message(response)) || "Không thể lưu nội dung AI vào bản nháp hiện tại.");
  return response.json() as Promise<Project>;
}

export async function updateCanonicalCourse(project: Project, draft: CanonicalCourse): Promise<Project> {
  const course: CanonicalCourse = {
    ...draft,
    id: project.id,
    revision: project.revision + 1,
    metadata: { ...draft.metadata, title: project.title },
  };
  const response = await fetch(`/api/v1/projects/${project.id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expected_revision: project.revision, course }),
  });
  if (response.status === 409) throw new Error("Bản nháp đã được cập nhật ở phiên khác.");
  if (!response.ok) throw new Error((await message(response)) || "Không thể lưu nội dung chỉnh sửa.");
  return response.json() as Promise<Project>;
}

export async function regenerateProjectSlide(project: Project, slideId: string, input: {
  source: string;
  provider: AIProvider;
  credentialId?: string;
}): Promise<Project> {
  const response = await fetch(`/api/v1/projects/${project.id}/slides/${encodeURIComponent(slideId)}/regenerate`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: input.source.slice(0, 24000),
      provider: input.provider,
      credential_id: input.provider === "mock" ? null : input.credentialId || null,
      expected_revision: project.revision,
    }),
  });
  if (!response.ok) throw new Error((await message(response)) || "Không thể tạo lại slide này.");
  return response.json() as Promise<Project>;
}
