# Hành vi HTML5 player

Player được dựng ở backend từ `course.json` và dùng cùng renderer cho preview
và SCORM ZIP.

- Điều hướng `free`, `sequential`, `restricted` được áp dụng khi chuyển slide
  và chọn từ menu.
- `show_menu` ẩn/hiện menu; `show_progress` ẩn/hiện thanh tiến độ.
- Nếu `completion.require_quiz` bật, việc xem đủ tỷ lệ slide chưa đánh dấu hoàn
  thành cho tới khi học sinh nộp quiz. Trạng thái thành công vẫn dựa riêng vào
  điểm đạt.
- Các tương tác single, multiple, true/false, fill, matching, ordering,
  drag/drop và image đều chấm theo dữ liệu canonical. Matching, ordering và
  drag/drop yêu cầu khớp hoàn toàn.
- CSS chuyển sang bố cục một cột, ẩn menu bên và thu nhỏ vùng điều khiển ở màn
  hình từ 760px trở xuống.
