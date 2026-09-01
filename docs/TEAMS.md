# Tài khoản trường/nhóm và phân quyền

Milestone 12.2 bổ sung mô hình nhóm trường phù hợp cho khoảng 80 giáo viên. Mỗi giáo viên
đăng ký tài khoản riêng. Người tạo một nhóm trường trở thành **quản trị trường** và có thể
thêm các tài khoản giáo viên đã đăng ký vào nhóm đó.

Không tự động ghép giáo viên theo trường văn bản trong hồ sơ; điều này tránh việc một người
tự nhận cùng trường để nhận quyền truy cập.

## Vai trò nhóm trường

- `school_admin`: tạo và quản lý thành viên của nhóm trường; không thể gỡ quản trị cuối cùng.
- `teacher`: thuộc nhóm và có thể nhận/chia sẻ bài giảng theo quyền được cấp.

## Quyền bài giảng

- `owner`: toàn quyền với bài giảng của mình, gồm chia sẻ, lưu trữ và xóa.
- `editor`: xem, sửa, tải học liệu và tạo lại nội dung; không thể chia sẻ, lưu trữ hoặc xóa.
- `viewer`: chỉ xem, mở player, chạy kiểm tra chất lượng và xuất bản sao SCORM; giao diện
  khóa các trường chỉnh sửa.

Chủ sở hữu chỉ có thể chia sẻ cho một giáo viên đã đăng ký và có ít nhất một nhóm trường
chung. Chia sẻ được cấp trực tiếp theo từng bài giảng, không làm người nhận thành chủ sở hữu.
Nếu giáo viên bị gỡ khỏi tất cả nhóm chung, quyền chia sẻ đó không còn hiệu lực ngay.

## Vận hành cho 80 giáo viên

1. Giáo viên tự đăng ký tài khoản.
2. Quản trị trường tạo nhóm trong nút **Nhóm trường** và thêm email của giáo viên.
3. Chủ bài giảng mở **Bài giảng của tôi** → **Chia sẻ**, nhập email và chọn quyền chỉnh sửa
   hoặc chỉ xem.
4. Mỗi giáo viên vẫn chịu trách nhiệm với API key AI cá nhân; quyền nhóm không cho phép xem
   hay sử dụng API key của người khác.

Trong production cần bổ sung audit event cho thao tác thêm/gỡ thành viên và cấp/thu hồi quyền,
cũng như giao diện mời qua email nếu trường yêu cầu quy trình duyệt lời mời.
