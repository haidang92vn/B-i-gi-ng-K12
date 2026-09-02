"use client";

import { useEffect, useRef, useState } from "react";
import {
  getProject,
  regenerateProjectSlide,
  updateCanonicalCourse,
  type AIProvider,
  type CanonicalCourse,
  type CourseSlide,
  type Project,
} from "@/lib/api";

type SaveTone = "idle" | "loading" | "saved" | "error";

type CourseEditorProps = {
  project: Project;
  sourceText: string;
  provider: AIProvider;
  credentialId: string;
  onProjectChange: (project: Project) => void;
  onSaveState: (tone: SaveTone, message: string, saved: boolean) => void;
};

const layouts = [
  ["content", "Nội dung"],
  ["two_column", "Hai cột"],
  ["callout", "Điểm nhấn"],
  ["quiz", "Câu hỏi"],
] as const;

const statuses = [
  ["ai_draft", "AI nháp"],
  ["edited", "Đã sửa"],
  ["approved", "Đã duyệt"],
] as const;

function cloneCourse(course: CanonicalCourse): CanonicalCourse {
  return JSON.parse(JSON.stringify(course)) as CanonicalCourse;
}

function editorId(prefix: string) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function slideText(slide: CourseSlide) {
  return slide.blocks.find((block) => block.type === "text")?.text ?? "";
}

export default function CourseEditor({ project, sourceText, provider, credentialId, onProjectChange, onSaveState }: CourseEditorProps) {
  const [course, setCourse] = useState<CanonicalCourse>(() => cloneCourse(project.course));
  const [serverProject, setServerProject] = useState(project);
  const [selectedSlideId, setSelectedSlideId] = useState(project.course.slides[0]?.id ?? "");
  const [editVersion, setEditVersion] = useState(0);
  const [savedVersion, setSavedVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saveConflict, setSaveConflict] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState("");
  const courseRef = useRef(course);
  const serverProjectRef = useRef(project);
  const editVersionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const savingRef = useRef(false);
  const canEdit = project.access_level !== "viewer";
  const selectedSlide = course.slides.find((slide) => slide.id === selectedSlideId) ?? course.slides[0];
  const fullySaved = editVersion === savedVersion && !saving;
  const approvedCount = course.slides.filter((slide) => slide.status === "approved").length;

  function replaceCourse(next: CanonicalCourse) {
    courseRef.current = next;
    setCourse(next);
  }

  function markChanged(mutator: (draft: CanonicalCourse) => void) {
    if (!canEdit) return;
    const next = cloneCourse(courseRef.current);
    mutator(next);
    replaceCourse(next);
    const version = editVersionRef.current + 1;
    editVersionRef.current = version;
    setEditVersion(version);
    setSaveFailed(false);
    setSaveConflict(false);
    onSaveState("idle", "Có thay đổi • sẽ tự lưu", false);
  }

  async function persist(version: number) {
    if (!canEdit || savingRef.current || version === savedVersionRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveFailed(false);
    onSaveState("loading", "Đang tự lưu…", false);
    const snapshot = cloneCourse(courseRef.current);
    const baseProject = serverProjectRef.current;
    try {
      const updated = await updateCanonicalCourse(baseProject, snapshot);
      serverProjectRef.current = updated;
      setServerProject(updated);
      setCourse((current) => {
        const next = { ...current, revision: updated.revision };
        courseRef.current = next;
        return next;
      });
      savedVersionRef.current = version;
      setSavedVersion(version);
      onProjectChange(updated);
      const hasNewerChanges = editVersionRef.current !== version;
      onSaveState(hasNewerChanges ? "idle" : "saved", hasNewerChanges ? "Có thay đổi mới • sẽ tự lưu" : `Đã lưu • bản ${updated.revision}`, !hasNewerChanges);
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : "Không thể lưu thay đổi.";
      setSaveFailed(true);
      setSaveConflict(detail.includes("phiên khác"));
      onSaveState("error", `${detail} Nội dung vẫn được giữ trên màn hình.`, false);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  useEffect(() => {
    if (editVersion === savedVersion || saveFailed) return;
    const timer = window.setTimeout(() => { void persist(editVersion); }, 700);
    return () => window.clearTimeout(timer);
  }, [editVersion, savedVersion, saveFailed]);

  function updateObjective(index: number, text: string) {
    markChanged((draft) => { draft.objectives[index].text = text; });
  }

  function addObjective() {
    markChanged((draft) => { draft.objectives.push({ id: editorId("objective"), text: "Mục tiêu mới" }); });
  }

  function deleteObjective(index: number) {
    markChanged((draft) => { draft.objectives.splice(index, 1); });
  }

  function updateSlide(slideId: string, field: "title" | "layout" | "speaker_notes" | "text", value: string) {
    markChanged((draft) => {
      const slide = draft.slides.find((item) => item.id === slideId);
      if (!slide) return;
      if (field === "text") {
        const block = slide.blocks.find((item) => item.type === "text");
        if (block) block.text = value;
        else slide.blocks.unshift({ id: editorId("block"), type: "text", text: value, settings: {} });
      } else if (field === "speaker_notes") slide.speaker_notes = value;
      else slide[field] = value;
      slide.status = "edited";
    });
  }

  function updateSlideStatus(slideId: string, status: CourseSlide["status"]) {
    markChanged((draft) => {
      const slide = draft.slides.find((item) => item.id === slideId);
      if (slide) slide.status = status;
    });
  }

  function addSlide() {
    const id = editorId("slide");
    markChanged((draft) => {
      draft.slides.push({
        id,
        title: "Slide mới",
        layout: "content",
        status: "edited",
        blocks: [{ id: editorId("block"), type: "text", text: "Nhập nội dung cho slide này.", settings: {} }],
        speaker_notes: "",
      });
    });
    setSelectedSlideId(id);
  }

  function duplicateSlide(slideId: string) {
    const id = editorId("slide");
    markChanged((draft) => {
      const index = draft.slides.findIndex((slide) => slide.id === slideId);
      if (index < 0) return;
      const copy = JSON.parse(JSON.stringify(draft.slides[index])) as CourseSlide;
      copy.id = id;
      copy.title = `${copy.title} (bản sao)`;
      copy.status = "edited";
      copy.blocks = copy.blocks.map((block) => ({ ...block, id: editorId("block") }));
      draft.slides.splice(index + 1, 0, copy);
    });
    setSelectedSlideId(id);
  }

  function moveSlide(slideId: string, offset: number) {
    markChanged((draft) => {
      const index = draft.slides.findIndex((slide) => slide.id === slideId);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= draft.slides.length) return;
      [draft.slides[index], draft.slides[target]] = [draft.slides[target], draft.slides[index]];
    });
  }

  function deleteSlide(slideId: string) {
    if (course.slides.length <= 1 || !window.confirm("Xóa slide này khỏi bài giảng?")) return;
    const index = course.slides.findIndex((slide) => slide.id === slideId);
    const nextSelected = course.slides[index + 1]?.id ?? course.slides[index - 1]?.id ?? "";
    markChanged((draft) => { draft.slides = draft.slides.filter((slide) => slide.id !== slideId); });
    setSelectedSlideId(nextSelected);
  }

  async function regenerate(slideId: string) {
    if (!fullySaved) {
      onSaveState("error", "Hãy chờ autosave hoàn tất trước khi tạo lại slide.", false);
      return;
    }
    if (provider !== "mock" && !credentialId) {
      onSaveState("error", "Nhà cung cấp này chưa có API key đang hoạt động.", true);
      return;
    }
    setRegeneratingId(slideId);
    onSaveState("loading", "AI đang tạo lại riêng slide…", true);
    try {
      const updated = await regenerateProjectSlide(serverProjectRef.current, slideId, { source: sourceText, provider, credentialId });
      serverProjectRef.current = updated;
      setServerProject(updated);
      replaceCourse(cloneCourse(updated.course));
      onProjectChange(updated);
      onSaveState("saved", `Đã tạo lại slide • bản ${updated.revision}`, true);
    } catch (reason) {
      onSaveState("error", reason instanceof Error ? reason.message : "Không thể tạo lại slide.", true);
    } finally {
      setRegeneratingId("");
    }
  }

  async function discardAndReload() {
    if (!window.confirm("Tải bản mới nhất từ máy chủ? Các thay đổi chưa lưu trên màn hình sẽ bị thay thế.")) return;
    setSaving(true);
    try {
      const latest = await getProject(serverProjectRef.current.id);
      serverProjectRef.current = latest;
      setServerProject(latest);
      replaceCourse(cloneCourse(latest.course));
      editVersionRef.current = 0;
      savedVersionRef.current = 0;
      setEditVersion(0);
      setSavedVersion(0);
      setSelectedSlideId(latest.course.slides[0]?.id ?? "");
      setSaveFailed(false);
      setSaveConflict(false);
      onProjectChange(latest);
      onSaveState("saved", `Đã tải bản mới nhất • bản ${latest.revision}`, true);
    } catch (reason) {
      onSaveState("error", reason instanceof Error ? reason.message : "Không thể tải lại bài giảng.", false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="review-editor">
      <div className="review-overview">
        <div><span>Tiến độ duyệt</span><strong>{approvedCount}/{course.slides.length} slide</strong><small>{course.objectives.length} mục tiêu • phiên bản máy chủ {serverProject.revision}</small></div>
        <div className="review-progress"><i style={{ width: `${course.slides.length ? (approvedCount / course.slides.length) * 100 : 0}%` }} /></div>
        {!canEdit && <p>Chế độ chỉ xem: tài khoản này không có quyền chỉnh sửa bài giảng.</p>}
      </div>

      <section className="objective-editor">
        <div className="editor-section-title"><div><span>MỤC TIÊU HỌC TẬP</span><h3>Giáo viên kiểm tra kết quả cần đạt</h3></div><button type="button" disabled={!canEdit} onClick={addObjective}>+ Thêm mục tiêu</button></div>
        <div className="objective-list">
          {course.objectives.map((objective, index) => <label key={objective.id}><b>{String(index + 1).padStart(2, "0")}</b><input disabled={!canEdit} value={objective.text} onChange={(event) => updateObjective(index, event.target.value)} /><button type="button" aria-label={`Xóa mục tiêu ${index + 1}`} disabled={!canEdit} onClick={() => deleteObjective(index)}>×</button></label>)}
          {course.objectives.length === 0 && <p>Chưa có mục tiêu. Hãy thêm ít nhất một mục tiêu trước khi duyệt.</p>}
        </div>
      </section>

      <section className="slide-workbench">
        <aside className="slide-rail">
          <div className="editor-section-title"><div><span>KỊCH BẢN</span><h3>{course.slides.length} slide</h3></div><button type="button" disabled={!canEdit} onClick={addSlide}>+</button></div>
          <div className="slide-list">
            {course.slides.map((slide, index) => <button type="button" key={slide.id} className={slide.id === selectedSlide?.id ? "slide-item selected" : "slide-item"} onClick={() => setSelectedSlideId(slide.id)}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{slide.title || "Chưa có tiêu đề"}</strong><small className={`slide-status ${slide.status}`}>{statuses.find(([id]) => id === slide.status)?.[1]}</small></span></button>)}
          </div>
        </aside>

        {selectedSlide ? (
          <article className="slide-editor-card">
            <div className="slide-editor-head">
              <div><span>ĐANG CHỈNH SỬA</span><strong>{selectedSlide.title || "Slide chưa có tiêu đề"}</strong></div>
              <div className="slide-selectors">
                <label>Bố cục<select disabled={!canEdit} value={selectedSlide.layout} onChange={(event) => updateSlide(selectedSlide.id, "layout", event.target.value)}>{layouts.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
                <label>Trạng thái<select disabled={!canEdit} value={selectedSlide.status} onChange={(event) => updateSlideStatus(selectedSlide.id, event.target.value as CourseSlide["status"])}>{statuses.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
              </div>
            </div>
            <div className="slide-fields">
              <label>Tiêu đề<input disabled={!canEdit} value={selectedSlide.title} onChange={(event) => updateSlide(selectedSlide.id, "title", event.target.value)} /></label>
              <label>Nội dung chính<textarea disabled={!canEdit} rows={9} value={slideText(selectedSlide)} onChange={(event) => updateSlide(selectedSlide.id, "text", event.target.value)} /></label>
              <label>Ghi chú cho giáo viên<textarea disabled={!canEdit} rows={3} value={selectedSlide.speaker_notes ?? ""} onChange={(event) => updateSlide(selectedSlide.id, "speaker_notes", event.target.value)} /></label>
              <small>Các block ảnh, âm thanh và video đang gắn với slide được giữ nguyên khi sửa văn bản.</small>
            </div>
            <div className="slide-actions">
              <button type="button" disabled={!canEdit || course.slides[0]?.id === selectedSlide.id} onClick={() => moveSlide(selectedSlide.id, -1)}>↑ Lên</button>
              <button type="button" disabled={!canEdit || course.slides.at(-1)?.id === selectedSlide.id} onClick={() => moveSlide(selectedSlide.id, 1)}>↓ Xuống</button>
              <button type="button" disabled={!canEdit} onClick={() => duplicateSlide(selectedSlide.id)}>Nhân bản</button>
              <button type="button" className="regenerate" disabled={!canEdit || !fullySaved || selectedSlide.status === "approved" || Boolean(regeneratingId) || (provider !== "mock" && !credentialId)} onClick={() => { void regenerate(selectedSlide.id); }}>{regeneratingId === selectedSlide.id ? "Đang tạo lại…" : `Tạo lại bằng ${provider === "mock" ? "Mock AI" : provider === "openai" ? "OpenAI" : "Gemini"}`}</button>
              <button type="button" className="danger" disabled={!canEdit || course.slides.length <= 1} onClick={() => deleteSlide(selectedSlide.id)}>Xóa</button>
            </div>
          </article>
        ) : <div className="empty-editor"><strong>Chưa có slide</strong><p>Thêm một slide để bắt đầu biên tập.</p></div>}
      </section>

      {saveFailed && <div className="save-recovery"><p>{saveConflict ? "Có thay đổi từ phiên khác. Nội dung đang sửa vẫn được giữ; chỉ tải lại khi giáo viên chủ động chấp nhận thay thế." : "Autosave chưa thành công. Nội dung hiện tại vẫn còn nguyên trên màn hình."}</p><button type="button" disabled={saving} onClick={() => { if (saveConflict) void discardAndReload(); else { setSaveFailed(false); void persist(editVersionRef.current); } }}>{saveConflict ? "Tải bản máy chủ" : "Thử lưu lại"}</button></div>}
    </div>
  );
}
