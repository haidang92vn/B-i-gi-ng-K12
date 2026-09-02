import type { WorkflowDirection } from "@/lib/api";

export type CourseDraft = {
  title: string;
  sourceText: string;
  direction: WorkflowDirection;
};

export const initialCourseDraft: CourseDraft = {
  title: "",
  sourceText: "",
  direction: "lesson",
};
