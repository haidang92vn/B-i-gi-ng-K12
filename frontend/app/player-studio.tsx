"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  addProjectMediaUrl,
  attachProjectMedia,
  generateSlideImage,
  generateSlideTTS,
  listProjectMedia,
  uploadProjectMedia,
  type AIProvider,
  type MediaAsset,
  type MediaKind,
  type Project,
} from "@/lib/api";
import { formatMediaSize, slideNarration, validateMediaFile } from "@/lib/media";

type Props = {
  project: Project;
  provider: AIProvider;
  credentialId: string;
  onProjectChange: (project: Project) => void;
  onStatus: (tone: "idle" | "loading" | "saved" | "error", message: string) => void;
};

const sourceLabels: Record<MediaAsset["source_type"], string> = {
  upload: "Tệp giáo viên",
  url: "URL HTTPS",
  generated: "Ảnh AI",
  tts: "Giọng đọc AI",
};

function AssetPreview({ asset }: { asset: MediaAsset }) {
  if (asset.kind === "image") return <img src={asset.content_url} alt={asset.original_name} loading="lazy" />;
  if (asset.kind === "audio") return <audio controls preload="metadata" src={asset.content_url}>Trình duyệt không hỗ trợ âm thanh.</audio>;
  return <video controls preload="metadata" src={asset.content_url}>Trình duyệt không hỗ trợ video.</video>;
}

export default function PlayerStudio({ project, provider, credentialId, onProjectChange, onStatus }: Props) {
  const canEdit = project.access_level !== "viewer";
  const [slideId, setSlideId] = useState(project.course.slides[0]?.id ?? "");
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState("");
  const [imagePrompt, setImagePrompt] = useState("");
  const [ttsText, setTtsText] = useState(() => project.course.slides[0] ? slideNarration(project.course.slides[0]) : "");
  const [voice, setVoice] = useState("alloy");
  const [uploadRights, setUploadRights] = useState(false);
  const [urlRights, setUrlRights] = useState(false);
  const [urlKind, setUrlKind] = useState<MediaKind>("image");
  const [mediaUrl, setMediaUrl] = useState("");
  const [urlLabel, setUrlLabel] = useState("");
  const [localMessage, setLocalMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const selectedSlide = project.course.slides.find((slide) => slide.id === slideId) ?? project.course.slides[0];
  const selectedAssetIds = useMemo(
    () => new Set(selectedSlide?.blocks.flatMap((block) => block.asset_id ? [block.asset_id] : []) ?? []),
    [selectedSlide],
  );
  const slideAssets = assets.filter((asset) => asset.slide_id === selectedSlide?.id || selectedAssetIds.has(asset.id));
  const providerReady = provider === "mock" || Boolean(credentialId);
  const playerUrl = `/api/v1/projects/${project.id}/player`;

  useEffect(() => {
    let active = true;
    setLoading(true);
    listProjectMedia(project.id)
      .then((items) => { if (active) setAssets(items); })
      .catch((reason) => { if (active) setLocalMessage(reason instanceof Error ? reason.message : "Không thể tải media."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [project.id]);

  useEffect(() => {
    if (!selectedSlide) return;
    setTtsText(slideNarration(selectedSlide));
  }, [selectedSlide?.id]);

  async function runMedia(name: string, work: () => Promise<MediaAsset>, success: string) {
    if (!selectedSlide || operation) return;
    setOperation(name);
    setLocalMessage("");
    onStatus("loading", "Đang tạo bản xem thử media…");
    try {
      const asset = await work();
      setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
      setLocalMessage(success);
      onStatus("saved", "Media xem thử đã sẵn sàng");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Không thể xử lý media.";
      setLocalMessage(message);
      onStatus("error", message);
    } finally {
      setOperation("");
    }
  }

  async function createImage(event: FormEvent) {
    event.preventDefault();
    if (!selectedSlide) return;
    await runMedia("image", () => generateSlideImage(project.id, selectedSlide.id, {
      prompt: imagePrompt.trim(), provider, credentialId,
    }), "Ảnh đã được tạo. Hãy xem trước rồi mới gắn vào slide.");
  }

  async function createTTS(event: FormEvent) {
    event.preventDefault();
    if (!selectedSlide) return;
    await runMedia("tts", () => generateSlideTTS(project.id, selectedSlide.id, {
      text: ttsText.trim(), voice: voice.trim(), provider, credentialId,
    }), "Giọng đọc đã được tạo. Hãy nghe thử rồi mới gắn vào slide.");
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!selectedSlide || !file) return;
    const warning = validateMediaFile(file);
    if (warning) {
      setLocalMessage(warning);
      onStatus("error", warning);
      return;
    }
    if (!uploadRights) return;
    await runMedia("upload", () => uploadProjectMedia(project.id, selectedSlide.id, file), "Tệp đã tải lên. Hãy xem thử trước khi gắn vào bài.");
    if (fileInput.current) fileInput.current.value = "";
    setUploadRights(false);
  }

  async function addUrl(event: FormEvent) {
    event.preventDefault();
    if (!selectedSlide || !urlRights) return;
    await runMedia("url", () => addProjectMediaUrl(project.id, selectedSlide.id, {
      kind: urlKind, url: mediaUrl.trim(), label: urlLabel.trim(),
    }), "URL đã lưu dưới dạng bản xem thử; nội dung ngoài sẽ không được chép vào ZIP.");
    setMediaUrl("");
    setUrlLabel("");
    setUrlRights(false);
  }

  async function attach(asset: MediaAsset) {
    if (!selectedSlide || operation) return;
    setOperation(`attach-${asset.id}`);
    setLocalMessage("");
    onStatus("loading", "Đang gắn media vào course.json…");
    try {
      const updated = await attachProjectMedia(project, selectedSlide.id, asset.id);
      onProjectChange(updated);
      setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, status: "attached", slide_id: selectedSlide.id } : item));
      setLocalMessage("Đã gắn media vào slide và lưu một phiên bản course.json mới.");
      onStatus("saved", `Player đã cập nhật • bản ${updated.revision}`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Không thể gắn media.";
      setLocalMessage(message);
      onStatus("error", message);
    } finally {
      setOperation("");
    }
  }

  if (!selectedSlide) {
    return <div className="player-empty"><strong>Chưa có slide để dựng player.</strong><p>Hãy quay lại Bước 3 tạo nội dung, sau đó duyệt ở Bước 4.</p></div>;
  }

  return (
    <div className="player-studio">
      <div className="build-pipeline" aria-label="Quy trình dựng player">
        <div><b>01</b><span>course.json</span><small>Nội dung đã duyệt</small></div><i>→</i>
        <div><b>02</b><span>Player HTML5</span><small>Dựng tại backend</small></div><i>→</i>
        <div><b>03</b><span>Tương tác</span><small>Slide + quiz</small></div><i>→</i>
        <div><b>04</b><span>SCORM Runtime</span><small>Dùng lại ở bước xuất</small></div>
      </div>

      <section className="player-preview-card">
        <div className="player-preview-head">
          <div><span>BẢN XEM TRƯỚC TRỰC TIẾP</span><strong>{project.title}</strong><small>Player được dựng lại từ bản canonical {project.revision}; HTML không được lưu làm dữ liệu nguồn.</small></div>
          <a className="primary-link" href={playerUrl} target="_blank" rel="noopener noreferrer">Mở toàn màn hình ↗</a>
        </div>
        <div className="player-frame-shell"><iframe key={project.revision} src={playerUrl} title={`Bản xem trước ${project.title}`} /></div>
        <div className="player-facts">
          <span><b>{project.course.slides.length}</b> slide</span>
          <span><b>{project.course.question_bank.filter((question) => question.selected).length}</b> quiz đã chọn</span>
          <span><b>{project.course.navigation?.mode === "restricted" ? "Hạn chế" : project.course.navigation?.mode === "sequential" ? "Tuần tự" : "Tự do"}</b> điều hướng</span>
          <span><b>{project.course.completion?.passing_score ?? 70}%</b> điểm đạt</span>
        </div>
      </section>

      <section className="media-studio-next">
        <div className="media-heading">
          <div><span>MEDIA &amp; TTS AI</span><h3>Minh họa và giọng đọc theo slide</h3><p>Mỗi tài sản phải được xem thử trước; chỉ nút <strong>Gắn vào slide</strong> mới thêm mã asset vào <code>course.json</code>.</p></div>
          <label>Slide đích<select value={selectedSlide.id} onChange={(event) => setSlideId(event.target.value)}>{project.course.slides.map((slide, index) => <option key={slide.id} value={slide.id}>{index + 1}. {slide.title}</option>)}</select></label>
        </div>

        {!canEdit ? <div className="viewer-notice">Anh đang có quyền chỉ xem. Có thể chạy player và xem media đã gắn, nhưng không thể tạo hoặc thay đổi tài sản.</div> : (
          <>
            <div className="media-authoring-grid">
              <form onSubmit={createImage}>
                <span className="media-form-icon">IMG</span><h4>Tạo ảnh AI</h4>
                <label>Prompt minh họa<textarea required minLength={5} maxLength={4000} value={imagePrompt} onChange={(event) => setImagePrompt(event.target.value)} placeholder="Sơ đồ vòng tuần hoàn nước, phong cách sách giáo khoa tiểu học…" /></label>
                <button disabled={Boolean(operation) || !providerReady}>{operation === "image" ? "Đang tạo…" : "Tạo ảnh xem thử"}</button>
              </form>
              <form onSubmit={createTTS}>
                <span className="media-form-icon">TTS</span><h4>Giọng đọc AI</h4>
                <label>Nội dung đọc<textarea required maxLength={4096} value={ttsText} onChange={(event) => setTtsText(event.target.value)} /></label>
                <label>Giọng đọc<input required minLength={2} maxLength={40} value={voice} onChange={(event) => setVoice(event.target.value)} /></label>
                <button disabled={Boolean(operation) || !providerReady}>{operation === "tts" ? "Đang tạo…" : "Tạo giọng đọc xem thử"}</button>
              </form>
              <form onSubmit={upload}>
                <span className="media-form-icon">UP</span><h4>Tệp của giáo viên</h4>
                <label>Ảnh, âm thanh hoặc video<input ref={fileInput} required type="file" accept="image/jpeg,image/png,image/webp,image/gif,audio/mpeg,audio/wav,audio/ogg,audio/mp4,video/mp4,video/webm" /></label>
                <label className="rights-check"><input type="checkbox" required checked={uploadRights} onChange={(event) => setUploadRights(event.target.checked)} /> Tôi có quyền sử dụng media này.</label>
                <button disabled={Boolean(operation) || !uploadRights}>{operation === "upload" ? "Đang tải…" : "Tải lên để xem thử"}</button>
              </form>
              <form onSubmit={addUrl}>
                <span className="media-form-icon">URL</span><h4>Media từ URL</h4>
                <div className="url-fields"><label>Loại<select value={urlKind} onChange={(event) => setUrlKind(event.target.value as MediaKind)}><option value="image">Ảnh</option><option value="audio">Âm thanh</option><option value="video">Video</option></select></label><label>Nhãn<input required maxLength={255} value={urlLabel} onChange={(event) => setUrlLabel(event.target.value)} /></label></div>
                <label>URL HTTPS công khai<input required type="url" pattern="https://.*" value={mediaUrl} onChange={(event) => setMediaUrl(event.target.value)} placeholder="https://…" /></label>
                <label className="rights-check"><input type="checkbox" required checked={urlRights} onChange={(event) => setUrlRights(event.target.checked)} /> Tôi có quyền sử dụng URL này.</label>
                <button disabled={Boolean(operation) || !urlRights}>{operation === "url" ? "Đang lưu…" : "Lưu URL để xem thử"}</button>
              </form>
            </div>
            {!providerReady && <p className="provider-warning">Hãy chọn API key {provider === "openai" ? "OpenAI" : "Gemini"} ở Bước 3 hoặc chuyển sang Mock AI miễn phí để tạo media.</p>}
          </>
        )}

        <div className="media-security"><strong>Kiểm tra trước khi lưu</strong><span>Ảnh ≤ 10 MB</span><span>Âm thanh ≤ 25 MB</span><span>Video ≤ 200 MB</span><span>Video trên 25 MB sẽ cảnh báo ZIP nặng</span></div>
        {localMessage && <p className="media-message" role="status">{localMessage}</p>}

        <div className="media-library-head"><div><span>MEDIA CỦA SLIDE</span><strong>{selectedSlide.title}</strong></div><small>Mã asset có thể dùng cho câu hỏi chọn hình ở Bước 5.</small></div>
        {loading ? <p className="media-empty">Đang tải danh sách media…</p> : slideAssets.length === 0 ? <p className="media-empty">Slide này chưa có media. Tạo, tải lên hoặc thêm URL để bắt đầu.</p> : (
          <div className="media-library">
            {slideAssets.map((asset) => {
              const attached = selectedAssetIds.has(asset.id) || asset.status === "attached";
              return <article className="media-asset" key={asset.id}>
                <div className="asset-preview"><AssetPreview asset={asset} /></div>
                <div className="asset-detail"><span>{sourceLabels[asset.source_type]} • {formatMediaSize(asset.byte_size)}</span><strong>{asset.original_name}</strong><small>Mã asset: <code>{asset.id}</code></small>{asset.provider && <small>{asset.provider}{asset.model ? ` • ${asset.model}` : ""}</small>}{asset.warning && <p>{asset.warning}</p>}</div>
                <div className="asset-action">{attached ? <span>✓ Đã gắn</span> : canEdit ? <button disabled={Boolean(operation)} onClick={() => { void attach(asset); }}>{operation === `attach-${asset.id}` ? "Đang gắn…" : "Gắn vào slide"}</button> : <span>Bản xem thử</span>}</div>
              </article>;
            })}
          </div>
        )}
      </section>
    </div>
  );
}
