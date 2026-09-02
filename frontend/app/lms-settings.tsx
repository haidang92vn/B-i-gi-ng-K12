"use client";

import { useEffect, useRef, useState } from "react";
import { getProject, updateCanonicalCourse, type NavigationMode, type Project, type ScormPreset } from "@/lib/api";
import { applyLmsSettings, k12OnlinePreset, lmsWarnings, settingsFromCourse, type LmsSettings } from "@/lib/scorm";

type SaveTone = "idle" | "loading" | "saved" | "error";

type Props = {
  project: Project;
  onProjectChange: (project: Project) => void;
  onSaveState: (tone: SaveTone, message: string, saved: boolean) => void;
};

const navigationModes: Array<{ id: NavigationMode; title: string; description: string }> = [
  { id: "free", title: "Tự do", description: "Người học có thể mở bất kỳ slide nào từ menu." },
  { id: "sequential", title: "Tuần tự", description: "Chỉ mở slide kế tiếp sau khi đã đi qua slide hiện tại." },
  { id: "restricted", title: "Hạn chế", description: "Chỉ cho phép di chuyển từng bước Trước hoặc Tiếp." },
];

function cloneSettings(settings: LmsSettings): LmsSettings {
  return JSON.parse(JSON.stringify(settings)) as LmsSettings;
}

function boundedPercent(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : fallback;
}

export default function LmsSettingsEditor({ project, onProjectChange, onSaveState }: Props) {
  const canEdit = project.access_level !== "viewer";
  const [settings, setSettings] = useState<LmsSettings>(() => settingsFromCourse(project.course));
  const [serverProject, setServerProject] = useState(project);
  const [editVersion, setEditVersion] = useState(0);
  const [savedVersion, setSavedVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saveConflict, setSaveConflict] = useState(false);
  const settingsRef = useRef(settings);
  const serverProjectRef = useRef(project);
  const editVersionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const savingRef = useRef(false);
  const fullySaved = editVersion === savedVersion && !saving;
  const selectedQuizCount = project.course.question_bank.filter((question) => question.selected).length;
  const warnings = lmsWarnings(settings, selectedQuizCount);
  const playerUrl = `/api/v1/projects/${project.id}/player`;

  function replaceSettings(next: LmsSettings) {
    settingsRef.current = next;
    setSettings(next);
  }

  function change(mutator: (draft: LmsSettings) => void, keepPreset = false) {
    if (!canEdit) return;
    const next = cloneSettings(settingsRef.current);
    mutator(next);
    if (!keepPreset && next.scorm.preset === "k12online") next.scorm.preset = "custom";
    replaceSettings(next);
    const version = editVersionRef.current + 1;
    editVersionRef.current = version;
    setEditVersion(version);
    setSaveFailed(false);
    setSaveConflict(false);
    onSaveState("idle", "Có thay đổi • sẽ tự lưu", false);
  }

  function choosePreset(preset: ScormPreset) {
    if (preset === "k12online") {
      change((draft) => Object.assign(draft, cloneSettings(k12OnlinePreset)), true);
    } else {
      change((draft) => { draft.scorm.preset = "custom"; }, true);
    }
  }

  async function persist(version: number) {
    if (!canEdit || savingRef.current || version === savedVersionRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveFailed(false);
    onSaveState("loading", "Đang lưu cấu hình canonical…", false);
    const baseProject = serverProjectRef.current;
    const snapshot = applyLmsSettings(baseProject.course, cloneSettings(settingsRef.current));
    try {
      const updated = await updateCanonicalCourse(baseProject, snapshot);
      serverProjectRef.current = updated;
      setServerProject(updated);
      savedVersionRef.current = version;
      setSavedVersion(version);
      onProjectChange(updated);
      const newer = editVersionRef.current !== version;
      onSaveState(newer ? "idle" : "saved", newer ? "Có thay đổi mới • sẽ tự lưu" : `Đã lưu cấu hình • bản ${updated.revision}`, !newer);
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : "Không thể lưu cấu hình.";
      setSaveFailed(true);
      setSaveConflict(detail.includes("phiên khác"));
      onSaveState("error", `${detail} Lựa chọn vẫn được giữ trên màn hình.`, false);
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

  async function discardAndReload() {
    if (!window.confirm("Tải cấu hình mới nhất từ máy chủ? Các lựa chọn chưa lưu trên màn hình sẽ bị thay thế.")) return;
    setSaving(true);
    try {
      const latest = await getProject(project.id);
      serverProjectRef.current = latest;
      setServerProject(latest);
      replaceSettings(settingsFromCourse(latest.course));
      editVersionRef.current = 0;
      savedVersionRef.current = 0;
      setEditVersion(0);
      setSavedVersion(0);
      setSaveFailed(false);
      setSaveConflict(false);
      onProjectChange(latest);
      onSaveState("saved", `Đã tải cấu hình máy chủ • bản ${latest.revision}`, true);
    } catch (reason) {
      onSaveState("error", reason instanceof Error ? reason.message : "Không thể tải lại cấu hình.", false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="lms-editor">
      <section className="preset-hero">
        <div className="preset-badge"><span>PRESET ĐANG DÙNG</span><strong>{settings.scorm.preset === "k12online" ? "K12Online" : "Tùy chỉnh"}</strong><small>SCORM 2004 • {settings.scorm.edition || "4th Edition"}</small></div>
        <div><h3>Completion và Success được theo dõi độc lập</h3><p>Xem đủ tỷ lệ quyết định hoàn thành; điểm quiz quyết định đạt/chưa đạt. Các giá trị này được lưu trong <code>course.json</code> và dùng lại khi xuất ZIP.</p></div>
        <span className={fullySaved ? "canonical-state ready" : "canonical-state pending"}>{fullySaved ? `✓ Canonical bản ${serverProject.revision}` : "Đang chờ lưu"}</span>
      </section>

      {!canEdit && <p className="viewer-notice">Chế độ chỉ xem: anh có thể kiểm tra cấu hình và player nhưng không thể thay đổi chính sách LMS.</p>}

      <section className="preset-choice">
        <button type="button" disabled={!canEdit} className={settings.scorm.preset === "k12online" ? "selected" : ""} onClick={() => choosePreset("k12online")}><span>KHUYẾN NGHỊ</span><strong>K12Online</strong><small>SCORM 2004 4th Edition • resume và tracking đầy đủ</small></button>
        <button type="button" disabled={!canEdit} className={settings.scorm.preset === "custom" ? "selected" : ""} onClick={() => choosePreset("custom")}><span>NÂNG CAO</span><strong>Tùy chỉnh</strong><small>Giữ cấu hình riêng của trường hoặc LMS thử nghiệm</small></button>
      </section>

      <div className="lms-settings-grid">
        <section className="lms-card navigation-card">
          <div className="lms-card-head"><span>01</span><div><h3>Điều hướng bài học</h3><p>Kiểm soát cách người học di chuyển giữa các slide.</p></div></div>
          <div className="navigation-options">
            {navigationModes.map((mode) => <label className={settings.navigation.mode === mode.id ? "selected" : ""} key={mode.id}><input type="radio" name="navigation-mode" disabled={!canEdit} checked={settings.navigation.mode === mode.id} onChange={() => change((draft) => { draft.navigation.mode = mode.id; })} /><span><strong>{mode.title}</strong><small>{mode.description}</small></span></label>)}
          </div>
          <label className="setting-switch"><span><strong>Hiện menu slide</strong><small>Cho phép mở danh sách slide trong player.</small></span><input type="checkbox" disabled={!canEdit} checked={settings.navigation.show_menu} onChange={(event) => change((draft) => { draft.navigation.show_menu = event.target.checked; })} /></label>
          <label className="setting-switch"><span><strong>Hiện thanh tiến độ</strong><small>Hiển thị phần trăm đã đi qua trong bài.</small></span><input type="checkbox" disabled={!canEdit} checked={settings.navigation.show_progress} onChange={(event) => change((draft) => { draft.navigation.show_progress = event.target.checked; })} /></label>
        </section>

        <section className="lms-card completion-card">
          <div className="lms-card-head"><span>02</span><div><h3>Điều kiện hoàn thành</h3><p>Giới hạn 0–100 và được backend kiểm tra lại.</p></div></div>
          <label className="percent-field"><span><strong>Tỷ lệ xem tối thiểu</strong><small>Để gửi completion = completed</small></span><input type="number" min={0} max={100} disabled={!canEdit} value={settings.completion.viewed_percent} onChange={(event) => change((draft) => { draft.completion.viewed_percent = boundedPercent(event.target.value, draft.completion.viewed_percent); })} /><b>%</b></label>
          <div className="percent-meter"><i style={{ width: `${settings.completion.viewed_percent}%` }} /></div>
          <label className="percent-field"><span><strong>Điểm đạt</strong><small>Để gửi success = passed</small></span><input type="number" min={0} max={100} disabled={!canEdit} value={settings.completion.passing_score} onChange={(event) => change((draft) => { draft.completion.passing_score = boundedPercent(event.target.value, draft.completion.passing_score); })} /><b>%</b></label>
          <div className="percent-meter score"><i style={{ width: `${settings.completion.passing_score}%` }} /></div>
          <label className="setting-switch"><span><strong>Yêu cầu nộp quiz</strong><small>Không đánh dấu hoàn thành chỉ bằng việc xem slide.</small></span><input type="checkbox" disabled={!canEdit} checked={settings.completion.require_quiz} onChange={(event) => change((draft) => { draft.completion.require_quiz = event.target.checked; })} /></label>
        </section>

        <section className="lms-card tracking-card">
          <div className="lms-card-head"><span>03</span><div><h3>SCORM Runtime</h3><p>Dữ liệu gửi qua API_1484_11 khi chạy trong LMS.</p></div></div>
          <div className="standard-lock"><span>Chuẩn đóng gói</span><strong>SCORM 2004</strong><small>API_1484_11 • 4th Edition</small></div>
          <label className="setting-switch"><span><strong>Khôi phục vị trí</strong><small><code>cmi.location</code> + <code>suspend_data</code></small></span><input type="checkbox" disabled={!canEdit} checked={settings.scorm.resume} onChange={(event) => change((draft) => { draft.scorm.resume = event.target.checked; })} /></label>
          <label className="setting-switch"><span><strong>Gửi điểm</strong><small><code>cmi.score.raw/scaled</code></small></span><input type="checkbox" disabled={!canEdit} checked={settings.scorm.track_score} onChange={(event) => change((draft) => { draft.scorm.track_score = event.target.checked; })} /></label>
          <label className="setting-switch"><span><strong>Gửi hoàn thành</strong><small><code>cmi.progress_measure/completion_status</code></small></span><input type="checkbox" disabled={!canEdit} checked={settings.scorm.track_completion} onChange={(event) => change((draft) => { draft.scorm.track_completion = event.target.checked; })} /></label>
          <label className="setting-switch"><span><strong>Gửi đạt/chưa đạt</strong><small><code>cmi.success_status</code></small></span><input type="checkbox" disabled={!canEdit} checked={settings.scorm.track_success} onChange={(event) => change((draft) => { draft.scorm.track_success = event.target.checked; })} /></label>
        </section>
      </div>

      <section className={warnings.length ? "lms-review warnings" : "lms-review ready"}>
        <div><span>KIỂM TRA CẤU HÌNH</span><strong>{warnings.length ? `${warnings.length} điểm cần xem lại` : "Cấu hình logic đã sẵn sàng"}</strong></div>
        {warnings.length ? <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : <p>Điều hướng, completion, success và tracking không có mâu thuẫn đã biết.</p>}
      </section>

      <section className="lms-preview">
        <div><span>PLAYER SAU CẤU HÌNH</span><strong>Xem hiệu lực của menu, tiến độ và điều hướng</strong><small>Player tự tải lại sau khi máy chủ xác nhận revision mới.</small></div>
        <a href={playerUrl} target="_blank" rel="noopener noreferrer">Mở player ↗</a>
        <iframe key={serverProject.revision} src={playerUrl} title={`Player cấu hình LMS của ${project.title}`} />
      </section>

      <div className="compatibility-note"><strong>Chưa phải xác nhận tương thích K12Online thực tế.</strong><p>Validator tự động chỉ kiểm tra cấu trúc và runtime. Sau khi xuất ở Bước 8 vẫn phải upload vào tenant K12Online thật để kiểm tra launch, resume, completion, success, điểm và session time.</p></div>

      {saveFailed && <div className="save-recovery"><p>{saveConflict ? "Có thay đổi từ phiên khác. Cấu hình trên màn hình vẫn được giữ; chỉ tải lại khi anh chủ động chấp nhận." : "Autosave chưa thành công. Các lựa chọn hiện tại vẫn còn trên màn hình."}</p><button type="button" disabled={saving} onClick={() => { if (saveConflict) void discardAndReload(); else { setSaveFailed(false); void persist(editVersionRef.current); } }}>{saveConflict ? "Tải bản máy chủ" : "Thử lưu lại"}</button></div>}
    </div>
  );
}
