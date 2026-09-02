"use client";

import { useEffect, useMemo, useState } from "react";
import { exportScorm, listExports, runQualityCheck, type ExportRecord, type Project, type QualityReport } from "@/lib/api";
import { formatByteSize, formatExportTime, sortQualityFindings } from "@/lib/export";

type Props = {
  project: Project;
  onStatus: (tone: "idle" | "loading" | "saved" | "error", message: string) => void;
};

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

export default function ExportStudio({ project, onStatus }: Props) {
  const [report, setReport] = useState<QualityReport | null>(null);
  const [history, setHistory] = useState<ExportRecord[]>([]);
  const [checking, setChecking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [message, setMessage] = useState("");
  const canExport = project.course.slides.length > 0;
  const projectHistory = useMemo(() => history.filter((record) => record.project_id === project.id), [history, project.id]);

  async function refreshHistory(silent = false) {
    setHistoryLoading(true);
    try {
      setHistory(await listExports());
      return true;
    } catch (reason) {
      if (!silent) setMessage(reason instanceof Error ? reason.message : "Không thể tải lịch sử xuất bản.");
      return false;
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => { void refreshHistory(); }, [project.id]);
  useEffect(() => { setReport(null); }, [project.id, project.revision]);

  async function checkQuality() {
    setChecking(true);
    setMessage("");
    onStatus("loading", "Đang kiểm tra chất lượng canonical…");
    try {
      const next = await runQualityCheck(project.id);
      setReport(next);
      const label = next.summary.warnings ? `${next.summary.warnings} cảnh báo cần giáo viên xem lại` : "Không có cảnh báo chất lượng";
      onStatus("saved", `${label} • bản ${next.revision}`);
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : "Không thể kiểm tra chất lượng.";
      setMessage(detail);
      onStatus("error", detail);
    } finally {
      setChecking(false);
    }
  }

  async function createExport() {
    if (!canExport) return;
    setExporting(true);
    setMessage("");
    onStatus("loading", "Backend đang xác thực và đóng gói ZIP SCORM…");
    try {
      const result = await exportScorm(project);
      download(result.blob, result.filename);
      await refreshHistory(true);
      const warningText = result.warningCount ? ` • ${result.warningCount} cảnh báo media` : "";
      onStatus("saved", `Đã tải ${result.filename}${warningText}`);
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : "Không thể xuất SCORM.";
      setMessage(detail);
      onStatus("error", detail);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="export-studio">
      <section className="export-hero">
        <div><span>SCORM 2004 • SERVER-SIDE</span><h3>Kiểm tra, đóng gói và tải bài giảng</h3><p>ZIP chỉ được trả về sau khi backend xác thực manifest, runtime, tệp gốc, media và chính sách cấu hình đã lưu trong <code>course.json</code>.</p></div>
        <div className="export-actions"><button type="button" onClick={() => { void checkQuality(); }} disabled={checking || exporting}>{checking ? "Đang kiểm tra…" : "Kiểm tra chất lượng"}</button><button type="button" className="primary" onClick={() => { void createExport(); }} disabled={!canExport || checking || exporting}>{exporting ? "Đang đóng gói…" : "Tải ZIP SCORM"}</button></div>
      </section>

      {!canExport && <p className="export-message error">Cần có ít nhất một slide đã lưu trước khi xuất SCORM.</p>}
      {message && <p className="export-message error" role="alert">{message}</p>}

      <section className="export-gates" aria-label="Các lớp kiểm tra xuất bản">
        <div><b>01</b><span><strong>Chất lượng nội dung</strong><small>Khuyến nghị để giáo viên rà soát; không tự chặn xuất bản.</small></span></div>
        <div><b>02</b><span><strong>Validator kỹ thuật</strong><small>Backend chặn ZIP có manifest, runtime hoặc media không hợp lệ.</small></span></div>
        <div><b>03</b><span><strong>Kiểm thử LMS thật</strong><small>Upload thử trên tenant K12Online trước khi giao cho học sinh.</small></span></div>
      </section>

      <section className="upload-checklist" aria-labelledby="upload-checklist-title">
        <div><span>SAU KHI TẢI ZIP</span><h3 id="upload-checklist-title">Checklist đưa bài lên K12Online</h3></div>
        <ol>
          <li>Giữ nguyên tệp <code>.zip</code>; không giải nén, nén lại hoặc chèn thêm tệp thủ công.</li>
          <li>Tải ZIP vào khu vực bài học SCORM của K12Online theo quyền và quy trình của trường.</li>
          <li>Mở thử bằng một tài khoản học sinh, đi hết bài, nộp quiz rồi thoát và vào lại để kiểm tra resume.</li>
          <li>Chỉ giao chính thức sau khi completion, điểm và trạng thái đạt/chưa đạt hiển thị đúng.</li>
        </ol>
      </section>

      {report && <section className="quality-report" aria-live="polite">
        <div className="quality-summary"><div><span>ĐIỂM SẴN SÀNG</span><strong>{report.score}<small>/100</small></strong><p>Kiểm tra bản {report.revision} • {report.summary.checked_slides} slide • {report.summary.checked_questions} câu hỏi</p></div><div className="quality-count"><span><b>{report.summary.warnings}</b>Cảnh báo</span><span><b>{report.summary.info}</b>Gợi ý</span></div></div>
        <p className="quality-disclaimer">Kết quả là gợi ý có thể giải thích được, không thay thế việc duyệt chuyên môn và không phải xác nhận tương thích K12Online.</p>
        {report.findings.length ? <div className="finding-list">{sortQualityFindings(report.findings).map((finding) => <article className={`finding ${finding.severity}`} key={`${finding.code}-${finding.item_id || "course"}`}><span>{finding.severity === "warning" ? "CẦN XEM" : "GỢI Ý"}</span><div><strong>{finding.title}</strong><p>{finding.message}</p><small>{finding.suggestion}</small></div></article>)}</div> : <p className="quality-clear">Không phát hiện điểm cần xem lại theo các quy tắc tự động. Giáo viên vẫn cần duyệt nội dung chuyên môn.</p>}
      </section>}

      <section className="export-history">
        <div className="export-history-head"><div><span>LỊCH SỬ CỦA BÀI NÀY</span><h3>Các ZIP đã được validator chấp nhận</h3></div><button type="button" onClick={() => { void refreshHistory(); }} disabled={historyLoading || exporting}>{historyLoading ? "Đang tải…" : "Làm mới"}</button></div>
        {historyLoading ? <p className="history-empty">Đang tải lịch sử…</p> : projectHistory.length ? <div className="history-list">{projectHistory.map((record) => <article key={record.id}><span className={record.status === "ready" ? "ready" : "pending"}>{record.status === "ready" ? "Sẵn sàng" : record.status}</span><div><strong>{record.filename}</strong><small>{formatExportTime(record.created_at)} • {formatByteSize(record.byte_size)} • mã {record.id.slice(0, 8)}</small></div></article>)}</div> : <p className="history-empty">Chưa có ZIP nào cho bài giảng này. ZIP thành công sẽ được lưu metadata trong lịch sử và bản tải được gửi ngay cho anh.</p>}
      </section>

      <aside className="manual-lms-check"><strong>Phân biệt hai kết quả</strong><p>Điểm chất lượng là gợi ý để giáo viên duyệt chuyên môn; validator kỹ thuật mới quyết định ZIP có được tải hay không. Cả hai vẫn không thay thế kiểm thử trên tenant K12Online thật.</p></aside>
    </div>
  );
}
