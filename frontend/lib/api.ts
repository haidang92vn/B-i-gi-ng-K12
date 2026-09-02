export type Teacher = {
  id: string;
  email: string;
  full_name: string | null;
  school_name: string | null;
};

async function message(response: Response) {
  try {
    const body = (await response.json()) as { detail?: string };
    return typeof body.detail === "string" ? body.detail : "";
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
