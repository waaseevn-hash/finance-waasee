# Quản lý Dòng tiền

Ứng dụng web quản lý dòng tiền & ngân quỹ nội bộ doanh nghiệp: tiền mặt trong két, vay & hạn mức ngân hàng, công nợ phải thu / phải trả, duyệt chi nhà cung cấp, điều phối tài chính tháng (bảng tổng hợp, cần giải ngân), nhật ký thao tác.

- Giao diện: React 19 + Tailwind CSS 4, cài được như ứng dụng trên Android, máy tính (và mở bằng Safari trên iPhone)
- Dữ liệu & đăng nhập: Firebase (Firestore + đăng nhập Google), bảo vệ bằng `firestore.rules`
- Triển khai: GitHub Pages, tự động mỗi khi đẩy code lên nhánh `main` (`.github/workflows/deploy.yml`)

Mã nguồn không chứa số liệu hay mật khẩu. Số liệu nằm trong Firestore và chỉ Gmail được Chủ doanh nghiệp cấp quyền mới đọc được.

Hướng dẫn chi tiết: [docs/HUONG_DAN.md](docs/HUONG_DAN.md)

## Lệnh cho người phát triển

```bash
npm install
npm test          # kiểm thử logic tài chính
npm run dev       # chạy thử trên máy
npm run build     # đóng gói vào dist/
```
