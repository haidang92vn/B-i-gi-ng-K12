"use client";

import { useEffect, useRef, useState } from "react";
import CourseEditor from "@/app/course-editor";
import LmsSettingsEditor from "@/app/lms-settings";
import QuizEditor from "@/app/quiz-editor";
import { clearLocalWorkspace, loadLocalWorkspace, restoreLocalCourseBackup, saveGeneratedCourse, saveLocalSource } from "@/lib/local-workspace";
import { initialCourseDraft, type CourseDraft } from "@/lib/course";
import { serverlessExport, serverlessGenerate, serverlessPreview, serverlessProviders, serverlessQuality, type ProviderStatus, type ServerlessProvider } from "@/lib/serverless-api";
import { qualityFindingTarget, saveQualityFocus, sortQualityFindings } from "@/lib/export";
import type { Project, WorkflowDirection } from "@/lib/api";

const steps = [
  ["Nhập nội dung", "Văn bản bài học"], ["Định hướng", "Bài học / Ôn tập / Nâng cao"], ["AI tạo nội dung", "Kịch bản + câu hỏi"], ["Giáo viên duyệt", "Sửa trước khi xuất bản"],
  ["Chọn Quiz", "Dạng câu hỏi tương tác"], ["Dựng bài giảng", "Xem trước cục bộ"], ["Cấu hình LMS", "K12Online • SCORM 2004"], ["Kiểm tra & xuất", "Chờ dịch vụ đóng ZIP"],
] as const;

const directions: Array<{ id: WorkflowDirection; title: string; summary: string }> = [
  { id: "lesson", title: "Bài học mới", summary: "Giải thích kiến thức theo tiến trình rõ ràng." },
  { id: "review", title: "Ôn tập – củng cố", summary: "Hệ thống hóa nội dung và ưu tiên kiểm tra nhanh." },
  { id: "advanced", title: "Nâng cao – mở rộng", summary: "Tạo tình huống vận dụng và câu hỏi tư duy." },
];

function textOf(project: Project) {
  return project.course.slides[0]?.blocks.filter((block) => ["heading", "text", "callout"].includes(block.type)).map((block) => block.text).filter(Boolean).join("\n\n") || "Chưa có nội dung để xem trước.";
}

function LocalPreview({ project }: { project: Project }) {
  const [slideIndex, setSlideIndex] = useState(0);
  const [preview, setPreview] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const slide = project.course.slides[slideIndex];
  useEffect(() => setSlideIndex(0), [project.id]);
  async function buildPreview() { setLoading(true); setMessage(""); try { setPreview(await serverlessPreview(project.course)); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Không thể dựng player."); } finally { setLoading(false); } }
  if (!slide) return <p className="player-empty">Chưa có slide để dựng player.</p>;
  return <div className="local-preview"><div className="local-preview-head"><span>BẢN XEM TRƯỚC SERVERLESS</span><strong>{project.title}</strong><small>HTML chỉ được dựng tạm từ course.json, không lưu làm dữ liệu nguồn.</small></div><article><span>{slideIndex + 1}/{project.course.slides.length}</span><h3>{slide.title}</h3><p>{textOf({ ...project, course: { ...project.course, slides: [slide] } })}</p></article><div className="local-preview-nav"><button type="button" disabled={slideIndex === 0} onClick={() => setSlideIndex((value) => value - 1)}>← Trước</button><button type="button" disabled={slideIndex === project.course.slides.length - 1} onClick={() => setSlideIndex((value) => value + 1)}>Tiếp →</button><button type="button" className="primary" disabled={loading} onClick={() => { void buildPreview(); }}>{loading ? "Đang dựng…" : "Dựng player SCORM"}</button></div>{preview && <iframe className="serverless-preview" sandbox="allow-scripts" srcDoc={preview} title={`Player SCORM ${project.title}`} />}{message && <p className="export-message error">{message}</p>}<aside>Media, TTS và video không có trong bản không lưu trữ này. Chúng sẽ mở lại khi trường dùng storage.</aside></div>;
}

function LocalExport({ project, onOpenStep = (step) => window.dispatchEvent(new CustomEvent<number>("open-workflow-step", { detail: step })) }: { project: Project; onOpenStep?: (step: number) => void }) {
  const [backupState, setBackupState] = useState("");
  const [report, setReport] = useState<Awaited<ReturnType<typeof serverlessQuality>> | null>(null);
  const [busy, setBusy] = useState(false);
  const warnings = [
    project.course.slides.some((slide) => slide.status !== "approved") ? "Còn slide chưa được giáo viên duyệt." : "",
    project.course.question_bank.filter((question) => question.selected).length === 0 ? "Chưa chọn câu hỏi nào cho quiz." : "",
  ].filter(Boolean);
  function downloadBackup() {
    const blob = new Blob([JSON.stringify(project.course, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "course.json"; anchor.click(); URL.revokeObjectURL(url);
    setBackupState("Đã tải course.json để sao lưu. Đây chưa phải ZIP SCORM.");
  }
  async function checkQuality() { setBusy(true); setBackupState(""); try { setReport(await serverlessQuality(project.course)); } catch (reason) { setReport(null); setBackupState(reason instanceof Error ? reason.message : "Không thể kiểm tra chất lượng."); } finally { setBusy(false); } }
  async function downloadScorm() { setBusy(true); try { const result = await serverlessExport(project.course); const url = URL.createObjectURL(result.blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = result.filename; anchor.click(); URL.revokeObjectURL(url); setBackupState(`Đã tải ${result.filename}.`); } catch (reason) { setBackupState(reason instanceof Error ? reason.message : "Không thể đóng gói SCORM."); } finally { setBusy(false); } }
  function openFinding(finding: NonNullable<typeof report>["findings"][number]) {
    saveQualityFocus(finding);
    onOpenStep(qualityFindingTarget(finding).step);
  }
  return <div className="export-studio"><section className="export-hero"><div><span>CHẾ ĐỘ KHÔNG LƯU TRỮ</span><h3>Kiểm tra trước khi đóng gói</h3><p>API stateless nhận course.json, kiểm tra và trả ZIP SCORM trực tiếp — không lưu lịch sử export.</p></div><div className="export-actions"><button type="button" onClick={downloadBackup}>Tải bản sao course.json</button><button type="button" onClick={() => { void checkQuality(); }} disabled={busy}>{busy ? "Đang kiểm tra…" : "Kiểm tra chất lượng"}</button><button type="button" className="primary" disabled={busy} onClick={() => { void downloadScorm(); }}>{busy ? "Đang đóng gói…" : "Tải ZIP SCORM"}</button></div></section>{warnings.length ? <section className="quality-report"><strong>Cần xem lại trước khi xuất</strong><ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section> : <section className="quality-report"><strong>Đã sẵn sàng để validator serverless kiểm tra.</strong><p>Vẫn cần upload thử lên K12Online sau khi có ZIP.</p></section>}{report && <section className="quality-report" aria-live="polite"><div className="quality-summary"><div><span>ĐIỂM SẴN SÀNG</span><strong>{report.score}<small>/100</small></strong><p>{report.summary.warnings} cảnh báo • {report.summary.checked_slides} slide • {report.summary.checked_questions} câu hỏi</p></div></div>{report.findings.length ? <div className="finding-list">{sortQualityFindings(report.findings).map((finding) => { const target = qualityFindingTarget(finding); return <article className={`finding ${finding.severity}`} key={`${finding.code}-${finding.item_id || "course"}`}><span>{finding.severity === "warning" ? "CẦN XEM" : "GỢI Ý"}</span><div><strong>{finding.title}</strong><p>{finding.message}</p><small>{finding.suggestion}</small><button type="button" className="finding-action" onClick={() => openFinding(finding)}>{target.label}</button></div></article>; })}</div> : <p className="quality-clear">Không phát hiện điểm cần xem lại tự động. Giáo viên vẫn cần duyệt chuyên môn.</p>}</section>}{backupState && <p className="export-message">{backupState}</p>}</div>;
}

export default function LocalAuthoring() {
  const [activeStep, setActiveStep] = useState(1);
  const [draft, setDraft] = useState<CourseDraft>(initialCourseDraft);
  const [project, setProject] = useState<Project | null>(null);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("Bản nháp chỉ lưu trên thiết bị này.");
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<ServerlessProvider>("mock");
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const editorSaved = useRef(true);
  const draftDirty = useRef(false);
  const pendingStep = useRef<number | null>(null);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!editorSaved.current || draftDirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);

  function editorSaveState(tone: string, text: string, saved: boolean) {
    editorSaved.current = saved;
    setMessage(text);
    if (tone === "error") pendingStep.current = null;
    if (saved && pendingStep.current !== null) {
      setActiveStep(pendingStep.current);
      pendingStep.current = null;
    }
  }

  async function navigate(step: number) {
    if (busy || step === activeStep) return;
    if (!editorSaved.current) {
      pendingStep.current = step;
      setMessage("Đang chờ lưu thay đổi trước khi chuyển bước. Nếu lưu lỗi, hãy bấm Thử lưu lại.");
      return;
    }
    if (draftDirty.current && !(await saveSource())) return;
    setActiveStep(step);
  }

  useEffect(() => {
    const openStep = (event: Event) => { void navigate((event as CustomEvent<number>).detail); };
    window.addEventListener("open-workflow-step", openStep);
    return () => window.removeEventListener("open-workflow-step", openStep);
  });

  useEffect(() => { const saved = loadLocalWorkspace(); if (saved) { setDraft(saved.draft); setProject(saved.project); setMessage(saved.project ? `Đã khôi phục bản nháp cục bộ • bản ${saved.project.revision}` : "Bản nháp chỉ lưu trên thiết bị này."); } setReady(true); }, []);
  useEffect(() => { void serverlessProviders().then(setProviderStatus).catch(() => setMessage("Không thể kiểm tra trạng thái AI serverless; Mock AI vẫn có thể thử lại sau.")); }, []);
  function changeDraft(next: CourseDraft) { draftDirty.current = true; setDraft(next); setMessage("Có thay đổi chưa lưu trên trình duyệt."); }
  async function saveSource() {
    const title = draft.title.trim(); const sourceText = draft.sourceText.trim();
    if (!title || !sourceText) { setMessage("Nhập tên bài học và nội dung nguồn trước khi tiếp tục."); return false; }
    setBusy(true);
    try {
      const next = await saveLocalSource(project, { title, sourceText, direction: draft.direction });
      draftDirty.current = false; setProject(next);
      setMessage(`Đã lưu trên trình duyệt • bản ${next.revision}`);
      return true;
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Không thể lưu bản nháp.");
      return false;
    } finally { setBusy(false); }
  }
  async function saveDirection() { return saveSource(); }
  async function generate() { if (!project || !draft.sourceText.trim()) { setMessage("Lưu nội dung nguồn trước khi tạo bản nháp."); setActiveStep(1); return; } setBusy(true); try { const generated = await serverlessGenerate({ title: project.title, source: draft.sourceText, direction: draft.direction, provider }); const next = await saveGeneratedCourse(project, generated.course); setProject(next); setMessage(`${provider === "mock" ? "Mock AI" : provider === "openai" ? "ChatGPT" : "Gemini"} đã tạo ${next.course.slides.length} slide và ${next.course.question_bank.length} câu hỏi • giáo viên cần duyệt.`); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Không thể tạo bản nháp AI."); } finally { setBusy(false); } }
  async function importBackup(file: File | undefined) {
    if (!file) return;
    if (busy || !editorSaved.current) { setMessage("Hãy lưu xong thay đổi trước khi nhập bài khác."); return; }
    if (file.size > 1024 * 1024) { setMessage("course.json quá lớn; giới hạn nhập là 1 MB."); return; }
    if ((project || draftDirty.current) && !window.confirm("Nhập course.json sẽ thay thế bản nháp hiện tại trên thiết bị này. Anh/chị đã tải bản sao cần giữ chưa?")) return;
    setBusy(true);
    try {
      const restored = await restoreLocalCourseBackup(JSON.parse(await file.text()) as unknown);
      draftDirty.current = false;
      setDraft(restored.draft); setProject(restored.project); setActiveStep(restored.project.course.slides.length ? 4 : 1);
      setMessage(`Đã khôi phục “${restored.project.title}” từ course.json • bản ${restored.project.revision}. Nội dung nguồn được tái tạo từ slide, không phải tệp nguồn ban đầu.`);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Không thể nhập course.json."); } finally { setBusy(false); }
  }
  async function next() { if (activeStep === 1 && !(await saveSource())) return; if (activeStep === 2 && !(await saveDirection())) return; if (activeStep === 3 && !project?.course.slides.length) { setMessage("Tạo nội dung AI trước khi tiếp tục."); return; } await navigate(Math.min(8, activeStep + 1)); }
  function newDraft() {
    if (busy || !editorSaved.current) { setMessage("Hãy lưu xong thay đổi trước khi mở bài mới."); return; }
    if ((project || draft.title || draft.sourceText) && !window.confirm("Mở bài mới sẽ xóa bản nháp hiện tại trên thiết bị. Hãy hủy và tải bản sao cần giữ trước. Tiếp tục xóa?")) return;
    try {
      clearLocalWorkspace(); draftDirty.current = false; pendingStep.current = null;
      setProject(null); setDraft(initialCourseDraft); setActiveStep(1);
      setMessage("Đã mở bài mới. Bản cũ đã bị xóa khỏi trình duyệt này.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Không thể mở bài mới."); }
  }

  if (!ready) return <main className="loading-page"><div className="loading-mark">S</div><p>Đang mở không gian soạn bài…</p></main>;
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-mark">S</div><div><strong>AI SCORM Studio</strong><span>Soạn bài cục bộ</span></div></div><nav aria-label="Quy trình soạn bài">{steps.map(([title, detail], index) => <button key={title} className={index + 1 === activeStep ? "step active" : index + 1 < activeStep ? "step done" : "step"} onClick={() => { void navigate(index + 1); }}><b>{index + 1 < activeStep ? "✓" : index + 1}</b><span><strong>{title}</strong><small>{detail}</small></span></button>)}</nav><div className="sidebar-note"><strong>Không có tài khoản hay máy chủ dữ liệu</strong><p>Hãy tải bản sao course.json trước khi xóa dữ liệu trình duyệt.</p></div></aside><main className="workspace"><header className="topbar"><div><p className="eyebrow">LOCAL-FIRST AUTHORING</p><h1>{steps[activeStep - 1][0]}</h1></div><div className="topbar-actions"><input ref={backupInput} type="file" accept="application/json,.json" aria-label="Nhập bản sao course.json" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void importBackup(file); }} /><button type="button" disabled={busy} onClick={() => backupInput.current?.click()}>Nhập course.json</button><button type="button" onClick={newDraft}>+ Bài mới</button></div></header><section className="work-card"><p className="backend-notice" role="status"><strong>{message}</strong><span>Không có đăng nhập, database hay lưu lịch sử trong chế độ này.</span></p>{activeStep === 1 ? <div className="form-grid"><label>Tên bài học<input maxLength={300} value={draft.title} onChange={(event) => changeDraft({ ...draft, title: event.target.value })} placeholder="Ví dụ: Phân số bằng nhau" /></label><label className="source-field">Nội dung nguồn<textarea value={draft.sourceText} onChange={(event) => changeDraft({ ...draft, sourceText: event.target.value })} placeholder="Dán nội dung bài học tại đây…" rows={14} maxLength={24000} /></label><small>Chỉ nhận văn bản tối đa 24.000 ký tự. PDF, DOCX, PPTX, media và TTS sẽ cần gói có storage.</small><button type="button" className="primary" disabled={busy} onClick={() => { void saveSource(); }}>{busy ? "Đang lưu…" : "Lưu bản nháp trên thiết bị"}</button></div> : activeStep === 2 ? <div className="direction-form"><div className="direction-grid">{directions.map((option, index) => <label className={draft.direction === option.id ? "direction-card selected" : "direction-card"} key={option.id}><input type="radio" checked={draft.direction === option.id} onChange={() => changeDraft({ ...draft, direction: option.id })} /><span className="direction-number">{String(index + 1).padStart(2, "0")}</span><strong>{option.title}</strong><p>{option.summary}</p></label>)}</div><button type="button" className="primary" disabled={busy} onClick={() => { void saveDirection(); }}>Lưu định hướng</button></div> : activeStep === 3 ? <div className="generation-form"><fieldset disabled={busy || Boolean(project?.course.slides.length)}><legend>Chọn AI tạo bản nháp</legend><div className="provider-grid">{([['mock', 'Mock AI', 'Miễn phí'], ['openai', 'ChatGPT', 'Cần OpenAI API key'], ['gemini', 'Gemini', 'Cần Gemini API key']] as Array<[ServerlessProvider, string, string]>).map(([id, title, hint]) => { const available = providerStatus?.[id]?.available ?? id === 'mock'; return <label className={provider === id ? 'provider-card selected' : 'provider-card'} key={id}><input type="radio" checked={provider === id} disabled={!available} onChange={() => setProvider(id)} /><span className="provider-title"><strong>{title}</strong><small>{available ? providerStatus?.[id]?.model || hint : 'Chưa cấu hình'}</small></span><p>{id === 'mock' ? 'Không gửi nội dung ra ngoài.' : available ? 'Khóa chỉ nằm ở Vercel; trình duyệt không nhận khóa.' : `${hint}.`}</p></label>; })}</div></fieldset><div className="generation-context"><strong>{project?.title || "Chưa có bản nháp"}</strong><small>{draft.sourceText.trim().length.toLocaleString("vi-VN")} ký tự nguồn</small></div><button type="button" className="primary" disabled={busy || Boolean(project?.course.slides.length) || !(providerStatus?.[provider]?.available ?? provider === 'mock')} onClick={() => { void generate(); }}>{busy ? "Đang tạo…" : project?.course.slides.length ? "Nội dung đã tạo" : `Tạo bản nháp bằng ${provider === 'mock' ? 'Mock AI' : provider === 'openai' ? 'ChatGPT' : 'Gemini'}`}</button></div> : activeStep === 4 && project ? <CourseEditor key={project.id} project={project} sourceText={draft.sourceText} provider="mock" credentialId="" onProjectChange={setProject} onSaveState={editorSaveState} /> : activeStep === 5 && project ? <QuizEditor key={project.id} project={project} onProjectChange={setProject} onSaveState={editorSaveState} /> : activeStep === 6 && project ? <LocalPreview project={project} /> : activeStep === 7 && project ? <LmsSettingsEditor key={project.id} project={project} localOnly onProjectChange={setProject} onSaveState={editorSaveState} /> : activeStep === 8 && project ? <LocalExport project={project} /> : <div className="step-placeholder"><h2>Hãy tạo nội dung trước khi mở bước này.</h2><p>Quay lại Bước 1–3 để hoàn thành bản nháp.</p></div>}</section><footer className="flow-footer"><button disabled={activeStep === 1} onClick={() => { void navigate(activeStep - 1); }}>← Quay lại</button><span>Bước {activeStep}/8</span><button className="primary" disabled={busy || activeStep === 8} onClick={() => { void next(); }}>{activeStep === 8 ? "Hoàn tất" : "Tiếp tục →"}</button></footer></main></div>;
}
