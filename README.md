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

## Chạy frontend Next.js đang chuyển đổi

Giữ FastAPI chạy ở cổng `8000`, sau đó mở terminal thứ hai:

```powershell
cd frontend
pnpm install
pnpm dev
```

Mở `http://127.0.0.1:3000`. Frontend chuyển tiếp cùng nguồn các yêu cầu `/api/*` đến FastAPI,
vì vậy cookie phiên HttpOnly không cần đưa vào JavaScript. Hiện phần đăng nhập, khung 8 bước,
Bước 1 lưu/khôi phục học liệu, Bước 2 lưu định hướng, Bước 3 tạo nội dung AI vào đúng dự án đã có,
Bước 4 cho giáo viên duyệt/chỉnh sửa và Bước 5 biên tập ngân hàng câu hỏi với autosave;
màn hình prototype vẫn là
phương án sử dụng ổn định cho các bước chưa được chuyển đổi.
Xem [docs/FRONTEND_MIGRATION.md](docs/FRONTEND_MIGRATION.md).

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

Teachers can select or unselect AI-generated questions without deleting them, then edit the question, options, answer, explanation, feedback, score, difficulty and linked learning objectives. The canonical `question_bank` persists all these fields. `prototype/quiz_scoring.py` provides deterministic exact-match scoring, while the player renders single choice, multiple choice, true/false, fill, matching, ordering, drag/drop and asset-backed image interactions.

## Milestone 08: HTML5 player

Use **Mở player HTML5** at the build step to preview the authenticated project. The player is rendered directly from canonical `course.json`, and the same `build_course_html` renderer is written to a SCORM export. It provides previous/next controls, progress, optional menu, fullscreen, responsive styling, navigation modes and reusable slide layouts. Authored text is HTML-escaped and JSON inserted into inline scripts escapes tag delimiters, preventing authored content from executing as script.

The Next.js Step 6 screen embeds this backend renderer and provides the complete per-slide media
workflow: AI image/TTS drafts, validated teacher uploads, approved public HTTPS URLs, preview, and
explicit attachment. Attaching advances the canonical revision and stores only the asset reference;
generated HTML remains transient output.

The Next.js Step 7 screen saves navigation, completion and SCORM runtime switches into the same
canonical course. K12Online restores the documented defaults; individual changes become a custom
preset. Player preview and project export now use these saved values, including progress visibility
and independent score/completion/success tracking.

The Next.js Step 8 screen keeps export authoritative on FastAPI: it shows deterministic,
non-blocking authoring-quality guidance for the saved `course.json`, then requests a package by
project ID. FastAPI rebuilds from canonical data, validates the SCORM file map and ZIP before
recording/exporting it. The browser immediately receives the successful ZIP and shows only the
current project's export metadata history. This technical gate does not certify real K12Online
interoperability; use the manual tenant test checklist before release.

## Milestone 11: production deployment

The repository now includes `docker-compose.yml`, Caddy HTTPS configuration, explicit Alembic
migrations, health/readiness checks, secret-redacted JSON logs and a daily encrypted PostgreSQL
backup service to a separate Cloudflare R2 bucket. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for
the VPS release procedure and [docs/RESTORE_DRILL.md](docs/RESTORE_DRILL.md) for the required
quarterly recovery drill. This ships the current FastAPI-served prototype UI. The Next.js
migration has started with authentication and the eight-step shell; remaining workflow screens
and actual background-job handlers remain separate work.

## Milestone 12.1: quality checks

At the export step, Kiểm tra chất lượng saves the current draft and returns non-blocking,
deterministic review guidance for AI-draft slides, text density, question structure, answers,
duplicate items and learning-objective links. It does not spend AI-provider tokens and does not
replace teacher subject-matter review or the technical SCORM validator. See
[docs/QUALITY_CHECKS.md](docs/QUALITY_CHECKS.md).

## Milestone 12.2: school teams and sharing

For a school with around 80 teachers, each person keeps an individual account and a school
administrator explicitly creates the school team, then adds already registered teachers by email.
The owner can share a lesson only with a teacher in a common school, choosing **Chỉ xem** or
**Có thể chỉnh sửa**. Viewers can preview, quality-check and export a SCORM copy but cannot alter
the lesson or upload source files. See [docs/TEAMS.md](docs/TEAMS.md).

## Milestone 12.3: shared question library

In **Câu hỏi chung**, a teacher can turn an edited AI-generated question from the currently open
lesson into a school-library draft, with subject, grade, topic and learning objectives. The
teacher submits it; a school administrator must publish it before members can add a copied,
editable version to their own lesson. Reviewer attribution is retained. See
[docs/SHARED_QUESTION_LIBRARY.md](docs/SHARED_QUESTION_LIBRARY.md).

## Milestone 12.4: media and TTS

At **Dựng bài giảng HTML5**, a teacher can generate an image or per-slide voice preview,
upload a permitted media file, or add an approved public HTTPS URL. The asset remains a preview
until the teacher explicitly attaches it to a slide. Uploaded/generated media goes to the
R2-compatible object store and is packaged under `assets/` during SCORM export; external URLs
remain external. File type/signature/size checks, rights confirmation and video ZIP warnings are
included. See [docs/MEDIA_TTS.md](docs/MEDIA_TTS.md).

## Milestone 12.5: K12Online analytics (report import)

K12Online public guidance documents report export, but no public analytics API/webhook contract.
The demo therefore imports a bounded CSV UTF-8 or XLSX report only through a school administrator.
It never retains report bytes or original learner identifiers: identifiers are HMAC-pseudonymized
before normalized storage, and teachers see school/lesson aggregates only. The initial suggestions
are deterministic and non-binding; no AI provider receives learner data. See
[docs/ANALYTICS.md](docs/ANALYTICS.md) and [docs/K12ONLINE_ANALYTICS_DISCOVERY.md](docs/K12ONLINE_ANALYTICS_DISCOVERY.md).

## First production school: Trường Tiểu học Trần Quốc Toản

The repository includes a one-shot, idempotent provisioning service for the first school admin.
It runs only after PostgreSQL migration, reads the initial password from an ephemeral environment
variable, and never logs or resets a pre-existing password. Follow
[docs/ONBOARDING_TRAN_QUOC_TOAN.md](docs/ONBOARDING_TRAN_QUOC_TOAN.md) on the approved VPS.

## Google sign-in

The login screen supports an optional **Đăng nhập với Google** flow. It signs in/registers users
from a backend-verified Google identity; it does not accept a Gmail password. The first verified
administrator can be bootstrap-configured only in VPS environment variables. See
[docs/GOOGLE_SIGN_IN.md](docs/GOOGLE_SIGN_IN.md).

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
  ANALYTICS.md                   K12Online report import + privacy contract
  ONBOARDING_TRAN_QUOC_TOAN.md   Runbook trường đầu tiên
  SCORM.md                       SCORM 2004/K12Online contract
  SECURITY.md                    Quy tắc bảo mật
  UX_FLOW.md                     UX flow 8 bước

schemas/course.schema.json       JSON Schema của course.json
examples/course.example.json     Course JSON mẫu hợp lệ
prompts/                         Prompt theo từng milestone
prototype/                       FastAPI web app demo chạy được
frontend/                        Next.js + TypeScript migration (incremental)
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
