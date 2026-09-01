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
cd prototype
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Mở `http://127.0.0.1:8000`.

Prototype hiện hỗ trợ mock AI, duyệt nội dung, chọn dạng Quiz, preview và tạo gói SCORM
2004 cơ bản. Chi tiết những gì chưa có xem `STATUS.md`.

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
