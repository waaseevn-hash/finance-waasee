# Hướng dẫn sử dụng & quản trị

## 1. Cài lên điện thoại / máy tính

| Thiết bị | Cách cài |
|---|---|
| Android (Chrome) | Mở link app → bấm ⋮ → **Cài đặt ứng dụng** (hoặc **Thêm vào màn hình chính**) |
| iPhone / iPad (Safari) | Mở link bằng **Safari** → **Chia sẻ** → **Thêm vào MH chính**. Nếu có công tắc **Mở dưới dạng ứng dụng web** thì **tắt** (đăng nhập Google của Apple không chạy trong chế độ đó) |
| Máy tính (Chrome / Edge) | Mở link → bấm biểu tượng **Cài đặt** ở cuối thanh địa chỉ |

Mỗi thiết bị đăng nhập Google một lần, các lần sau mở thẳng vào app.

## 2. Thêm kế toán / đồng quản trị

Chủ doanh nghiệp vào **Phân quyền & Nhật ký → Thành viên & phân quyền → Thêm thành viên**: nhập Gmail, chọn vai trò **Kế toán công nợ** hoặc **Đồng quản trị**, bấm **Cấp quyền**. Gửi người đó link app, họ đăng nhập bằng đúng Gmail đó.

- Đổi vai trò, **Khóa** (đóng màn hình ngay lập tức) hoặc **Xóa** ngay trong danh sách thành viên.
- Quyền được kiểm tra trên máy chủ Firebase: kế toán không đọc được két tiền mặt, ngân hàng, điều phối tháng kể cả khi dùng công cụ lập trình.

| Vai trò | Thấy và làm được |
|---|---|
| Chủ doanh nghiệp | Toàn bộ, duyệt chi, phân quyền, nhật ký |
| Đồng quản trị | Tiền mặt, vay ngân hàng, công nợ, duyệt chi, danh bạ NCC, điều phối tháng |
| Kế toán công nợ | Phải thu / phải trả, lệnh chi đã duyệt → đã chuyển tiền, danh bạ NCC (không xóa công nợ) |

## 3. Chuyển dữ liệu từ bản claude.ai (làm một lần)

1. Mở bản cũ trên claude.ai → **Phân quyền & Nhật ký** → **Tải bản sao lưu dữ liệu** (file `.json`).
2. Mở app mới bằng Gmail Chủ doanh nghiệp → **Phân quyền & Nhật ký** → khung **Chuyển dữ liệu từ bản claude.ai** → chọn file → **Nhập dữ liệu**.
3. Nhập lại nhiều lần vẫn an toàn: bản ghi đã có được bỏ qua. Nhật ký cũ xem ở tab Nhật ký → chọn **Nhật ký cũ (bản claude.ai)**.

Sau khi chuyển xong, ngừng nhập liệu ở bản claude.ai để tránh hai nơi lệch nhau.

## 4. Thiết lập Firebase (đã làm khi triển khai)

1. Authentication → Sign-in method → **Google**: Enable.
2. Authentication → Settings → Authorized domains: thêm `waaseevn-hash.github.io`.
3. Firestore Database (asia-southeast1, production mode).
4. Firestore Database → **Rules**: dán toàn bộ nội dung file `firestore.rules` → **Publish**. Mỗi khi file này thay đổi phải dán lại.
5. Cấu hình web app nằm trong `src/firebase-config.js`. Gmail Chủ doanh nghiệp nằm ở `OWNER_EMAIL` (file này) và `ownerEmail()` (file `firestore.rules`) — hai chỗ phải trùng nhau.

Gói miễn phí (Spark) của Firebase đủ cho doanh nghiệp nhỏ: 50.000 lượt đọc và 20.000 lượt ghi mỗi ngày.

## 5. Cập nhật app

Đẩy code mới lên nhánh `main` → GitHub Actions tự kiểm thử và đưa lên GitHub Pages sau khoảng 1–2 phút. Người dùng tải lại trang (hoặc mở lại app) là có bản mới.
