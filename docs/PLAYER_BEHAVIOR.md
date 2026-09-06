# Hành vi HTML5 player

Player được dựng ở backend từ `course.json` và dùng cùng renderer cho preview
và SCORM ZIP.

- Điều hướng `free`, `sequential`, `restricted` được áp dụng khi chuyển slide
  và chọn từ menu.
- `show_menu` ẩn/hiện menu; `show_progress` ẩn/hiện thanh tiến độ.
- `track_score`, `track_completion`, `track_success` lần lượt điều khiển việc gửi
  điểm, tiến độ/trạng thái hoàn thành và trạng thái đạt/chưa đạt về LMS.
- Nếu `completion.require_quiz` bật, việc xem đủ tỷ lệ slide chưa đánh dấu hoàn
  thành cho tới khi học sinh nộp quiz. Trạng thái thành công vẫn dựa riêng vào
  điểm đạt.
- Các tương tác single, multiple, true/false, fill, matching, ordering,
  drag/drop và image đều chấm theo dữ liệu canonical. Matching, ordering và
  drag/drop yêu cầu khớp hoàn toàn.
- Đáp án đang làm, kết quả đã nộp và điểm được lưu trong `cmi.suspend_data` để
  khôi phục khi chuyển slide hoặc mở lại bài. Trước khi LMS kết thúc phiên,
  player ghi ngay phần nhập chưa kịp autosave.
- SCORM 2004 quy định `cmi.suspend_data` có SPM 64.000 ký tự. Player dùng ngân
  sách bảo thủ 60.000 ký tự: khi vượt ngưỡng, nó giữ vị trí, tiến độ, trạng thái
  nộp, điểm và số lượt làm; nén danh sách slide đã xem; rồi chỉ giữ những câu trả
  lời còn vừa dung lượng. Player hiện cảnh báo nếu phải bỏ bớt câu trả lời nháp
  hoặc nếu LMS vẫn từ chối lưu. Cơ chế này giảm mất tiến độ nhưng không thay thế
  kiểm thử thủ công trên tenant K12Online thật. Giới hạn chuẩn được đối chiếu từ
  [ADL SCORM 2004 4th Edition Testing Requirements](https://adlnet.gov/assets/uploads/SCORM_2004_4ED_v1_1_TR_20090814.pdf).
- Sau khi nộp, từng câu hiển thị đúng/chưa đúng, phản hồi và giải thích do giáo
  viên biên soạn. Các trường trả lời được khóa cho tới khi chọn “Làm lại quiz”.
  Lượt làm lại xóa câu trả lời cũ và đưa trạng thái bắt buộc quiz về chưa hoàn
  thành cho tới lần nộp kế tiếp.
- Bước 7 có thể giới hạn 1–10 lượt làm hoặc để không giới hạn. Giáo viên cũng
  quyết định có hiện phản hồi từng câu và có công bố đáp án đúng sau khi nộp hay
  không. Khi hết lượt, player giữ kết quả cuối và ẩn nút làm lại.
- Khi nộp quiz trong LMS, player thêm từng câu vào mảng chuẩn
  `cmi.interactions.n`: ID chứa course/câu/lần làm, loại tương tác, thời điểm,
  mô tả câu hỏi, câu trả lời, kết quả đúng–sai và latency. Single/multiple/image
  dùng `choice`; true/false dùng `true-false`; điền khuyết dùng `fill-in`;
  ghép cặp dùng `matching`; ordering và drag/drop dùng `sequencing`. Mỗi lần làm
  lại được nối tiếp thay vì ghi đè lần trước. Nếu LMS không hỗ trợ mảng interaction,
  player dừng gửi analytics nhưng vẫn lưu điểm, completion và success bình thường.
  Khả năng K12Online hiển thị các trường này vẫn cần xác minh trên tenant thật.
- CSS chuyển sang bố cục một cột, ẩn menu bên và thu nhỏ vùng điều khiển ở màn
  hình từ 760px trở xuống.
