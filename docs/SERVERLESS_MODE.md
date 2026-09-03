# Serverless mode — tạo và tải SCORM không lưu dự án

## Mục tiêu đã chốt

Chế độ này dành cho nhu cầu đơn giản: giáo viên tạo bài, tự duyệt, tải ZIP
SCORM rồi tự upload vào K12Online. Hệ thống **không** lưu thư viện bài giảng,
tài khoản trường, phân quyền, lịch sử xuất, analytics hay media vào cơ sở dữ
liệu lâu dài.

`course.json` vẫn là nguồn dữ liệu chuẩn. Trong chế độ này, trình duyệt lưu bản
nháp cục bộ theo phiên để giáo viên đi qua đủ 8 bước; FastAPI chỉ nhận dữ liệu
đã kiểm tra để tạo nháp AI, xem trước, kiểm tra chất lượng và trả ZIP SCORM.
Không lưu HTML sinh ra làm dữ liệu nguồn.

Giáo viên có thể tải `course.json` ở Bước 8 và dùng **Nhập course.json** để
tiếp tục trên cùng hoặc một thiết bị khác. Tệp nhập tối đa 1 MB, được kiểm tra
trong trình duyệt trước khi thay thế bản nháp cục bộ và vẫn được FastAPI kiểm
tra lại trước khi xem trước/đóng gói. Bản sao chỉ mang `course.json`; nội dung
nguồn ban đầu được tái tạo từ slide và media không thể được khôi phục ở chế độ
không có storage.

## Kiến trúc

```text
Trình duyệt
  └─ course.json tạm trong local storage
       ├─ FastAPI serverless: tạo nội dung AI / kiểm tra / render / ZIP SCORM
       └─ tải ZIP trực tiếp về máy giáo viên
Vercel Functions
  └─ không có PostgreSQL, Redis, R2 hoặc trạng thái dự án lâu dài
```

- Frontend Vercel giữ cùng hostname và chuyển tiếp `/api/*` sang Vercel project
  FastAPI riêng, nên browser không gọi API khác origin trực tiếp.
- ChatGPT và Gemini chỉ được gọi từ FastAPI. Khóa dùng chung của trường nằm ở
  Vercel Environment Variables, không trả về browser, local storage hoặc log.
- Không dùng đăng nhập Google ở serverless mode vì không có tài khoản cần lưu.
  Đây là phiên soạn tạm; xóa dữ liệu trình duyệt sẽ xóa bản nháp.
- File nguồn chỉ hỗ trợ văn bản ngắn. Media/TTS, video, tải file lớn, nguồn PDF/
  DOCX/PPTX và lịch sử export giữ ngoài serverless mode cho đến khi có storage.

## AI trong serverless mode

Mock AI luôn sẵn sàng để thử toàn bộ 8 bước mà không gửi nội dung ra bên ngoài.
Giao diện cũng hiển thị ChatGPT và Gemini, nhưng tự khóa chúng cho đến khi biến
`OPENAI_API_KEY` hoặc `GEMINI_API_KEY` tương ứng được tạo trong **Vercel project
`serverless`**. Endpoint trạng thái chỉ trả về `available` và tên model, không
bao giờ trả khóa. Mẫu tên biến và model mặc định có ở
[`serverless/.env.example`](../serverless/.env.example).

Sau khi người quản trị đặt biến trên Vercel, cần redeploy project `serverless`
và thử tạo một bài bằng từng provider. Không gửi khóa vào chat, không đặt khóa
ở frontend/Vercel project `frontend`, và không dùng tiền tố `NEXT_PUBLIC_`.

## Giới hạn bắt buộc

Vercel Functions giới hạn cả request và response ở 4,5 MB. Vì ZIP SCORM được
trả trực tiếp, UI sẽ giới hạn gói ở 4 MB và không cho dùng video hay media nhúng
trong bản serverless. Vercel Hobby có tối đa 2 GB RAM và 300 giây cho một lần
gọi; đây phù hợp cho bài chữ/ảnh nhẹ và không phải nền tảng lưu trữ trường học
lâu dài.

Nguồn chính thức:

- [Vercel Functions limits](https://vercel.com/docs/functions/limitations)
- [Python runtime on Vercel](https://vercel.com/docs/functions/runtimes/python)

## Lộ trình triển khai

1. [x] Tách lõi FastAPI thuần (Pydantic `Course`, Mock adapter, quality check,
   player renderer và SCORM ZIP validator) khỏi DB/R2/session.
2. [x] Cung cấp bốn API stateless: tạo nháp AI, render player, quality check và
   export ZIP. Mọi API nhận `course.json` đã validate và không ghi dữ liệu dự án.
3. [x] Thêm giao diện local-first cho 8 bước Next.js: một bản nháp và `course.json`
   chỉ sống trong trình duyệt. Giáo viên có thể tải bản sao `course.json`; không có
   lịch sử ZIP ở chế độ này.
4. [x] Tạo Vercel project FastAPI riêng và nối frontend qua proxy cùng domain.
   Đã kiểm thử một ZIP Mock nhỏ thật; API không cần khóa AI khi đang dùng Mock.
5. [ ] Bật ChatGPT/Gemini bằng khóa chỉ có ở Vercel và kiểm thử từng provider
   bằng một bài mẫu. (Đợi người quản trị cấu hình khóa.)

## Điều không tuyên bố

Validator serverless chỉ xác nhận cấu trúc SCORM 2004 và các quy tắc kỹ thuật
của project. Mỗi trường vẫn phải upload thử ZIP lên tenant K12Online trước khi
giao học sinh.
