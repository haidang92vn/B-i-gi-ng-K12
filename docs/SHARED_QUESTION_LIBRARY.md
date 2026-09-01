# Thư viện câu hỏi chung theo trường

Milestone 12.3 cho phép giáo viên tái sử dụng câu hỏi đã được kiểm duyệt trong cùng nhóm
trường. Câu hỏi được lưu tách khỏi `course.json`; khi dùng, hệ thống sao chép một phiên bản
mới vào `question_bank` của bài giảng hiện tại. Vì vậy giáo viên vẫn có thể sửa câu hỏi trong
bài riêng mà không làm thay đổi bản thư viện.

## Quy trình

1. Giáo viên chỉnh sửa một câu do AI tạo trong ngân hàng câu hỏi của bài giảng.
2. Chọn nhóm trường, nhập môn, lớp, chủ đề và ít nhất một mục tiêu học tập để lưu **nháp**.
3. Giáo viên gửi nháp để duyệt.
4. `school_admin` công bố hoặc từ chối. Hệ thống lưu người duyệt và thời điểm duyệt.
5. Thành viên cùng trường chỉ nhìn thấy và dùng các câu **đã công bố**; người gửi nhìn thấy
   cả nháp/câu bị từ chối của chính mình.

## Dữ liệu lưu kèm

- Môn, lớp, chủ đề và mục tiêu học tập dạng văn bản.
- Dạng câu hỏi, nội dung, lựa chọn, đáp án, độ khó, điểm gợi ý và phản hồi.
- Trạng thái duyệt, người gửi, người duyệt, thời gian duyệt.

## Phân quyền

- Thành viên trường có thể tạo nháp từ bài giảng mà họ có quyền chỉnh sửa.
- Chỉ chủ nháp được gửi lại nháp hoặc câu bị từ chối.
- Chỉ một quản trị trường khác người gửi được công bố/từ chối.
- Chỉ câu đã công bố mới có thể được thêm vào bài giảng; thao tác thêm dùng revision hiện tại
  để tránh ghi đè thay đổi ở tab khác.

AI tạo câu hỏi là dữ liệu khởi tạo, không phải phê duyệt chuyên môn. Quản trị trường và giáo
viên vẫn cần kiểm tra độ chính xác, bản quyền nguồn và mức độ phù hợp với học sinh trước khi
công bố.
