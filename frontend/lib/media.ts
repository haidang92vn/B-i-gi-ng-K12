import type { CourseSlide, MediaKind } from "./api";

const limits: Record<MediaKind, number> = {
  image: 10 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  video: 200 * 1024 * 1024,
};

const acceptedTypes: Record<string, MediaKind> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "audio/mpeg": "audio",
  "audio/wav": "audio",
  "audio/ogg": "audio",
  "audio/mp4": "audio",
  "video/mp4": "video",
  "video/webm": "video",
};

export function validateMediaFile(file: Pick<File, "type" | "size">): string | null {
  const kind = acceptedTypes[file.type];
  if (!kind) return "Chỉ nhận JPG, PNG, WebP, GIF, MP3, WAV, OGG, M4A, MP4 hoặc WebM.";
  if (file.size < 1) return "Tệp media đang trống.";
  if (file.size > limits[kind]) {
    return `${kind === "image" ? "Ảnh" : kind === "audio" ? "Âm thanh" : "Video"} vượt quá giới hạn ${limits[kind] / 1024 / 1024} MB.`;
  }
  return null;
}

export function formatMediaSize(bytes: number): string {
  if (bytes <= 0) return "URL ngoài";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function slideNarration(slide: CourseSlide): string {
  const text = slide.blocks
    .filter((block) => block.type === "heading" || block.type === "text" || block.type === "callout")
    .map((block) => block.text?.trim())
    .filter(Boolean)
    .join("\n\n");
  return text || slide.speaker_notes?.trim() || slide.title;
}

