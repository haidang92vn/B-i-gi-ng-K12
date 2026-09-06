# Migration `course.json` 1.0.0 → 1.1.0

Phiên bản 1.1.0 bổ sung chính sách quiz trong `completion`:

- `max_attempts`: `null` để không giới hạn, hoặc số nguyên từ 1 đến 10;
- `show_feedback`: mặc định `true`;
- `show_correct_answer`: mặc định `false`.

Backend Pydantic và trình nhập local-first vẫn nhận `schema_version: "1.0.0"`.
Khi đọc, hệ thống thêm ba giá trị mặc định trên và nâng dữ liệu trong bộ nhớ lên
`1.1.0`; lần lưu tiếp theo sẽ ghi phiên bản mới. Không cần migration PostgreSQL vì
course canonical được lưu trong cột JSON, nhưng cần sao lưu database trước khi
triển khai như quy trình migration thông thường.

Frontend không tự suy đoán giá trị ngoài các mặc định này. Export/preview luôn
được backend xác thực lại sau migration. File 1.1.0 thiếu một trong ba trường mới
không đạt JSON Schema.
