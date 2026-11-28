# Quản lý Dòng tiền

Ứng dụng web quản lý dòng tiền & ngân quỹ nội bộ doanh nghiệp: tiền mặt và tiền gửi ngân hàng, vay & hạn mức ngân hàng, công nợ phải thu / phải trả, đề xuất & duyệt chi, chốt sổ chứng từ Thông tư 200, điều phối tài chính tháng, nhật ký thao tác.

- Giao diện: React 19 + Tailwind CSS 4, cài được như ứng dụng trên Android, máy tính (và mở bằng Safari trên iPhone)
- Dữ liệu & đăng nhập: Firebase (Firestore + đăng nhập Google), bảo vệ bằng `firestore.rules`
- Triển khai: GitHub Pages, tự động mỗi khi đẩy code lên nhánh `main` (`.github/workflows/deploy.yml`)
- App: https://waaseevn-hash.github.io/finance-waasee/

Mã nguồn không chứa số liệu hay mật khẩu. Số liệu nằm trong Firestore và chỉ Gmail được Chủ doanh nghiệp cấp quyền mới đọc được.

Hướng dẫn sử dụng chi tiết: [docs/HUONG_DAN.md](docs/HUONG_DAN.md) · Ghi chú cho người phát triển: [CLAUDE.md](CLAUDE.md)

## Ai thấy gì

| Vai trò | Màn hình chính | Việc chính |
|---|---|---|
| Chủ doanh nghiệp / Đồng quản trị | **Tổng quan** — thẻ *Tổng tiền đang có (Khả dụng chi)* (bấm xem két, người giữ tiền, từng ngân hàng), khối *Khoản chờ duyệt ngay* | Duyệt / sửa số duyệt / từ chối (công nợ: hoãn) ngay trong **chuông Duyệt nhanh**; in **Bảng đề xuất & duyệt chi tháng**; in **Lệnh chi / bàn giao thanh toán**. Không thấy số hiệu tài khoản, Nợ/Có, quyển số. |
| Kế toán | **Việc cần làm** — 3 hàng đợi: *Cần lập & Gửi duyệt* · *Sếp đã duyệt — Cần chi ngay* · *Sổ chi tiết & Lưu chứng từ* | Lập đề xuất; chi đúng số Sếp duyệt rồi bấm **Đã chi**; **chốt sổ** tiền mặt (111) / tiền gửi (112) và in chứng từ Thông tư 200. Không xem được sổ quỹ, số dư tiền gửi, vay. |

Chỉ Chủ doanh nghiệp: hủy chốt sổ, sao lưu & chuyển dữ liệu, cấu hình **thông báo đẩy** (Telegram / webhook).

## Cập nhật gần nhất

- **28/11/2026 — `7d89835`**: bản in **Bảng đề xuất & duyệt chi tháng** (3 ô tổng, nhóm P1/P2/P3 có cộng nhóm, ô ☐ Chi ☐ Hoãn, không mã tài khoản) và **Lệnh chi / bàn giao thanh toán** (Phần I chuyển khoản, Phần II tiền mặt).
- **28/11/2026 — `5190e9c`**: tách giao diện Chủ DN / Kế toán; *Việc cần làm* của kế toán; chuông số đỏ + ngăn *Duyệt nhanh*; gộp *Tổng tiền đang có*; kế toán báo *Đã chi* và tự chốt sổ; thông báo đẩy Telegram + thông báo trình duyệt; kẻ lại toàn bộ bảng biểu; luật Firestore mới (đã Publish 28/11 13:00).
- 27/11/2026 — `4135031`: bản in chứng từ chuyên nghiệp (phông nhúng), chuyển khoản 112, bảng kê lệnh chuyển khoản.

## Lệnh cho người phát triển

```bash
npm install
npm test          # kiểm thử logic tài chính, danh sách chờ duyệt, mẫu in
npm run dev       # chạy thử trên máy
npm run build     # đóng gói vào dist/
```

Khi `firestore.rules` thay đổi: dán nội dung file vào Firebase console → Firestore → Rules → **Publish**.
