# AI SCORM Studio — Codex Starter Repository

Starter repository để phát triển ứng dụng web dùng AI hỗ trợ giáo viên tạo bài giảng
**SCORM 2004** để kiểm thử và đưa lên K12Online. Trải nghiệm sản phẩm hướng đến quy trình
đơn giản tương tự công cụ authoring như iSpring, nhưng AI đảm nhiệm phần tạo nháp nội dung
và câu hỏi; giáo viên luôn là người duyệt cuối cùng.

> **Trạng thái:** đây là starter + prototype chạy được, chưa phải production. Xem `STATUS.md`.

## Luồng sản phẩm 8 bước

1. Giáo viên nhập nội dung/học liệu.
2. Chọn **Bài học mới / Ôn tập – củng cố / Nâng cao – mở rộng**.
3. AI tạo mục tiêu, storyboard, nội dung và ngân hàng câu hỏi.
4. Giáo viên duyệt/chỉnh sửa.
5. Chọn câu hỏi và dạng Quiz.
6. Hệ thống dựng bài giảng HTML5.
7. Áp preset **K12Online / SCORM 2004**.
8. Validator kiểm tra rồi xuất `.zip` để upload LMS.

## Codex: bắt đầu tại đây

Codex phải đọc theo thứ tự:

1. `CODEX_START_HERE.md`
2. `AGENTS.md`
3. `TASKS.md`
4. `docs/ARCHITECTURE.md`
5. `schemas/course.schema.json`
6. prompt của milestone đang thực hiện trong `prompts/`

Không yêu cầu Codex xây toàn bộ sản phẩm trong một lần. Mỗi milestone phải chạy test và
đạt acceptance criteria trước khi chuyển bước.

## Kiểm tra repository trước khi commit

Tạo môi trường Python và cài dependency:

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

Chạy validator và test:

```bash
python validate_bundle.py
python -m unittest discover -s tests -v
```

GitHub Actions trong `.github/workflows/validate.yml` chạy lại các kiểm tra này trên mỗi
`push` và `pull_request`.

## Chạy prototype hiện tại

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn prototype.main:app --reload
```

Mở `http://127.0.0.1:8000`.

Prototype hiện hỗ trợ mock AI, duyệt nội dung, chọn dạng Quiz, preview và tạo gói SCORM
2004 cơ bản. Chi tiết những gì chưa có xem `STATUS.md`.

## Milestone 01: canonical course + persistence

Prototype tự tạo một SQLite database cục bộ trong `prototype/storage/` để demo. Mỗi lần
tạo nội dung mock, bản nháp được chuyển sang `course.json` chuẩn và lưu thành project; các
chỉnh sửa phần duyệt nội dung/quiz sẽ tự lưu với revision tăng dần. Đây chỉ là danh tính demo
trong khi chưa có Milestone 02 (đăng nhập).

Khi dùng PostgreSQL, đặt `DATABASE_URL` theo `.env.example`, rồi áp migration:

```bash
alembic upgrade head
```

Các API hiện có: `GET/POST /api/v1/projects`, `GET/PATCH /api/v1/projects/{project_id}`.
`PATCH` bắt buộc gửi `expected_revision`; server từ chối cập nhật cũ thay vì ghi đè âm thầm.

## Milestone 02: teacher accounts and project library

Prototype now provides registration, login, logout and revocable opaque browser sessions. Passwords use Argon2id; the session token is only issued in an HttpOnly cookie. Project endpoints always resolve the owner from that session, so one teacher cannot read or change another teacher's project. The local demo includes “Bài giảng của tôi” for opening, copying, archiving and deleting projects.

## Milestone 03: source material and Cloudflare R2

Authenticated teachers can upload TXT, PDF, DOCX and PPTX source materials up to 25 MB. The API validates the type/size, keeps only metadata and normalized extracted text in PostgreSQL, and sends file bytes to the configured S3-compatible object store. Configure `S3_ENDPOINT_URL`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` for Cloudflare R2. Local development uses a system temporary directory as a storage mock and never exposes storage credentials to the browser.

## Milestone 04: personal AI keys and provider adapters

After signing in, open **AI API** in the prototype to save an OpenAI (ChatGPT) or Google Gemini API key. The server encrypts the key before writing it to the database; list and generation responses return only provider metadata and the last four characters. At Task 03, select the provider and one saved key. The browser sends only that credential ID, while the server decrypts the key only for the outbound provider request.

Mock AI remains the no-cost default. Real provider output is requested as JSON, validated against the canonical `Course` Pydantic model and retried once when invalid. Set a unique `CREDENTIAL_ENCRYPTION_KEY` before production; startup refuses the local fallback when `APP_ENV=production`.

## Milestone 05: analysis, storyboard and targeted regeneration

The lesson, review and advanced directions use distinct generation strategies. Each request creates objectives, a slide storyboard and a question bank with more questions than the four initially selected for the final quiz. The application records the provider/model, request ID and token usage when the provider supplies them; no secret is written to this record.

At the teacher-review step, **Tạo lại phần này** replaces only the chosen slide and increments the project revision. The endpoint refuses to overwrite a slide whose status is `approved`, and also rejects stale revisions so changes from another session are not silently lost.

## Milestone 06: course editor

The review step is now the course editor: teachers edit objectives and slide text, choose a reusable layout (`content`, `two_column`, `callout`, `quiz`), set `AI nháp` / `Đã sửa` / `Đã duyệt`, and add, delete, duplicate or reorder slides. Changes are debounced and saved with optimistic revisions. The editor reports a save conflict or network failure while keeping the unsaved values in the current browser session for recovery.

## Milestone 07: quiz bank and deterministic scoring

Teachers can select or unselect AI-generated questions without deleting them, then edit the question, options, answer, explanation, feedback, score, difficulty and linked learning objectives. The canonical `question_bank` persists all these fields. `prototype/quiz_scoring.py` provides deterministic exact-match scoring for single choice, multiple choice, true/false, fill, matching and ordering. Drag/drop and image interaction rendering are intentionally deferred to the player work.

## Milestone 08: HTML5 player

Use **Mở player HTML5** at the build step to preview the authenticated project. The player is rendered directly from canonical `course.json`, and the same `build_course_html` renderer is written to a SCORM export. It provides previous/next controls, progress, optional menu, fullscreen, responsive styling, navigation modes and reusable slide layouts. Authored text is HTML-escaped and JSON inserted into inline scripts escapes tag delimiters, preventing authored content from executing as script.

## Milestone 11: production deployment

The repository now includes `docker-compose.yml`, Caddy HTTPS configuration, explicit Alembic
migrations, health/readiness checks, secret-redacted JSON logs and a daily encrypted PostgreSQL
backup service to a separate Cloudflare R2 bucket. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for
the VPS release procedure and [docs/RESTORE_DRILL.md](docs/RESTORE_DRILL.md) for the required
quarterly recovery drill. This ships the current FastAPI-served prototype UI; a production Next.js
frontend and actual background-job handlers remain separate work.

## Cấu trúc repository thực tế

```text
.github/workflows/validate.yml   CI validation
AGENTS.md                        Quy tắc dành cho Codex/agent
CODEX_START_HERE.md              Điểm bắt đầu cho Codex
TASKS.md                         Backlog + acceptance criteria
STATUS.md                        Trạng thái triển khai thực tế
CONTRIBUTING.md                  Quy trình đóng góp/thay đổi
LICENSE                          Giấy phép hiện tại (bảo lưu quyền)
.env.example                     Mẫu biến môi trường, không chứa secret
requirements.txt                 Dependency để validate/test repo
validate_bundle.py               Validator chạy trước commit

docs/
  API.md                         API contract mục tiêu
  ARCHITECTURE.md                Kiến trúc production
  DATABASE.md                    Data model đề xuất
  DECISIONS.md                   Quyết định kiến trúc/sản phẩm đã chốt
  DEPLOYMENT.md                  VPS + Docker + R2 + backup
  SCORM.md                       SCORM 2004/K12Online contract
  SECURITY.md                    Quy tắc bảo mật
  UX_FLOW.md                     UX flow 8 bước

schemas/course.schema.json       JSON Schema của course.json
examples/course.example.json     Course JSON mẫu hợp lệ
prompts/                         Prompt theo từng milestone
prototype/                       FastAPI web app demo chạy được
tests/test_starter.py            Smoke tests của starter/prototype
```

## Stack production mục tiêu

- Frontend: Next.js + TypeScript
- Backend: FastAPI + Pydantic
- Database: PostgreSQL
- Cache/Queue: Redis
- Object Storage: S3-compatible, ưu tiên Cloudflare R2
- Deployment ban đầu: Docker Compose trên VPS Singapore
- AI: Provider Adapter; API credential thuộc từng giáo viên và được mã hóa phía server

## Nguyên tắc kiến trúc

- `course.json` là **single source of truth**.
- HTML là output render/preview/export, không phải dữ liệu gốc.
- AI tạo nháp; giáo viên duyệt cuối cùng.
- Không đưa API key giáo viên vào frontend, localStorage, source code hay log.
- File lớn không lưu trực tiếp trong PostgreSQL.
- SCORM package phải qua validator trước khi cho tải.
- Chưa tuyên bố tương thích K12Online 100% cho tới khi có test matrix thực tế.

## License

Repository hiện dùng giấy phép bảo lưu quyền trong `LICENSE`. Nếu sau này công khai mã
nguồn, chủ repository cần chủ động chọn và thay bằng giấy phép open-source phù hợp.
