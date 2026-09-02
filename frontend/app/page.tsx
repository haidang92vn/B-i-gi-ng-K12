"use client";

import { FormEvent, useEffect, useState } from "react";
import CourseEditor from "@/app/course-editor";
import PlayerStudio from "@/app/player-studio";
import QuizEditor from "@/app/quiz-editor";
import {
  authenticate,
  createProject,
  currentTeacher,
  generateCourse,
  listAICredentials,
  listProjects,
  listProjectSources,
  populateProjectFromGeneration,
  signOut,
  updateProjectDirection,
  updateProjectTitle,
  uploadProjectSource,
  type AICredential,
  type AIProvider,
  type GenerationResponse,
  type Project,
  type SourceMaterial,
  type Teacher,
  type WorkflowDirection,
} from "@/lib/api";
import { initialCourseDraft, type CourseDraft } from "@/lib/course";

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

const steps = [
  ["Nhập nội dung", "Nguồn bài học"],
  ["Định hướng", "Bài học / Ôn tập / Nâng cao"],
  ["AI tạo nội dung", "Kịch bản + câu hỏi"],
  ["Giáo viên duyệt", "Sửa trước khi xuất bản"],
  ["Chọn Quiz", "Dạng câu hỏi tương tác"],
  ["Dựng bài giảng", "HTML5 + player"],
  ["Cấu hình SCORM", "K12Online • SCORM 2004"],
  ["Kiểm tra & xuất", "ZIP sẵn sàng upload"],
] as const;

const directionOptions: Array<{
  id: WorkflowDirection;
  title: string;
  summary: string;
  outcome: string;
}> = [
  { id: "lesson", title: "Bài học mới", summary: "Giải thích kiến thức theo tiến trình rõ ràng, có ví dụ và luyện tập.", outcome: "Mục tiêu → kiến thức → ví dụ → luyện tập" },
  { id: "review", title: "Ôn tập – củng cố", summary: "Hệ thống hóa nội dung đã học và ưu tiên câu hỏi kiểm tra nhanh.", outcome: "Tóm tắt → ghi nhớ → luyện tập → phản hồi" },
  { id: "advanced", title: "Nâng cao – mở rộng", summary: "Tạo tình huống vận dụng, so sánh và câu hỏi tư duy ở mức cao hơn.", outcome: "Khám phá → vận dụng → thử thách → mở rộng" },
];

const providerOptions: Array<{ id: AIProvider; title: string; badge: string; summary: string }> = [
  { id: "mock", title: "Mock AI", badge: "Miễn phí", summary: "Tạo dữ liệu demo ổn định, không gửi nội dung ra dịch vụ bên ngoài." },
  { id: "openai", title: "ChatGPT / OpenAI", badge: "API cá nhân", summary: "Dùng khóa OpenAI đã được mã hóa và lưu ở phía máy chủ." },
  { id: "gemini", title: "Google Gemini", badge: "API cá nhân", summary: "Dùng khóa Gemini đã được mã hóa và lưu ở phía máy chủ." },
];

function AuthGate({ onAuthenticated }: { onAuthenticated: (teacher: Teacher) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 12) return setError("Mật khẩu cần tối thiểu 12 ký tự.");
    setBusy(true);
    setError("");
    try {
      onAuthenticated(await authenticate(email.trim(), password));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể đăng nhập.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="brand-mark" aria-hidden="true">S</div>
        <p className="eyebrow">TRƯỜNG TIỂU HỌC TRẦN QUỐC TOẢN</p>
        <h1 id="auth-title">AI SCORM Studio</h1>
        <p className="muted">Đăng nhập để tiếp tục soạn, duyệt và xuất bài giảng SCORM.</p>
        <a className="google-button" href="/api/v1/auth/google/start">Đăng nhập với Google</a>
        <div className="divider"><span>hoặc dùng email</span></div>
        <form onSubmit={submit}>
          <label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="giaovien@truong.edu.vn" /></label>
          <label>Mật khẩu<input type="password" autoComplete="current-password" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary" disabled={busy}>{busy ? "Đang xác thực…" : "Đăng nhập / Tạo tài khoản"}</button>
        </form>
        <small>Tài khoản mới sẽ được tạo tự động khi email chưa đăng ký.</small>
      </section>
    </main>
  );
}

export default function Home() {
  const [teacher, setTeacher] = useState<Teacher | null | undefined>(undefined);
  const [activeStep, setActiveStep] = useState(1);
  const [draft, setDraft] = useState<CourseDraft>(initialCourseDraft);
  const [project, setProject] = useState<Project | null>(null);
  const [sources, setSources] = useState<SourceMaterial[]>([]);
  const [sourceDirty, setSourceDirty] = useState(false);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<{ tone: "idle" | "loading" | "saved" | "error"; message: string }>({ tone: "idle", message: "Chưa lưu" });
  const [directionState, setDirectionState] = useState<{ tone: "idle" | "loading" | "saved" | "error"; message: string }>({ tone: "idle", message: "Chưa chọn" });
  const [credentials, setCredentials] = useState<AICredential[]>([]);
  const [credentialsLoading, setCredentialsLoading] = useState(false);
  const [aiProvider, setAIProvider] = useState<AIProvider>("mock");
  const [credentialId, setCredentialId] = useState("");
  const [generationState, setGenerationState] = useState<{ tone: "idle" | "loading" | "saved" | "error"; message: string }>({ tone: "idle", message: "Chưa tạo nội dung" });
  const [generationResult, setGenerationResult] = useState<{ provider: string; model?: string; objectives: number; slides: number; questions: number; retries?: number } | null>(null);
  const [reviewState, setReviewState] = useState<{ tone: "idle" | "loading" | "saved" | "error"; message: string }>({ tone: "idle", message: "Chưa duyệt" });
  const [reviewSaved, setReviewSaved] = useState(true);
  const [quizState, setQuizState] = useState<{ tone: "idle" | "loading" | "saved" | "error"; message: string }>({ tone: "idle", message: "Chưa chọn quiz" });
  const [quizSaved, setQuizSaved] = useState(true);
  const [playerState, setPlayerState] = useState<{ tone: "idle" | "loading" | "saved" | "error"; message: string }>({ tone: "idle", message: "Chưa dựng player" });

  useEffect(() => {
    currentTeacher().then(setTeacher).catch(() => setTeacher(null));
  }, []);

  useEffect(() => {
    if (!teacher) return;
    let cancelled = false;
    setWorkspaceLoading(true);
    listProjects()
      .then(async (items) => {
        const latest = items.find((item) => item.status === "active" && item.access_level === "owner");
        if (!latest) return;
        const projectSources = await listProjectSources(latest.id);
        if (cancelled) return;
        const latestSource = projectSources[0];
        setProject(latest);
        setSources(projectSources);
        setDraft({
          title: latest.title,
          direction: latest.course.metadata.direction,
          sourceText: latestSource?.extracted_text ?? "",
        });
        setSourceDirty(false);
        setSaveState({ tone: "saved", message: `Đã khôi phục • bản ${latest.revision}` });
        setDirectionState({ tone: "saved", message: "Đã lưu trong course.json" });
        if (latest.course.slides.length > 0) {
          setGenerationState({ tone: "saved", message: `Đã có nội dung • bản ${latest.revision}` });
          setGenerationResult({ provider: "Đã lưu", objectives: latest.course.objectives.length, slides: latest.course.slides.length, questions: latest.course.question_bank.length });
          setReviewState({ tone: "saved", message: `Sẵn sàng duyệt • bản ${latest.revision}` });
          setReviewSaved(true);
          setQuizState({ tone: "saved", message: `${latest.course.question_bank.filter((question) => question.selected).length} câu đang chọn` });
          setPlayerState({ tone: "saved", message: `Player canonical • bản ${latest.revision}` });
          setQuizSaved(true);
        }
      })
      .catch((reason) => {
        if (!cancelled) setSaveState({ tone: "error", message: reason instanceof Error ? reason.message : "Không thể mở bản nháp gần nhất." });
      })
      .finally(() => {
        if (!cancelled) setWorkspaceLoading(false);
      });
    return () => { cancelled = true; };
  }, [teacher]);

  useEffect(() => {
    if (!teacher) return;
    let cancelled = false;
    setCredentialsLoading(true);
    listAICredentials()
      .then((items) => { if (!cancelled) setCredentials(items); })
      .catch((reason) => { if (!cancelled) setGenerationState({ tone: "error", message: reason instanceof Error ? reason.message : "Không thể tải API key." }); })
      .finally(() => { if (!cancelled) setCredentialsLoading(false); });
    return () => { cancelled = true; };
  }, [teacher]);

  function markChanged() {
    setSaveState({ tone: "idle", message: "Có thay đổi chưa lưu" });
  }

  async function ensureProject(): Promise<Project> {
    const title = draft.title.trim();
    let current = project;
    if (!current) {
      current = await createProject(title, draft.direction);
    } else if (current.title !== title) {
      current = await updateProjectTitle(current, title);
    }
    setProject(current);
    return current;
  }

  async function saveDraft(): Promise<boolean> {
    if (busy) return false;
    const title = draft.title.trim();
    if (!title) {
      setSaveState({ tone: "error", message: "Cần nhập tên bài học." });
      return false;
    }
    if (!draft.sourceText.trim() && sources.length === 0) {
      setSaveState({ tone: "error", message: "Hãy nhập nội dung hoặc chọn một tệp học liệu." });
      return false;
    }
    setBusy(true);
    setSaveState({ tone: "loading", message: "Đang lưu bản nháp…" });
    try {
      const current = await ensureProject();
      if (sourceDirty && draft.sourceText.trim()) {
        const textFile = new File([draft.sourceText], "noi-dung-nhap.txt", { type: "text/plain" });
        const savedSource = await uploadProjectSource(current.id, textFile);
        setSources((items) => [savedSource, ...items]);
        setSourceDirty(false);
      }
      setSaveState({ tone: "saved", message: `Đã lưu • bản ${current.revision}` });
      return true;
    } catch (reason) {
      setSaveState({ tone: "error", message: reason instanceof Error ? reason.message : "Không thể lưu bản nháp." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function uploadSource(file: File | undefined) {
    if (!file || busy) return;
    if (file.size < 1 || file.size > MAX_SOURCE_BYTES) {
      setSaveState({ tone: "error", message: "Tệp phải có dung lượng từ 1 byte đến 25 MB." });
      return;
    }
    if (!draft.title.trim()) {
      setSaveState({ tone: "error", message: "Nhập tên bài học trước khi tải học liệu." });
      return;
    }
    setBusy(true);
    setSaveState({ tone: "loading", message: "Đang tải và đọc học liệu…" });
    try {
      const current = await ensureProject();
      const savedSource = await uploadProjectSource(current.id, file);
      setSources((items) => [savedSource, ...items]);
      if (savedSource.extracted_text) setDraft((value) => ({ ...value, sourceText: savedSource.extracted_text ?? "" }));
      setSourceDirty(false);
      setSaveState({ tone: "saved", message: `Đã tải ${savedSource.original_name}` });
    } catch (reason) {
      setSaveState({ tone: "error", message: reason instanceof Error ? reason.message : "Không thể tải học liệu." });
    } finally {
      setBusy(false);
    }
  }

  async function saveDirection(): Promise<boolean> {
    if (busy) return false;
    if (!project) {
      setSaveState({ tone: "error", message: "Cần lưu nguồn bài học trước." });
      setActiveStep(1);
      return false;
    }
    if (project.course.metadata.direction === draft.direction) {
      setDirectionState({ tone: "saved", message: "Đã lưu trong course.json" });
      return true;
    }
    setBusy(true);
    setDirectionState({ tone: "loading", message: "Đang lưu định hướng…" });
    try {
      const updated = await updateProjectDirection(project, draft.direction);
      setProject(updated);
      setDirectionState({ tone: "saved", message: `Đã lưu • bản ${updated.revision}` });
      return true;
    } catch (reason) {
      setDirectionState({ tone: "error", message: reason instanceof Error ? reason.message : "Không thể lưu định hướng." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  function selectProvider(provider: AIProvider) {
    setAIProvider(provider);
    const firstCredential = credentials.find((item) => item.provider === provider);
    setCredentialId(firstCredential?.id ?? "");
    if (project?.course.slides.length === 0) setGenerationState({ tone: "idle", message: "Sẵn sàng tạo nội dung" });
  }

  async function generateAIContent(): Promise<boolean> {
    if (busy) return false;
    if (!project) {
      setSaveState({ tone: "error", message: "Cần lưu nguồn bài học trước." });
      setActiveStep(1);
      return false;
    }
    if (project.course.slides.length > 0) {
      setGenerationState({ tone: "error", message: "Bài đã có nội dung. Hãy chuyển sang Bước 4 để duyệt và chỉnh sửa." });
      return false;
    }
    if (!draft.sourceText.trim()) {
      setGenerationState({ tone: "error", message: "Không có nội dung nguồn để AI phân tích." });
      setActiveStep(1);
      return false;
    }
    if (project.course.metadata.direction !== draft.direction) {
      setDirectionState({ tone: "error", message: "Cần lưu định hướng trước khi tạo nội dung." });
      setActiveStep(2);
      return false;
    }
    if (aiProvider !== "mock" && !credentialId) {
      setGenerationState({ tone: "error", message: "Hãy chọn API key đang hoạt động hoặc dùng Mock AI miễn phí." });
      return false;
    }
    setBusy(true);
    setGenerationState({ tone: "loading", message: "AI đang phân tích và dựng bản nháp…" });
    try {
      const generated: GenerationResponse = await generateCourse({
        title: project.title,
        source: draft.sourceText,
        direction: draft.direction,
        provider: aiProvider,
        credentialId,
      });
      const updated = await populateProjectFromGeneration(project, generated);
      setProject(updated);
      setGenerationResult({
        provider: generated.generation.provider,
        model: generated.generation.model,
        objectives: updated.course.objectives.length,
        slides: updated.course.slides.length,
        questions: updated.course.question_bank.length,
        retries: generated.generation.retries,
      });
      setGenerationState({ tone: "saved", message: `Đã lưu nội dung • bản ${updated.revision}` });
      setReviewState({ tone: "saved", message: `Sẵn sàng duyệt • bản ${updated.revision}` });
      setReviewSaved(true);
      setQuizState({ tone: "saved", message: `${updated.course.question_bank.filter((question) => question.selected).length} câu đang chọn` });
      setQuizSaved(true);
      setPlayerState({ tone: "saved", message: `Sẵn sàng dựng • bản ${updated.revision}` });
      return true;
    } catch (reason) {
      setGenerationState({ tone: "error", message: reason instanceof Error ? reason.message : "Không thể tạo nội dung bằng AI." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function navigateToStep(number: number) {
    if (activeStep === 4 && number !== 4 && !reviewSaved) {
      setReviewState({ tone: "error", message: "Hãy chờ autosave hoàn tất trước khi rời Bước 4." });
      return;
    }
    if (activeStep === 5 && number !== 5 && !quizSaved) {
      setQuizState({ tone: "error", message: "Hãy chờ autosave hoàn tất trước khi rời Bước 5." });
      return;
    }
    if (number > 1 && activeStep === 1 && !(await saveDraft())) return;
    if (number > 2 && activeStep === 1) {
      setActiveStep(2);
      return;
    }
    if (number > 2 && activeStep === 2 && !(await saveDirection())) return;
    if (number > 3 && activeStep === 2) {
      setActiveStep(3);
      return;
    }
    if (number > 3 && activeStep === 3 && (!project || project.course.slides.length === 0)) {
      setGenerationState({ tone: "error", message: "Cần tạo và lưu nội dung AI trước khi chuyển sang duyệt." });
      return;
    }
    if (number > 4 && activeStep === 3) {
      setActiveStep(4);
      return;
    }
    if (number > 5 && activeStep === 4) {
      setActiveStep(5);
      return;
    }
    if (number > 6 && activeStep === 5) {
      setActiveStep(6);
      return;
    }
    setActiveStep(number);
  }

  async function advance() {
    if (activeStep === 1 && !(await saveDraft())) return;
    if (activeStep === 2 && !(await saveDirection())) return;
    if (activeStep === 3 && (!project || project.course.slides.length === 0)) {
      setGenerationState({ tone: "error", message: "Cần tạo và lưu nội dung AI trước khi chuyển sang duyệt." });
      return;
    }
    if (activeStep === 4 && !reviewSaved) {
      setReviewState({ tone: "error", message: "Hãy chờ autosave hoàn tất trước khi tiếp tục." });
      return;
    }
    if (activeStep === 5 && !quizSaved) {
      setQuizState({ tone: "error", message: "Hãy chờ autosave hoàn tất trước khi tiếp tục." });
      return;
    }
    setActiveStep((value) => Math.min(8, value + 1));
  }

  function startNewDraft() {
    if (busy) return;
    setProject(null);
    setSources([]);
    setDraft(initialCourseDraft);
    setSourceDirty(false);
    setSaveState({ tone: "idle", message: "Bài mới chưa lưu" });
    setDirectionState({ tone: "idle", message: "Chưa chọn" });
    setGenerationState({ tone: "idle", message: "Chưa tạo nội dung" });
    setGenerationResult(null);
    setReviewState({ tone: "idle", message: "Chưa duyệt" });
    setReviewSaved(true);
    setQuizState({ tone: "idle", message: "Chưa chọn quiz" });
    setQuizSaved(true);
    setPlayerState({ tone: "idle", message: "Chưa dựng player" });
    setActiveStep(1);
  }

  if (teacher === undefined) return <main className="loading-page"><div className="loading-mark">S</div><p>Đang mở không gian soạn bài…</p></main>;
  if (teacher === null) return <AuthGate onAuthenticated={setTeacher} />;

  async function logout() {
    await signOut();
    setTeacher(null);
    setProject(null);
    setSources([]);
    setDraft(initialCourseDraft);
    setDirectionState({ tone: "idle", message: "Chưa chọn" });
    setCredentials([]);
    setCredentialId("");
    setAIProvider("mock");
    setGenerationState({ tone: "idle", message: "Chưa tạo nội dung" });
    setGenerationResult(null);
    setReviewState({ tone: "idle", message: "Chưa duyệt" });
    setReviewSaved(true);
    setQuizState({ tone: "idle", message: "Chưa chọn quiz" });
    setQuizSaved(true);
    setPlayerState({ tone: "idle", message: "Chưa dựng player" });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">S</div><div><strong>AI SCORM Studio</strong><span>Trần Quốc Toản</span></div></div>
        <nav aria-label="Quy trình soạn bài">
          {steps.map(([title, detail], index) => {
            const number = index + 1;
            return <button key={title} className={number === activeStep ? "step active" : number < activeStep ? "step done" : "step"} onClick={() => { void navigateToStep(number); }}><b>{number < activeStep ? "✓" : number}</b><span><strong>{title}</strong><small>{detail}</small></span></button>;
          })}
        </nav>
        <div className="sidebar-note"><strong>Nguyên tắc</strong><p>AI tạo nháp. Giáo viên duyệt. Hệ thống mới đóng gói SCORM.</p></div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">WORKFLOW PRODUCTION</p><h1>{steps[activeStep - 1][0]}</h1></div>
          <div className="account"><span>{teacher.full_name || teacher.email}</span><button onClick={logout}>Đăng xuất</button></div>
        </header>

        <section className="work-card">
          {activeStep === 1 ? (
            <>
              <div className="section-heading">
                <div><span className="task-label">TASK 01</span><h2>Nguồn bài học</h2><p>Dán nội dung hoặc chọn học liệu để bắt đầu một bản nháp canonical.</p></div>
                <div className="draft-actions"><span className={`status-pill ${saveState.tone}`} role="status">{workspaceLoading ? "Đang khôi phục…" : saveState.message}</span><button type="button" onClick={startNewDraft} disabled={busy || workspaceLoading}>+ Bài mới</button></div>
              </div>
              <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void saveDraft(); }}>
                {project && <div className="project-context"><span>Đang làm</span><strong>{project.title}</strong><small>Mã {project.id.slice(0, 8)} • phiên bản {project.revision}</small></div>}
                <label>Tên bài học<input required maxLength={300} disabled={busy || workspaceLoading} value={draft.title} onChange={(event) => { setDraft({ ...draft, title: event.target.value }); markChanged(); }} placeholder="Ví dụ: Phân số bằng nhau" /></label>
                <label className="source-field">Nội dung nguồn<textarea disabled={busy || workspaceLoading} value={draft.sourceText} onChange={(event) => { setDraft({ ...draft, sourceText: event.target.value }); setSourceDirty(true); markChanged(); }} placeholder="Dán nội dung bài học tại đây…" rows={12} /></label>
                <label className="upload-field"><span>Hoặc tải học liệu</span><input type="file" disabled={busy || workspaceLoading} accept=".txt,.pdf,.docx,.pptx" onChange={(event) => { void uploadSource(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /><small>TXT, PDF, DOCX hoặc PPTX; tối đa 25 MB. Hệ thống sẽ trích xuất nội dung để giáo viên kiểm tra.</small></label>
                {sources.length > 0 && <div className="source-history"><strong>Học liệu đã lưu</strong>{sources.slice(0, 3).map((source) => <span key={source.id}>{source.original_name}<small>{Math.max(1, Math.round(source.byte_size / 1024))} KB</small></span>)}</div>}
                <div className="save-row"><p>Dữ liệu chỉ được xem là đã lưu khi máy chủ xác nhận.</p><button className="primary" disabled={busy || workspaceLoading}>{busy ? "Đang lưu…" : project ? "Lưu thay đổi" : "Tạo bản nháp"}</button></div>
              </form>
            </>
          ) : activeStep === 2 ? (
            <>
              <div className="section-heading">
                <div><span className="task-label">TASK 02</span><h2>Chọn định hướng bài giảng</h2><p>Định hướng quyết định cấu trúc mà AI sẽ dùng ở bước tiếp theo.</p></div>
                <span className={`status-pill ${directionState.tone}`} role="status">{directionState.message}</span>
              </div>
              <form className="direction-form" onSubmit={(event) => { event.preventDefault(); void saveDirection(); }}>
                <fieldset disabled={busy || workspaceLoading}>
                  <legend>Chọn một định hướng phù hợp với mục tiêu tiết dạy</legend>
                  <div className="direction-grid">
                    {directionOptions.map((option, index) => (
                      <label className={draft.direction === option.id ? "direction-card selected" : "direction-card"} key={option.id}>
                        <input type="radio" name="direction" value={option.id} checked={draft.direction === option.id} onChange={() => { setDraft((value) => ({ ...value, direction: option.id })); setDirectionState({ tone: "idle", message: "Có thay đổi chưa lưu" }); }} />
                        <span className="direction-number">{String(index + 1).padStart(2, "0")}</span>
                        <strong>{option.title}</strong>
                        <p>{option.summary}</p>
                        <small>{option.outcome}</small>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="direction-summary">
                  <div><span>Định hướng đang chọn</span><strong>{directionOptions.find((option) => option.id === draft.direction)?.title}</strong></div>
                  <p>Lựa chọn được lưu trong <code>course.json</code>; nội dung nguồn và các tệp đã tải ở Bước 1 không thay đổi.</p>
                </div>
                <div className="save-row"><p>Hệ thống dùng revision để ngăn hai phiên ghi đè lẫn nhau.</p><button className="primary" disabled={busy || workspaceLoading}>{busy ? "Đang lưu…" : "Lưu định hướng"}</button></div>
              </form>
            </>
          ) : activeStep === 3 ? (
            <>
              <div className="section-heading">
                <div><span className="task-label">TASK 03</span><h2>AI tạo bản nháp có cấu trúc</h2><p>Chọn nhà cung cấp rồi tạo mục tiêu, slide và ngân hàng câu hỏi từ nguồn đã lưu.</p></div>
                <span className={`status-pill ${generationState.tone}`} role="status">{generationState.message}</span>
              </div>
              <form className="generation-form" onSubmit={(event) => { event.preventDefault(); void generateAIContent(); }}>
                <fieldset disabled={busy || workspaceLoading}>
                  <legend>Nhà cung cấp AI</legend>
                  <div className="provider-grid">
                    {providerOptions.map((option) => (
                      <label className={aiProvider === option.id ? "provider-card selected" : "provider-card"} key={option.id}>
                        <input type="radio" name="provider" value={option.id} checked={aiProvider === option.id} onChange={() => selectProvider(option.id)} />
                        <span className="provider-title"><strong>{option.title}</strong><small>{option.badge}</small></span>
                        <p>{option.summary}</p>
                      </label>
                    ))}
                  </div>
                </fieldset>

                {aiProvider !== "mock" && (
                  <div className="credential-panel">
                    <label>API key đã lưu
                      <select disabled={busy || credentialsLoading} value={credentialId} onChange={(event) => setCredentialId(event.target.value)}>
                        <option value="">{credentialsLoading ? "Đang tải danh sách…" : "Chọn một API key đang hoạt động"}</option>
                        {credentials.filter((item) => item.provider === aiProvider).map((item) => (
                          <option key={item.id} value={item.id}>{item.label} ••••{item.secret_last4}{item.model_default ? ` • ${item.model_default}` : ""}</option>
                        ))}
                      </select>
                    </label>
                    {credentials.filter((item) => item.provider === aiProvider).length === 0 && !credentialsLoading && <p>Chưa có key {aiProvider === "openai" ? "OpenAI" : "Gemini"} đang hoạt động. Có thể chọn Mock AI để tiếp tục bản demo; khóa thật chỉ được nhập và mã hóa ở phía máy chủ.</p>}
                    <small>Trình duyệt chỉ nhận mã định danh, nhãn và bốn ký tự cuối; không nhận lại giá trị bí mật.</small>
                  </div>
                )}

                <div className="generation-context">
                  <div className="generation-context-heading"><span>Dữ liệu đầu vào đã khóa</span><small>AI không tạo dự án mới và không thay đổi nguồn gốc.</small></div>
                  <div className="context-grid">
                    <div><span>Bài học</span><strong>{project?.title ?? "Chưa có bản nháp"}</strong></div>
                    <div><span>Định hướng</span><strong>{directionOptions.find((option) => option.id === draft.direction)?.title}</strong></div>
                    <div><span>Nội dung nguồn</span><strong>{draft.sourceText.trim().length.toLocaleString("vi-VN")} ký tự</strong></div>
                    <div><span>Phiên bản</span><strong>{project ? `${project.id.slice(0, 8)} • bản ${project.revision}` : "Chưa lưu"}</strong></div>
                  </div>
                </div>

                {generationResult && (
                  <div className="generation-result" aria-live="polite">
                    <div><span>Kết quả canonical</span><strong>{generationResult.provider}{generationResult.model ? ` • ${generationResult.model}` : ""}</strong><small>{generationResult.retries ? `Đã tự sửa JSON ${generationResult.retries} lần` : "Dữ liệu hợp lệ ngay lần đầu"}</small></div>
                    <div className="result-stats"><span><b>{generationResult.objectives}</b>Mục tiêu</span><span><b>{generationResult.slides}</b>Slide</span><span><b>{generationResult.questions}</b>Câu hỏi</span></div>
                  </div>
                )}

                <div className="generation-note"><strong>Giáo viên giữ quyền quyết định.</strong><p>AI chỉ tạo bản nháp. Nội dung cần được đọc, sửa và duyệt ở Bước 4 trước khi chọn quiz hoặc đóng gói SCORM.</p></div>
                <div className="save-row"><p>Kết quả được kiểm tra theo schema rồi lưu vào đúng <code>course.json</code> của dự án này.</p><button className="primary" disabled={busy || workspaceLoading || Boolean(project?.course.slides.length) || (aiProvider !== "mock" && !credentialId)}>{busy ? "Đang tạo bản nháp…" : project?.course.slides.length ? "Nội dung đã được lưu" : "Tạo nội dung bằng AI"}</button></div>
              </form>
            </>
          ) : activeStep === 4 && project ? (
            <>
              <div className="section-heading">
                <div><span className="task-label">TASK 04</span><h2>Giáo viên duyệt và chỉnh sửa</h2><p>Kiểm tra mục tiêu, biên tập từng slide và chỉ đánh dấu đã duyệt khi nội dung chính xác.</p></div>
                <span className={`status-pill ${reviewState.tone}`} role="status">{reviewState.message}</span>
              </div>
              <CourseEditor
                key={project.id}
                project={project}
                sourceText={draft.sourceText}
                provider={aiProvider}
                credentialId={credentialId}
                onProjectChange={setProject}
                onSaveState={(tone, message, saved) => { setReviewState({ tone, message }); setReviewSaved(saved); }}
              />
            </>
          ) : activeStep === 5 && project ? (
            <>
              <div className="section-heading">
                <div><span className="task-label">TASK 05</span><h2>Ngân hàng câu hỏi và chọn Quiz</h2><p>Chọn câu sẽ dùng, chỉnh cách chấm điểm và giữ các câu còn lại để tái sử dụng.</p></div>
                <span className={`status-pill ${quizState.tone}`} role="status">{quizState.message}</span>
              </div>
              <QuizEditor
                key={project.id}
                project={project}
                onProjectChange={setProject}
                onSaveState={(tone, message, saved) => { setQuizState({ tone, message }); setQuizSaved(saved); }}
              />
            </>
          ) : activeStep === 6 && project ? (
            <>
              <div className="section-heading">
                <div><span className="task-label">TASK 06</span><h2>Dựng và xem trước bài giảng HTML5</h2><p>Kiểm tra player thật, tạo media theo slide rồi chủ động gắn tài sản phù hợp vào bài.</p></div>
                <span className={`status-pill ${playerState.tone}`} role="status">{playerState.message}</span>
              </div>
              <PlayerStudio
                key={project.id}
                project={project}
                provider={aiProvider}
                credentialId={credentialId}
                onProjectChange={setProject}
                onStatus={(tone, message) => setPlayerState({ tone, message })}
              />
            </>
          ) : (
            <div className="step-placeholder"><span>{String(activeStep).padStart(2, "0")}</span><h2>{steps[activeStep - 1][0]}</h2><p>Chức năng này tiếp tục dùng bản prototype ổn định và sẽ được chuyển sang TypeScript ở milestone kế tiếp.</p></div>
          )}
        </section>

        <footer className="flow-footer"><button disabled={activeStep === 1} onClick={() => { void navigateToStep(Math.max(1, activeStep - 1)); }}>← Quay lại</button><span>Bước {activeStep}/8</span><button className="primary" disabled={busy || workspaceLoading || (activeStep === 4 && !reviewSaved) || (activeStep === 5 && !quizSaved)} onClick={() => { void advance(); }}>{activeStep === 8 ? "Hoàn tất" : activeStep <= 2 ? "Lưu & tiếp tục →" : "Tiếp tục →"}</button></footer>
      </main>
    </div>
  );
}
