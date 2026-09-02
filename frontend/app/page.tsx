"use client";

import { FormEvent, useEffect, useState } from "react";
import { authenticate, currentTeacher, signOut, type Teacher } from "@/lib/api";
import { initialCourseDraft, type CourseDraft } from "@/lib/course";

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

  useEffect(() => {
    currentTeacher().then(setTeacher).catch(() => setTeacher(null));
  }, []);

  if (teacher === undefined) return <main className="loading-page"><div className="loading-mark">S</div><p>Đang mở không gian soạn bài…</p></main>;
  if (teacher === null) return <AuthGate onAuthenticated={setTeacher} />;

  async function logout() {
    await signOut();
    setTeacher(null);
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
              <div className="section-heading"><div><span className="task-label">TASK 01</span><h2>Nguồn bài học</h2><p>Dán nội dung hoặc chọn học liệu để bắt đầu một bản nháp canonical.</p></div><span className="status-pill">Chưa lưu</span></div>
              <div className="form-grid">
                <label>Tên bài học<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Ví dụ: Phân số bằng nhau" /></label>
                <label className="source-field">Nội dung nguồn<textarea value={draft.sourceText} onChange={(event) => setDraft({ ...draft, sourceText: event.target.value })} placeholder="Dán nội dung bài học tại đây…" rows={12} /></label>
                <label className="upload-field"><span>Hoặc tải học liệu</span><input type="file" accept=".txt,.pdf,.docx,.pptx" /><small>TXT, PDF, DOCX hoặc PPTX; tối đa 25 MB.</small></label>
              </div>
            </>
          ) : (
            <div className="step-placeholder"><span>{String(activeStep).padStart(2, "0")}</span><h2>{steps[activeStep - 1][0]}</h2><p>Chức năng này tiếp tục dùng bản prototype ổn định và sẽ được chuyển sang TypeScript ở milestone kế tiếp.</p></div>
          )}
        </section>

        <footer className="flow-footer"><button disabled={activeStep === 1} onClick={() => setActiveStep((value) => Math.max(1, value - 1))}>← Quay lại</button><span>Bước {activeStep}/8</span><button className="primary" onClick={() => setActiveStep((value) => Math.min(8, value + 1))}>{activeStep === 8 ? "Hoàn tất" : "Tiếp tục →"}</button></footer>
      </main>
    </div>
  );
}
