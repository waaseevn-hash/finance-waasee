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

## 6. Chứng từ thu chi nội bộ (mẫu Thông tư 200)

Menu **Chứng từ thu chi**. Bốn loại: Giấy đề nghị tạm ứng (03-TT), Giấy đề nghị thanh toán (05-TT, có bảng kê chi phí và quyết toán tạm ứng), Phiếu thu (01-TT), Phiếu chi (02-TT).

Quy trình: **Nháp → Chờ duyệt → Đã duyệt (chờ kết xuất) → Đã kết chuyển**, hoặc **Từ chối** kèm lý do.

- Ai cũng lập được chứng từ. Kế toán (STAFF) chỉ thấy chứng từ do mình lập.
- Chủ DN / Đồng quản trị duyệt, từ chối, kết chuyển. Khi duyệt, chứng từ được cấp số (PT-YYYYMM-XXX, PC-YYYYMM-XXX, TU-…, TT-…).
- Thẻ **Kết xuất & kết chuyển**: tick chứng từ đã duyệt → **Kết xuất in phiếu & kết chuyển**. Một thao tác duy nhất sẽ:
  1. tạo đợt KC-YYYYMMDD-NN;
  2. tự lập phiếu chi tạm ứng, phiếu thu hoàn ứng (chi không hết) hoặc phiếu chi bổ sung (chi quá tạm ứng);
  3. ghi Sổ quỹ tiền mặt, khóa chứng từ;
  4. mở bản in A4 hoặc 2 liên A5, tải được PDF và Excel bảng kê.
- Bấm hai lần hoặc hai người cùng bấm không ghi trùng: chứng từ đã kết chuyển bị từ chối ngay trong giao dịch.
- Sai sót sau kết chuyển: chỉ **Chủ DN** dùng **Hủy kết chuyển**. Hệ thống ghi bút toán đảo (không xóa), hủy phiếu tự động, trả chứng từ về “Đã duyệt”.
- Thông tin in trên phiếu (tên công ty, địa chỉ, MST, Giám đốc, Kế toán trưởng, Thủ quỹ, quyển số) sửa ở **Quản trị → Thông tin doanh nghiệp**.
- Ảnh hóa đơn được nén và lưu cùng chứng từ (tối đa 12 ảnh, PDF dưới 700KB).

## 7. Bảng điều phối tháng (bố cục 3 tầng)

- **Thanh trên cùng (luôn hiện khi cuộn):** Nguồn tiền khả dụng · Tổng dự chi · Số dư sau chi (đỏ kèm số cần rút hạn mức nếu thiếu) · Chốt kế hoạch · Xuất PDF / Excel.
- **Nguồn tiền vào (thu gọn được):** tiền mặt trong két (quỹ dự phòng, cộng tiền gửi NH); phải thu tháng này (mở danh sách để tick); hạn mức vay còn trống (công tắc “Tính gộp vào nguồn khả dụng”).
- **Bảng ưu tiên:** lọc Tất cả / Đang chọn chi / Nhóm P1 / Đáo hạn NH / Chi nội bộ. Ba nhóm P1–P3 có tạm tính riêng; kéo ⋮⋮ để đổi thứ tự trong nhóm. Ô “Dự chi đợt này” có nút nhanh 50% / 100%. Nút mở ngăn bên phải để xem ghi chú, lịch sử thanh toán, duyệt chi, danh sách chứng từ nội bộ.
- Chứng từ nội bộ đã duyệt (chưa kết chuyển) được gộp thành **một dòng P1 “Chi tiêu nội bộ đã duyệt”**. Phần đã kết chuyển đã trừ vào tồn két nên không cộng lại.
