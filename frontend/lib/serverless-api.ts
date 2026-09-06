import type { CanonicalCourse, QualityReport, ScormExport } from "@/lib/api";

export type ServerlessProvider = "mock" | "openai" | "gemini";
export type ProviderStatus = Record<ServerlessProvider, { available: boolean; model: string; notice?: string }>;

async function errorMessage(response: Response) {
  try {
    const body = await response.json() as { detail?: string };
    return body.detail || "Dịch vụ serverless không thể xử lý bài giảng này.";
  } catch { return "Dịch vụ serverless không thể xử lý bài giảng này."; }
}

async function request(path: string, body: unknown) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response;
}

export async function serverlessProviders(): Promise<ProviderStatus> {
  const response = await fetch("/api/serverless/providers");
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json() as Promise<ProviderStatus>;
}

export async function serverlessGenerate(input: { title: string; source: string; direction: CanonicalCourse["metadata"]["direction"]; provider: ServerlessProvider }): Promise<{ course: CanonicalCourse; provider: ServerlessProvider; model: string }> {
  return (await request("/api/serverless/generate", input)).json() as Promise<{ course: CanonicalCourse; provider: ServerlessProvider; model: string }>;
}

export async function serverlessQuality(course: CanonicalCourse): Promise<QualityReport> {
  return (await request("/api/serverless/quality", course)).json() as Promise<QualityReport>;
}

export async function serverlessPreview(course: CanonicalCourse): Promise<string> {
  return (await request("/api/serverless/preview", course)).text();
}

export async function serverlessExport(course: CanonicalCourse): Promise<ScormExport> {
  const response = await request("/api/serverless/export", { course });
  const match = response.headers.get("Content-Disposition")?.match(/filename="?([^";]+)"?/);
  return { blob: await response.blob(), filename: match?.[1] || "bai_giang_SCORM2004.zip", exportId: null, warningCount: 0 };
}
