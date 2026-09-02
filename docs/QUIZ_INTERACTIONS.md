# Tương tác quiz nâng cao

`course.json` vẫn là nguồn dữ liệu chuẩn; player và gói SCORM chỉ được dựng ở
backend từ dữ liệu này.

## Kéo thả

- `type` là `dragdrop`.
- `options` là các thẻ mà học sinh có thể kéo.
- `correct_answer` là mảng JSON chứa thứ tự đúng của các thẻ.
- Player chỉ cho điểm khi toàn bộ thứ tự khớp chính xác, không có điểm ngẫu
  nhiên hoặc điểm từng phần.

## Chọn ảnh

- `type` là `image`.
- `correct_answer` là mã lựa chọn ảnh, ví dụ `img-2`.
- `settings.image_options` là danh sách đối tượng gồm `id`, `asset_id` và
  `label`.
- `asset_id` phải tham chiếu một media `image` của cùng bài giảng. Giáo viên
  tải ảnh ở bước 6 và dùng mã asset hiển thị dưới media trong bước 5.

Khi export, backend đóng gói các asset ảnh được tham chiếu. Nếu thiếu asset
hoặc asset không phải ảnh, export SCORM bị chặn với mã
`QUIZ_IMAGE_ASSET_MISSING`.
