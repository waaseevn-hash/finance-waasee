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
| Đồng quản trị | Tiền mặt, vay ngân hàng, công nợ, duyệt chi, danh bạ NCC, điều phối tháng, chứng từ, phân quyền thành viên (trừ tài khoản Chủ DN), nhật ký thao tác |
| Kế toán công nợ | Phải thu / phải trả (thêm, sửa, xóa khoản công nợ), lệnh chi đã duyệt → đã chuyển tiền, danh bạ NCC; không xóa lẻ lần thanh toán, không xóa NCC |

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

## 6. Đề xuất & Duyệt chi (chứng từ nội bộ mẫu Thông tư 200)

Menu **Đề xuất & Duyệt chi** (Chủ DN, Đồng quản trị) — với kế toán là **Đề xuất chi & Chứng từ**. Bốn loại: Giấy đề nghị tạm ứng (03-TT), Giấy đề nghị thanh toán (05-TT, có bảng kê chi phí và quyết toán tạm ứng), Phiếu thu (01-TT), Phiếu chi (02-TT).

Quy trình: **Nháp → Chờ duyệt → Đã duyệt (kế toán chi tiền, báo “Đã chi”) → Đã chốt sổ**, hoặc **Từ chối** kèm lý do.

**Phân việc:** ai cũng lập được đề xuất. Sếp (Chủ DN / Đồng quản trị) duyệt, sửa số duyệt, từ chối. Kế toán chi tiền theo số Sếp chốt, bấm **Đã chi tiền**, rồi **chốt sổ & in phiếu**. Chỉ Chủ DN hủy chốt sổ.

- Màn hình của Sếp không hiện số hiệu tài khoản, Nợ/Có, quyển số (chỉ hiện tên khoản chi). Kế toán vẫn thấy đầy đủ.
- Khi duyệt, chứng từ được cấp số (PT-YYYYMM-XXX, PC-YYYYMM-XXX, TU-…, TT-…).
- **Duyệt toàn bộ hoặc một phần:** “Duyệt toàn bộ” hoặc “Duyệt một phần” rồi nhập số được duyệt (có nút 25% / 50% / 75%) và lý do. Phiếu chi tự động, quyết toán tạm ứng và bản in đều theo số được duyệt; bản in ghi cả số đề nghị và số được duyệt. Phiếu thu chỉ duyệt toàn bộ.
- Thẻ **Chuyển kế toán chi & Chốt sổ** (Sếp) / **Chốt sổ & in phiếu** (kế toán): tick chứng từ đã duyệt → **Chốt sổ & in phiếu**. Một thao tác duy nhất sẽ:
  1. tạo đợt KC-YYYYMMDD-NN;
  2. tự lập phiếu chi tạm ứng, phiếu thu hoàn ứng (chi không hết) hoặc phiếu chi bổ sung (chi quá tạm ứng);
  3. ghi Sổ quỹ tiền mặt (TK 111) và tiền gửi ngân hàng (TK 112), khóa chứng từ;
  4. mở bản in A4 hoặc 2 liên A5, tải được PDF và Excel bảng kê.
- Kế toán không xem được sổ quỹ và số dư tiền gửi: khi chốt sổ khoản chuyển khoản, kế toán chọn tài khoản công ty trong danh sách (tên + số tài khoản, không có số dư); app tự cộng / trừ đúng số của đợt. Nếu số dư trên app không đủ, hệ thống từ chối — Sếp cập nhật số dư theo sao kê.
- Bấm hai lần hoặc hai người cùng bấm không ghi trùng: chứng từ đã chốt sổ bị từ chối ngay trong giao dịch.
- Sai sót sau chốt sổ: chỉ **Chủ DN** dùng **Hủy chốt sổ**. Hệ thống ghi bút toán đảo (không xóa), hủy phiếu tự động, trả chứng từ về “Đã duyệt”.

### 6a. Chuông thông báo & Duyệt nhanh (Sếp)

- Chuông trên thanh trên cùng có **số đỏ** = số khoản đang chờ duyệt: đề xuất chi nội bộ và công nợ nhà cung cấp đến hạn trong tháng (kể cả quá hạn) chưa có lệnh duyệt chi.
- Bấm chuông mở **ngăn Duyệt nhanh** ngay trên màn hình đang xem. Đầu ngăn: Tổng tiền đang có · Chờ duyệt · Còn lại nếu duyệt hết. Mỗi khoản: ai đề xuất, nội dung, số tiền, ảnh chứng từ (bấm để phóng to) và **“Duyệt khoản này xong còn lại: X đ”** (tính dồn từ trên xuống).
- Ba nút: **Duyệt** (toàn bộ) · **Sửa số duyệt** (duyệt một phần) · **Từ chối** (bắt buộc lý do). Với công nợ nhà cung cấp, nút thứ ba là **Hoãn**: khoản nợ vẫn còn, chỉ ẩn khỏi danh sách chờ duyệt đến đầu tháng sau.
- Trang **Tổng quan** có khối **Khoản chờ duyệt ngay** (4 khoản đầu, cùng ba nút).
- Thẻ **Tổng tiền đang có (Khả dụng chi)** = tiền mặt + tiền gửi. Bấm vào để xem chi tiết: két công ty, từng người giữ tiền, từng tài khoản ngân hàng.

### 6b. Việc cần làm (kế toán)

Kế toán đăng nhập vào thẳng **Việc cần làm**, gồm 3 hàng đợi theo đúng trình tự, mỗi hàng có dòng **Quy trình** thu gọn được:

1. **Cần lập & Gửi duyệt** — nút lập nhanh 4 loại chứng từ; danh sách khoản bị Sếp từ chối (kèm lý do), nháp chưa gửi, khoản đang chờ Sếp.
2. **Sếp đã duyệt — Cần chi ngay** — chia nhóm Chuyển khoản / Tiền mặt, có tài khoản người nhận và **số Sếp duyệt** (kèm số đề nghị nếu duyệt một phần). Chi xong bấm **Đã chi** (đề xuất nội bộ: chọn ngày chi, hình thức, tài khoản người nhận; công nợ NCC: ghi thanh toán vào công nợ).
3. **Sổ chi tiết & Lưu chứng từ** — khoản đã chi chờ chốt sổ (cột Sổ ghi 111 / 112) → **Chốt sổ & in phiếu**; bảng các lần chốt sổ gần đây có nút in lại.

Chuông của kế toán báo khoản Sếp vừa duyệt và khoản bị từ chối (kèm lý do); số đỏ là số tin chưa xem.

### 6c. Thông báo đẩy về điện thoại

**Phân quyền & Cài đặt → Thông báo đẩy** (chỉ Chủ DN):

1. Telegram → @BotFather → `/newbot` → lấy **Bot Token**. Bot này chỉ dùng để báo tin (mọi thành viên app đọc được token để gửi tin khi thao tác).
2. Tạo nhóm “Duyệt chi” (Sếp, Đồng quản trị) và thêm bot; muốn kế toán nhận riêng thì tạo thêm nhóm kế toán có bot. Gửi một tin bất kỳ vào nhóm.
3. Bấm **Tìm Chat ID** → chọn “Nhóm Sếp” / “Nhóm kế toán”.
4. **Gửi thử thông báo** → thấy tin trong nhóm thì bật “Đang dùng thông báo đẩy” → **Lưu cấu hình**.

Tin nhắn có link mở thẳng ngăn Duyệt nhanh (Sếp) hoặc danh sách cần chi (kế toán). Có thể thêm Webhook (Zapier, Make, Apps Script) để nhận dữ liệu từng sự kiện. Ngoài Telegram, mỗi máy có thể bật **thông báo của trình duyệt** (nút “Bật” trong chuông) — báo khi app đang mở hoặc đã cài lên màn hình chính, kèm số trên biểu tượng app.

- **Hình thức thanh toán:** mỗi chứng từ chọn **Tiền mặt** hoặc **Chuyển khoản**. Chuyển khoản thì nhập tài khoản người nhận (chủ TK, số TK, ngân hàng, chi nhánh, MST) — gõ tên đã có trong danh bạ nhà cung cấp hoặc chứng từ trước, app tự điền. Khi chốt sổ chọn **tài khoản ngân hàng của công ty** (khai số tài khoản ở Vay & Hạn mức NH → sửa ngân hàng); khoản chuyển khoản ghi Có/Nợ 1121, không vào sổ quỹ tiền mặt, và số dư tiền gửi trên app tự trừ / cộng. Hủy chốt sổ trả lại số dư.
- Thu chi của đợt và các số liệu "khả dụng / cần chi" tính **cả tiền mặt và tiền gửi ngân hàng** (dòng tiền), có tách riêng từng loại.
- **Bản in:** phông chữ nhúng sẵn (giống Times New Roman, đủ dấu tiếng Việt) nên PDF trên điện thoại và máy tính giống nhau. Đợt chốt sổ in: bảng kê đợt (111 và 112, số dư trước / sau), **bảng kê lệnh chuyển khoản** (người thụ hưởng, số TK, ngân hàng, số tiền, nội dung CK không dấu — đưa kế toán đi lệnh), rồi từng chứng từ. Nút "Lệnh chuyển khoản" để in riêng bảng này; file Excel có thêm sheet "Lệnh chuyển khoản".
- Trong màn xem trước bản in, bấm **Thông tin in** để sửa tên đơn vị, địa chỉ, MST, Giám đốc, Kế toán trưởng, Thủ quỹ, người lập phiếu và người nộp / nhận / đề nghị của từng chứng từ trước khi in. Người lập phiếu tự điền theo tên thành viên. Bấm "Lưu thông tin đơn vị cho lần sau" để lần sau tự điền (cũng sửa được ở **Quản trị → Thông tin doanh nghiệp**).
- Ảnh hóa đơn được nén và lưu cùng chứng từ (tối đa 12 ảnh, PDF dưới 700KB).

## 7. Tiền mặt và tiền gửi ngân hàng

Menu **Tiền mặt và tiền gửi ngân hàng** (Chủ DN, Đồng quản trị).

- **Người giữ tiền:** ngoài Két công ty, thêm 1–2 người đang cầm tiền mặt của công ty bằng ô “Thêm người giữ tiền” (sửa tên, bỏ người không còn giữ — chỉ bỏ được khi người đó đã bàn giao hết tiền).
- Mỗi phiếu thu / chi chọn tiền vào / ra ở đâu (mặc định Két). Số tiền từng người giữ tự tính từ phiếu; cộng lại bằng tồn quỹ tiền mặt.
- **Bàn giao tiền:** chuyển tiền giữa két và người giữ. Tổng tiền mặt không đổi, không tính vào thu / chi trong tháng. Sửa hoặc xóa một lần bàn giao thì sửa / xóa cả hai bên.
- Bấm thẻ một người giữ để xem sổ quỹ riêng của người đó; **Kiểm kê quỹ** chọn kiểm kê két hay từng người.
- **Các khoản cần duyệt chi:** chứng từ nội bộ chờ duyệt (nút Duyệt — toàn bộ hoặc một phần; dưới mỗi khoản có số tiền mặt còn lại nếu duyệt lần lượt) và công nợ phải trả chưa duyệt chi (nút Duyệt chi; lọc “Đến hạn tháng này” / “Tất cả”).
- **Tiền gửi ngân hàng:** số dư từng tài khoản, bấm “Cập nhật” để sửa theo sao kê.

## 8. Bảng điều phối tháng (bố cục 3 tầng)

- **Thanh trên cùng (luôn hiện khi cuộn):** Nguồn tiền khả dụng · Tổng dự chi · Số dư sau chi (đỏ kèm số cần rút hạn mức nếu thiếu) · Chốt kế hoạch · Xuất PDF / Excel.
- **Nguồn tiền vào (thu gọn được):** tiền mặt trong két (quỹ dự phòng, cộng tiền gửi NH); phải thu tháng này (mở danh sách để tick); hạn mức vay còn trống (công tắc “Tính gộp vào nguồn khả dụng”).
- **Bảng ưu tiên:** lọc Tất cả / Đang chọn chi / Nhóm P1 / Đáo hạn NH / Chi nội bộ. Ba nhóm P1–P3 có tạm tính riêng; kéo ⋮⋮ để đổi thứ tự trong nhóm. Ô “Dự chi đợt này” có nút nhanh 50% / 100%. Nút mở ngăn bên phải để xem ghi chú, lịch sử thanh toán, duyệt chi, danh sách chứng từ nội bộ.
- Chứng từ nội bộ đã duyệt (chưa chốt sổ) được gộp thành **một dòng P1 “Chi tiêu nội bộ đã duyệt”**. Phần đã chốt sổ đã trừ vào tồn két nên không cộng lại.
