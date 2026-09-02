export type Teacher = {
  id: string;
  email: string;
  full_name: string | null;
  school_name: string | null;
};

export type WorkflowDirection = "lesson" | "review" | "advanced";

export type CanonicalCourse = {
  id: string;
  revision: number;
  metadata: {
    title: string;
    direction: WorkflowDirection;
    [key: string]: unknown;
  };
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
