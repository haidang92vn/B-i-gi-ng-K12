"use client";

import { useEffect, useRef, useState } from "react";
import { getProject, updateCanonicalCourse, type CanonicalCourse, type CourseQuestion, type Project, type QuestionDifficulty, type QuestionType } from "@/lib/api";
import { answerToEditorText, imageOptionsToEditorText, parseEditorAnswer, parseImageOptions, questionWarnings } from "@/lib/quiz";

type SaveTone = "idle" | "loading" | "saved" | "error";
type QuestionFilter = "all" | "selected" | "unselected";

type QuizEditorProps = {
  project: Project;
  onProjectChange: (project: Project) => void;
  onSaveState: (tone: SaveTone, message: string, saved: boolean) => void;
};

const questionTypes: Array<[QuestionType, string]> = [
  ["single", "Một đáp án"], ["multiple", "Nhiều đáp án"], ["truefalse", "Đúng / Sai"],
  ["fill", "Điền từ"], ["matching", "Ghép đôi"], ["ordering", "Sắp xếp"],
  ["dragdrop", "Kéo thả"], ["image", "Chọn hình ảnh"],
];

const difficulties: Array<[QuestionDifficulty, string]> = [
  ["recognize", "Nhận biết"], ["understand", "Thông hiểu"], ["apply", "Vận dụng"], ["advanced", "Nâng cao"],
];

function cloneCourse(course: CanonicalCourse): CanonicalCourse {
  return JSON.parse(JSON.stringify(course)) as CanonicalCourse;
}

function editorId(prefix: string) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function normalizeAnswer(question: CourseQuestion, type: QuestionType): unknown {
  const current = question.correct_answer;
  if (type === "matching") return current && typeof current === "object" && !Array.isArray(current) ? current : {};
  if (["multiple", "ordering", "dragdrop"].includes(type)) return Array.isArray(current) ? current : current ? [String(current)] : [];
  if (Array.isArray(current)) return current[0] ?? "";
  if (current && typeof current === "object") return "";
  if (type === "truefalse" && !current) return "Đúng";
  return current ?? "";
}

export default function QuizEditor({ project, onProjectChange, onSaveState }: QuizEditorProps) {
  const [course, setCourse] = useState<CanonicalCourse>(() => cloneCourse(project.course));
  const [serverProject, setServerProject] = useState(project);
  const [selectedQuestionId, setSelectedQuestionId] = useState(project.course.question_bank[0]?.id ?? "");
  const [filter, setFilter] = useState<QuestionFilter>("all");
  const [editVersion, setEditVersion] = useState(0);
  const [savedVersion, setSavedVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saveConflict, setSaveConflict] = useState(false);
  const [optionDrafts, setOptionDrafts] = useState<Record<string, string>>({});
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [imageDrafts, setImageDrafts] = useState<Record<string, string>>({});
  const courseRef = useRef(course);
  const serverProjectRef = useRef(project);
  const editVersionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const savingRef = useRef(false);
  const canEdit = project.access_level !== "viewer";
  const selectedCount = course.question_bank.filter((question) => question.selected).length;
  const visibleQuestions = course.question_bank.filter((question) => filter === "all" || (filter === "selected" ? question.selected : !question.selected));
  const selectedQuestion = visibleQuestions.find((question) => question.id === selectedQuestionId) ?? visibleQuestions[0] ?? course.question_bank.find((question) => question.id === selectedQuestionId);
  const warnings = selectedQuestion ? questionWarnings(selectedQuestion) : [];

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
    onSaveState("loading", "Đang tự lưu ngân hàng câu hỏi…", false);
    const snapshot = cloneCourse(courseRef.current);
    try {
      const updated = await updateCanonicalCourse(serverProjectRef.current, snapshot);
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
      const detail = reason instanceof Error ? reason.message : "Không thể lưu ngân hàng câu hỏi.";
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

  function updateQuestion(questionId: string, mutator: (question: CourseQuestion) => void) {
    markChanged((draft) => {
      const question = draft.question_bank.find((item) => item.id === questionId);
      if (question) mutator(question);
    });
  }

  function changeFilter(next: QuestionFilter) {
    setFilter(next);
    const first = course.question_bank.find((question) => next === "all" || (next === "selected" ? question.selected : !question.selected));
    setSelectedQuestionId(first?.id ?? "");
  }

  function changeType(questionId: string, type: QuestionType) {
    updateQuestion(questionId, (question) => {
      question.type = type;
      question.correct_answer = normalizeAnswer(question, type);
      if (type === "truefalse") question.options = ["Đúng", "Sai"];
    });
    setOptionDrafts((current) => { const next = { ...current }; delete next[questionId]; return next; });
    setAnswerDrafts((current) => { const next = { ...current }; delete next[questionId]; return next; });
    setImageDrafts((current) => { const next = { ...current }; delete next[questionId]; return next; });
  }

  function toggleAll(selected: boolean) {
    markChanged((draft) => { draft.question_bank.forEach((question) => { question.selected = selected; }); });
    if (filter !== "all") changeFilter(selected ? "selected" : "unselected");
  }

  function addQuestion() {
    const id = editorId("question");
    markChanged((draft) => {
      draft.question_bank.push({
        id, type: "single", question: "Câu hỏi mới", selected: true, score: 1,
        difficulty: "understand", correct_answer: "Phương án đúng",
        options: ["Phương án đúng", "Phương án khác"], explanation: "",
        feedback_correct: "Chính xác.", feedback_incorrect: "Hãy xem lại nội dung bài học.",
        objective_ids: [], settings: {},
      });
    });
    setFilter("all");
    setSelectedQuestionId(id);
  }

  function deleteQuestion(questionId: string) {
    if (!window.confirm("Xóa hẳn câu hỏi này khỏi ngân hàng? Nếu chỉ không dùng trong quiz, hãy bỏ dấu Chọn.")) return;
    const index = course.question_bank.findIndex((question) => question.id === questionId);
    const nextSelected = course.question_bank[index + 1]?.id ?? course.question_bank[index - 1]?.id ?? "";
    markChanged((draft) => { draft.question_bank = draft.question_bank.filter((question) => question.id !== questionId); });
    setSelectedQuestionId(nextSelected);
  }

  async function discardAndReload() {
    if (!window.confirm("Tải bản mới nhất từ máy chủ? Các thay đổi câu hỏi chưa lưu sẽ bị thay thế.")) return;
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
      setSelectedQuestionId(latest.course.question_bank[0]?.id ?? "");
      setFilter("all");
      setOptionDrafts({});
      setAnswerDrafts({});
      setImageDrafts({});
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
    <div className="quiz-editor">
      <div className="quiz-overview">
        <div><span>QUIZ ĐANG CHỌN</span><strong>{selectedCount}/{course.question_bank.length} câu</strong><small>Tổng {course.question_bank.filter((question) => question.selected).reduce((sum, question) => sum + question.score, 0)} điểm • bản {serverProject.revision}</small></div>
        <p>Bỏ chọn chỉ loại câu khỏi quiz cuối; câu hỏi vẫn còn trong ngân hàng để giáo viên dùng lại.</p>
        <div><button type="button" disabled={!canEdit} onClick={() => toggleAll(true)}>Chọn tất cả</button><button type="button" disabled={!canEdit} onClick={() => toggleAll(false)}>Bỏ chọn tất cả</button></div>
      </div>

      <section className="quiz-workbench">
        <aside className="question-rail">
          <div className="question-toolbar"><div><span>NGÂN HÀNG</span><strong>{course.question_bank.length} câu hỏi</strong></div><button type="button" disabled={!canEdit} onClick={addQuestion}>+</button></div>
          <div className="question-filters" role="group" aria-label="Lọc câu hỏi">
            {([['all', 'Tất cả'], ['selected', 'Đã chọn'], ['unselected', 'Chưa chọn']] as Array<[QuestionFilter, string]>).map(([id, label]) => <button type="button" className={filter === id ? "active" : ""} key={id} onClick={() => changeFilter(id)}>{label}</button>)}
          </div>
          <div className="question-list">
            {visibleQuestions.map((question, index) => <button type="button" key={question.id} className={question.id === selectedQuestion?.id ? "question-item selected" : "question-item"} onClick={() => setSelectedQuestionId(question.id)}><input aria-label={`Chọn câu hỏi ${index + 1}`} type="checkbox" disabled={!canEdit} checked={question.selected} onClick={(event) => event.stopPropagation()} onChange={(event) => updateQuestion(question.id, (item) => { item.selected = event.target.checked; })} /><span><strong>{question.question || "Câu hỏi chưa có nội dung"}</strong><small>{questionTypes.find(([id]) => id === question.type)?.[1]} • {question.score} điểm</small></span></button>)}
            {visibleQuestions.length === 0 && <p>Không có câu hỏi trong bộ lọc này.</p>}
          </div>
        </aside>

        {selectedQuestion ? (
          <article className="question-editor-card">
            <div className="question-editor-head">
              <label className="question-select-toggle"><input type="checkbox" disabled={!canEdit} checked={selectedQuestion.selected} onChange={(event) => updateQuestion(selectedQuestion.id, (question) => { question.selected = event.target.checked; })} /><span><strong>{selectedQuestion.selected ? "Đang dùng trong quiz" : "Đang giữ trong ngân hàng"}</strong><small>Câu chưa chọn không bị xóa.</small></span></label>
              <div className="question-selectors">
                <label>Dạng câu<select disabled={!canEdit} value={selectedQuestion.type} onChange={(event) => changeType(selectedQuestion.id, event.target.value as QuestionType)}>{questionTypes.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
                <label>Độ khó<select disabled={!canEdit} value={selectedQuestion.difficulty} onChange={(event) => updateQuestion(selectedQuestion.id, (question) => { question.difficulty = event.target.value as QuestionDifficulty; })}>{difficulties.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
                <label>Điểm<input type="number" min="0" step="0.5" disabled={!canEdit} value={selectedQuestion.score} onChange={(event) => updateQuestion(selectedQuestion.id, (question) => { question.score = Math.max(0, Number(event.target.value) || 0); })} /></label>
              </div>
            </div>

            <div className="question-fields">
              <label>Nội dung câu hỏi<textarea rows={3} disabled={!canEdit} value={selectedQuestion.question} onChange={(event) => updateQuestion(selectedQuestion.id, (question) => { question.question = event.target.value; })} /></label>
              {!["fill", "truefalse", "image"].includes(selectedQuestion.type) && <label>Phương án <small>Mỗi dòng một phương án.</small><textarea rows={4} disabled={!canEdit} value={optionDrafts[selectedQuestion.id] ?? selectedQuestion.options.join("\n")} onChange={(event) => { const value = event.target.value; setOptionDrafts((current) => ({ ...current, [selectedQuestion.id]: value })); updateQuestion(selectedQuestion.id, (question) => { question.options = value.split("\n").map((item) => item.trim()).filter(Boolean); }); }} /></label>}
              {selectedQuestion.type === "image" && <label>Ảnh lựa chọn <small>Mỗi dòng: mã lựa chọn | mã asset ảnh | nhãn.</small><textarea rows={4} disabled={!canEdit} placeholder="img-1 | asset-id | Hình tam giác" value={imageDrafts[selectedQuestion.id] ?? imageOptionsToEditorText(selectedQuestion.settings)} onChange={(event) => { const value = event.target.value; setImageDrafts((current) => ({ ...current, [selectedQuestion.id]: value })); updateQuestion(selectedQuestion.id, (question) => { const imageOptions = parseImageOptions(value); question.settings = { ...question.settings, image_options: imageOptions }; question.options = imageOptions.map((item) => item.id); }); }} /></label>}
              <label>Đáp án đúng <small>{selectedQuestion.type === "matching" ? "Mỗi dòng: vế trái => vế phải." : ["multiple", "ordering", "dragdrop"].includes(selectedQuestion.type) ? "Mỗi dòng một giá trị; thứ tự được giữ với dạng sắp xếp/kéo thả." : "Nhập đúng giá trị hệ thống sẽ so khớp."}</small><textarea rows={3} disabled={!canEdit} value={answerDrafts[selectedQuestion.id] ?? answerToEditorText(selectedQuestion.correct_answer, selectedQuestion.type)} onChange={(event) => { const value = event.target.value; setAnswerDrafts((current) => ({ ...current, [selectedQuestion.id]: value })); updateQuestion(selectedQuestion.id, (question) => { question.correct_answer = parseEditorAnswer(value, question.type); }); }} /></label>

              <fieldset className="question-objectives" disabled={!canEdit}><legend>Liên kết mục tiêu học tập</legend>{course.objectives.map((objective) => <label key={objective.id}><input type="checkbox" checked={selectedQuestion.objective_ids.includes(objective.id)} onChange={(event) => updateQuestion(selectedQuestion.id, (question) => { question.objective_ids = event.target.checked ? [...new Set([...question.objective_ids, objective.id])] : question.objective_ids.filter((id) => id !== objective.id); })} />{objective.text}</label>)}{course.objectives.length === 0 && <p>Chưa có mục tiêu để liên kết.</p>}</fieldset>

              <div className="feedback-grid">
                <label>Giải thích<textarea rows={3} disabled={!canEdit} value={selectedQuestion.explanation ?? ""} onChange={(event) => updateQuestion(selectedQuestion.id, (question) => { question.explanation = event.target.value; })} /></label>
                <label>Phản hồi khi đúng<textarea rows={3} disabled={!canEdit} value={selectedQuestion.feedback_correct ?? ""} onChange={(event) => updateQuestion(selectedQuestion.id, (question) => { question.feedback_correct = event.target.value; })} /></label>
                <label>Phản hồi cần cải thiện<textarea rows={3} disabled={!canEdit} value={selectedQuestion.feedback_incorrect ?? ""} onChange={(event) => updateQuestion(selectedQuestion.id, (question) => { question.feedback_incorrect = event.target.value; })} /></label>
              </div>
            </div>

            <div className={warnings.length ? "question-check warnings" : "question-check ready"}><div><span>KIỂM TRA CÂU HỎI</span><strong>{warnings.length ? `${warnings.length} điểm cần xử lý` : "Cấu trúc đã sẵn sàng"}</strong></div>{warnings.length ? <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : <p>Giáo viên vẫn cần kiểm tra tính chính xác chuyên môn.</p>}</div>
            <div className="question-actions"><button type="button" className="danger" disabled={!canEdit} onClick={() => deleteQuestion(selectedQuestion.id)}>Xóa hẳn câu hỏi</button></div>
          </article>
        ) : <div className="empty-editor"><strong>Chưa có câu hỏi</strong><p>Thêm câu hỏi mới hoặc đổi bộ lọc để tiếp tục.</p><button type="button" disabled={!canEdit} onClick={addQuestion}>+ Thêm câu hỏi</button></div>}
      </section>

      {saveFailed && <div className="save-recovery"><p>{saveConflict ? "Có thay đổi từ phiên khác. Câu hỏi đang sửa vẫn được giữ; chỉ tải lại khi giáo viên chủ động chấp nhận thay thế." : "Autosave chưa thành công. Ngân hàng câu hỏi hiện tại vẫn còn nguyên trên màn hình."}</p><button type="button" disabled={saving} onClick={() => { if (saveConflict) void discardAndReload(); else { setSaveFailed(false); void persist(editVersionRef.current); } }}>{saveConflict ? "Tải bản máy chủ" : "Thử lưu lại"}</button></div>}
    </div>
  );
}
