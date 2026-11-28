# Ghi chú dự án cho người phát triển (và Claude)

App **Quản lý Dòng tiền** của Waasee — React 19 + Vite + Tailwind 4 + Firebase (Firestore, Google Auth, gói Spark miễn phí). Đẩy `main` → GitHub Actions kiểm thử, build, đưa lên GitHub Pages (`base: './'`, thư mục `public/` chép nguyên vào `dist/`).

- App: https://waaseevn-hash.github.io/finance-waasee/ · Repo: `waaseevn-hash/finance-waasee` · Firebase: `finance-waasee`
- Chủ doanh nghiệp: `waaseevn@gmail.com` (khai ở `src/firebase-config.js` OWNER_EMAIL **và** `firestore.rules` ownerEmail() — phải trùng).

## Nguyên tắc bắt buộc khi sửa
- **Nâng cấp gia tăng**, không viết lại tính năng đang chạy. **Giữ nguyên schema Firestore**: không đổi tên collection / trường, chỉ thêm trường mới (có giá trị mặc định khi thiếu).
- Mọi ghi số liệu đi qua `AuditedBatch` / `runAuditedTx` (`src/lib/db.js`): mỗi lần ghi kèm 1 dòng `audit_logs` cùng lô; luật Firestore từ chối nếu thiếu. Thao tác hàng loạt dùng nhật ký `BATCH` với `docPaths`.
- Quyền thật nằm ở `firestore.rules`; `src/lib/roles.js` chỉ ẩn/hiện giao diện. Đổi luật xong phải **Publish** trên Firebase console (app chạy trước khi Publish phải không hỏng — lỗi quyền của phần mới thì coi như rỗng).
- Giao diện quản lý (OWNER, CO_OWNER) không hiện số hiệu tài khoản, Nợ/Có, quyển số, định khoản — dùng `can(role, 'accountingView')` (chỉ STAFF). Chữ "kết chuyển" trên giao diện gọi là **chốt sổ**.
- Tiếng Việt có dấu cho mọi chữ trên giao diện, thông báo lỗi, nhật ký.

## Cấu trúc chính
- `src/pages/` — `Work.jsx` (Việc cần làm của kế toán), `Dashboard.jsx`, `Cashbook.jsx`, `BankCredit.jsx`, `Partners.jsx`, `Vouchers.jsx` (Đề xuất & Duyệt chi / chốt sổ), `Planner.jsx` (Điều phối tháng), `Admin.jsx` (Phân quyền & Cài đặt).
- `src/components/NotificationCenter.jsx` — chuông, ngăn Duyệt nhanh (`QuickApprovalList`), hộp thư kế toán; hook `useMoneyNow`, `usePendingApprovals`, `useToPay`.
- `src/lib/pending.js` — hàm thuần: `pendingApprovals`, `committedOut`, `withRunning`, `toPayItems`, `isHeld`.
- `src/lib/notify.js` — Telegram / webhook (`settings/notify`), thông báo trình duyệt, `setAppBadge`. Không bao giờ ném lỗi ra thao tác chính.
- `src/lib/vouchers.js` + `voucherService.js` — chứng từ TT200, duyệt (một phần), `markVoucherPaid`, `postVouchers` (chốt sổ; `canReadBanks:false` cho kế toán → `AuditedTx.adjust()` increment + `lastBatchId`), `reverseVoucher`.
- `src/lib/voucherPrint.js` — mẫu in TT200, `wrapPages()` (khung A4 + phông nhúng `public/fonts/WaaseeSerif-*.woff`). `src/lib/approvalPrint.js` — Bảng đề xuất & duyệt chi tháng, Lệnh chi / bàn giao. Xem trước: `components/vouchers/PrintPreview.jsx`, `components/SheetPreview.jsx`.
- `src/lib/holders.js` — người giữ tiền (`settings/cashHolders`), `settings/payAccounts` (bản sao tài khoản công ty không số dư cho kế toán, quản lý tự đồng bộ).
- `src/index.css` — lớp bảng dùng chung `.dt-wrap` (+ `tr.dt-group dt-group-red|amber|blue|green`); dùng `TableWrap / th / td` trong `components/ui.jsx`.

## Dữ liệu (Firestore)
`members`, `cash_entries`, `banks`, `loans`, `receivables`, `payables`, `payments`, `partners`, `approvals`, `internal_vouchers`, `voucher_files`, `posting_batches`, `counters`, `plans`, `plan_snapshots`, `settings` (`company`, `cashHolders`, `planner`, `notify`, `payAccounts`), `audit_logs`, `audit_archive`.
Trường thêm ngày 28/11: `internal_vouchers.paidAt/paidBy/paidByName/paidNote`, `payables.holdUntil/holdNote`, `banks.lastBatchId`.

## Kiểm tra trước khi đẩy
```bash
npm test            # node --test tests/*.test.js — 35 bài (28/11/2026)
npm run build
```
Sau khi đẩy: `gh run watch <id> -R waaseevn-hash/finance-waasee --exit-status`. Service worker (`public/sw.js`) lấy bản mới khi có mạng, chỉ dùng bộ đệm khi mất mạng.

## Lịch sử gần nhất
- `7d89835` (28/11/2026) — bản in Bảng đề xuất & duyệt chi tháng; Lệnh chi / bàn giao thanh toán.
- `5190e9c` (28/11/2026) — giao diện theo vai trò, Việc cần làm, chuông & Duyệt nhanh, thông báo đẩy, kế toán chốt sổ, bảng biểu thống nhất; luật Firestore Publish 28/11 13:00.
- `4135031` (27/11/2026) — bản in chứng từ chuyên nghiệp, chuyển khoản 112, bảng kê lệnh chuyển khoản.
