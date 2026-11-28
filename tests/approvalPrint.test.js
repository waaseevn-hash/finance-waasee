import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApprovalSheetHtml, buildPayOrderHtml } from '../src/lib/approvalPrint.js';

const company = { companyName: 'Công ty Waasee', address: 'Hà Nội', director: 'Nguyễn Văn A' };
const strip = (html) => html.replace(/<style[\s\S]*?<\/style>/, '').replace(/<script[\s\S]*?<\/script>/, '');

test('bảng đề xuất & duyệt chi: 3 ô tổng, nhóm P1/P2/P3 có cộng nhóm, không mã tài khoản', () => {
  const html = strip(
    buildApprovalSheetHtml({
      month: '2026-11',
      company,
      available: 100e6,
      date: '2026-11-28',
      fontBase: 'fonts/',
      items: [
        { priority: 'P2', who: 'NCC Đồng Việt', what: 'Lô dây đồng', due: '2026-11-26', amount: 80e6 },
        { priority: 'P1', who: 'Lương nhân viên', what: 'Lương', amount: 40e6 },
        { priority: 'P1', who: 'Điện lực', what: 'Tiền điện T11', due: '2026-11-24', amount: 5e6, note: 'Hạn cắt điện 30/11' },
      ],
    }),
  );
  assert.match(html, /BẢNG ĐỀ XUẤT &amp; DUYỆT CHI THÁNG 11\/2026/);
  assert.match(html, /TỔNG TIỀN CÓ THỂ CHI[\s\S]*100\.000\.000/);
  assert.match(html, /TỔNG TIỀN ĐỀ XUẤT CHI[\s\S]*125\.000\.000/);
  assert.match(html, /CHÊNH LỆCH THIẾU[\s\S]*25\.000\.000/);
  assert.ok(html.indexOf('NHÓM P1') < html.indexOf('NHÓM P2'));
  assert.match(html, /Cộng P1<\/td><td class="r"><b>45\.000\.000/);
  assert.equal((html.match(/☐ Chi/g) || []).length, 3);
  assert.match(html, /Tổng số tiền Giám đốc duyệt chi/);
  assert.match(html, /Người lập đề xuất[\s\S]*Giám đốc phê duyệt/);
  assert.doesNotMatch(html, /\b(111|112|1111|1121|331|642)\b/);
});

test('lệnh chi / bàn giao: phần I chuyển khoản, phần II tiền mặt, tổng và bằng chữ', () => {
  const html = strip(
    buildPayOrderHtml({
      company,
      date: '2026-11-28',
      fontBase: 'fonts/',
      bank: [{ who: 'NGUYEN THI HOA', account: '0451000123456', bank: 'Vietcombank', amount: 5e6, requested: 8e6, content: 'Tam ung' }],
      cash: [{ who: 'Anh Tuấn', what: 'Mua băng keo', amount: 3.5e6 }],
    }),
  );
  assert.match(html, /LỆNH CHI \/ BÀN GIAO THANH TOÁN/);
  assert.match(html, /Phần I\. Chi chuyển khoản[\s\S]*0451000123456[\s\S]*đề nghị 8\.000\.000/);
  assert.match(html, /Phần II\. Chi tiền mặt[\s\S]*Anh Tuấn/);
  assert.match(html, /8\.500\.000 đồng/);
  assert.match(html, /Tám triệu năm trăm nghìn đồng/i);
});
