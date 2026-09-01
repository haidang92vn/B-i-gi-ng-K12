# AI SCORM Studio — Codex Starter Bundle

Bộ khởi đầu để phát triển ứng dụng web tự động tạo bài giảng SCORM 2004 cho K12Online, theo trải nghiệm gần iSpring nhưng dùng AI để tạo nội dung và câu hỏi.

## Mục tiêu sản phẩm

Luồng chính:

1. Giáo viên nhập nội dung hoặc học liệu.
2. Chọn định hướng: **Bài học mới / Ôn tập – củng cố / Nâng cao – mở rộng**.
3. Hệ thống dùng **API AI cá nhân của giáo viên** để tạo mục tiêu, storyboard, nội dung và ngân hàng câu hỏi.
4. Giáo viên duyệt/chỉnh sửa.
5. Giáo viên chọn câu hỏi và loại Quiz.
6. Hệ thống dựng bài giảng HTML5.
7. Áp preset **K12Online / SCORM 2004**.
8. Kiểm tra và xuất `.zip` để upload lên LMS.

## Bắt đầu với Codex

1. Đọc `AGENTS.md`.
2. Đọc `docs/ARCHITECTURE.md` và `schemas/course.schema.json`.
3. Chạy prototype hiện tại trong `prototype/` để hiểu workflow.
4. Bắt đầu từ `prompts/01-course-model-and-persistence.md`.
5. Không làm nhiều milestone trong một thay đổi lớn nếu chưa có test.

## Chạy prototype

```bash
cd prototype
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Mở `http://127.0.0.1:8000`.

## Cấu trúc bundle

```text
AGENTS.md                 Quy tắc dành cho Codex
TASKS.md                  Backlog + acceptance criteria
.env.example              Mẫu biến môi trường, không chứa secret
prototype/                Web app demo đang chạy
schemas/                  Schema dữ liệu trung tâm
examples/                 Course JSON mẫu
prompts/                  Prompt giao từng milestone cho Codex
docs/ARCHITECTURE.md      Kiến trúc production
docs/SECURITY.md          Nguyên tắc bảo mật
docs/SCORM.md             Yêu cầu SCORM 2004/K12Online
docs/DEPLOYMENT.md        Định hướng VPS + R2 + backup
docs/DECISIONS.md         Các quyết định đã chốt
```

## Stack mục tiêu

- Frontend: Next.js + TypeScript
- Backend: FastAPI + Pydantic
- Database: PostgreSQL
- Cache/Queue: Redis
- Object Storage: S3-compatible, ưu tiên Cloudflare R2
- Deployment: Docker Compose trên VPS Singapore ở giai đoạn đầu
- AI: Provider Adapter; API key thuộc về từng giáo viên

## Nguyên tắc cốt lõi

- `course.json` là **single source of truth**.
- HTML chỉ là đầu ra render/preview/export.
- AI tạo nháp; giáo viên là người duyệt cuối cùng.
- Không để API key của giáo viên trong frontend, localStorage, source code hoặc log.
- File lớn không lưu trực tiếp trong PostgreSQL.
- SCORM export phải được validator kiểm tra trước khi cho tải.
