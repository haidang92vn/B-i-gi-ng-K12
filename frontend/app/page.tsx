"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  authenticate,
  createProject,
  currentTeacher,
  listProjects,
  listProjectSources,
  signOut,
  updateProjectTitle,
  uploadProjectSource,
  type Project,
  type SourceMaterial,
  type Teacher,
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
      })
      .catch((reason) => {
        if (!cancelled) setSaveState({ tone: "error", message: reason instanceof Error ? reason.message : "Không thể mở bản nháp gần nhất." });
      })
      .finally(() => {
        if (!cancelled) setWorkspaceLoading(false);
      });
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

  function startNewDraft() {
    if (busy) return;
    setProject(null);
    setSources([]);
    setDraft(initialCourseDraft);
    setSourceDirty(false);
    setSaveState({ tone: "idle", message: "Bài mới chưa lưu" });
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
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">S</div><div><strong>AI SCORM Studio</strong><span>Trần Quốc Toản</span></div></div>
        <nav aria-label="Quy trình soạn bài">
          {steps.map(([title, detail], index) => {
            const number = index + 1;
            return <button key={title} className={number === activeStep ? "step active" : number < activeStep ? "step done" : "step"} onClick={() => setActiveStep(number)}><b>{number < activeStep ? "✓" : number}</b><span><strong>{title}</strong><small>{detail}</small></span></button>;
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
                <label className="upload-field"><span>Hoặc tải học liệu</span><input type="file" disabled={busy || workspaceLoading} accept=".txt,.pdf,.docx,.pptx" onChange={(event) => { void uploadSource(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /><small>TXT, PDF, DOCX hoặc PPTX; tối đa 25 MB. Hệ thống sẽ trích xuất nội dung để anh kiểm tra.</small></label>
                {sources.length > 0 && <div className="source-history"><strong>Học liệu đã lưu</strong>{sources.slice(0, 3).map((source) => <span key={source.id}>{source.original_name}<small>{Math.max(1, Math.round(source.byte_size / 1024))} KB</small></span>)}</div>}
                <div className="save-row"><p>Dữ liệu chỉ được xem là đã lưu khi máy chủ xác nhận.</p><button className="primary" disabled={busy || workspaceLoading}>{busy ? "Đang lưu…" : project ? "Lưu thay đổi" : "Tạo bản nháp"}</button></div>
              </form>
            </>
          ) : (
            <div className="step-placeholder"><span>{String(activeStep).padStart(2, "0")}</span><h2>{steps[activeStep - 1][0]}</h2><p>Chức năng này tiếp tục dùng bản prototype ổn định và sẽ được chuyển sang TypeScript ở milestone kế tiếp.</p></div>
          )}
        </section>

        <footer className="flow-footer"><button disabled={activeStep === 1} onClick={() => setActiveStep((value) => Math.max(1, value - 1))}>← Quay lại</button><span>Bước {activeStep}/8</span><button className="primary" disabled={busy || workspaceLoading} onClick={async () => { if (activeStep === 1 && !(await saveDraft())) return; setActiveStep((value) => Math.min(8, value + 1)); }}>{activeStep === 8 ? "Hoàn tất" : activeStep === 1 ? "Lưu & tiếp tục →" : "Tiếp tục →"}</button></footer>
      </main>
    </div>
  );
}
