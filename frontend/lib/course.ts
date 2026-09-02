export type WorkflowDirection = "lesson" | "review" | "advanced";

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
