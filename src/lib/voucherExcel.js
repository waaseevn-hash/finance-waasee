/**
 * Xuất Excel đợt kết chuyển (có công thức):
 *   Sheet 1 "Bảng kê kết chuyển": từng dòng định khoản, cột Thu/Chi tính bằng IF theo TK 1111,
 *           dòng Cộng = SUM, khối tổng hợp đầu trang (COUNTIF / SUM), tổng hợp theo cặp TK (SUMIFS).
 *   Sheet 2 "Bảng kê chi phí GĐNTT": Thành tiền = SL × Đơn giá, Tổng (A) = SUM, Chênh lệch = B − A.
 */
import { downloadXlsx } from './xlsx.js';
import { VTYPE, itemAmount, ledgerLines, settlement, voucherAmount } from './vouchers.js';

const shortDate = (iso) => {
  const [y, m, d] = String(iso || '').split('-');
  return iso ? `${d}/${m}/${y}` : '';
};

export function buildBatchSheets({ batch, docs, company, poster = '' }) {
  /* ---------------- Sheet 1 ---------------- */
  const rows = [];
  rows.push([{ v: company.companyName, s: 'title' }]);
  rows.push([{ v: company.address, s: 'italic' }]);
  rows.push([{ v: `BẢNG KÊ CHỨNG TỪ KẾT XUẤT & KẾT CHUYỂN — ĐỢT ${batch.code}`, s: 'bold' }]);
  rows.push([{ v: `Ngày kết chuyển: ${shortDate(batch.postDate)} · Người thực hiện: ${poster}`, s: 'italic' }]);
  rows.push([]);
  // Khối tổng hợp (dòng 6–10) — công thức tham chiếu bảng chi tiết bên dưới; điền sau khi biết phạm vi
  const kpiStart = rows.length; // index 5 => dòng 6
  for (let i = 0; i < 5; i += 1) rows.push([]);
  rows.push([]);
  const headIdx = rows.length;
  rows.push(['STT', 'Số chứng từ', 'Ngày CT', 'Loại chứng từ', 'Người nộp / nhận', 'Diễn giải', 'TK Nợ', 'TK Có', 'Số tiền', 'Thu tiền mặt', 'Chi tiền mặt', 'Chứng từ gốc'].map((h) => ({ v: h, s: 'header' })));
  const first = rows.length + 1; // dòng Excel đầu tiên của dữ liệu
  let stt = 0;
  const pairs = new Map();
  for (const l of ledgerLines(docs)) {
    const d = l.doc;
    stt += 1;
    const r = rows.length + 1;
    rows.push([
      { v: stt, s: 'cell' },
      { v: d.no, s: 'cell' },
      { v: shortDate(d.date), s: 'cell' },
      { v: `${VTYPE[d.type]?.label || ''}${d.auto ? ' (tự động)' : ''}`, s: 'cell' },
      { v: d.person, s: 'cell' },
      { v: l.info ? `${d.reason} (${voucherAmount(d).toLocaleString('vi-VN')} đ — thanh toán qua phiếu tự động)` : d.reason, s: 'wrapCell' },
      { v: l.debit, s: 'cell' },
      { v: l.credit, s: 'cell' },
      l.info ? { v: '', s: 'cell' } : { v: l.amount, s: 'moneyCell' },
      { f: `IF(G${r}="1111",I${r},0)`, v: !l.info && l.debit === '1111' ? l.amount : 0, s: 'moneyCell' },
      { f: `IF(H${r}="1111",I${r},0)`, v: !l.info && l.credit === '1111' ? l.amount : 0, s: 'moneyCell' },
      { v: d.sourceNo || d.attachedDocs || '', s: 'wrapCell' },
    ]);
    if (!l.info) {
      const key = `${l.debit}|${l.credit}`;
      pairs.set(key, (pairs.get(key) || 0) + l.amount);
    }
  }
  const last = rows.length;
  const totalRow = rows.length + 1;
  rows.push([
    { v: '', s: 'totalLabel' },
    { v: 'Cộng', s: 'totalLabel' },
    ...Array.from({ length: 6 }, () => ({ v: '', s: 'totalLabel' })),
    { f: `SUM(I${first}:I${last})`, v: [...pairs.values()].reduce((a, b) => a + b, 0), s: 'totalCell' },
    { f: `SUM(J${first}:J${last})`, v: batch.receiptsTotal, s: 'totalCell' },
    { f: `SUM(K${first}:K${last})`, v: batch.paymentsTotal, s: 'totalCell' },
    { v: '', s: 'totalLabel' },
  ]);

  // điền khối tổng hợp
  const kpi = [
    ['Số phiếu thu', { f: `COUNTIF(D${first}:D${last},"Phiếu thu*")`, v: batch.receiptsCount, s: 'bold' }],
    ['Tổng thu tiền mặt', { f: `J${totalRow}`, v: batch.receiptsTotal, s: 'moneyBold' }],
    ['Số phiếu chi', { f: `COUNTIF(D${first}:D${last},"Phiếu chi*")`, v: batch.paymentsCount, s: 'bold' }],
    ['Tổng chi tiền mặt', { f: `K${totalRow}`, v: batch.paymentsTotal, s: 'moneyBold' }],
    ['Chênh lệch (thu − chi)', { f: `J${totalRow}-K${totalRow}`, v: batch.net, s: 'moneyBold' }],
  ];
  kpi.forEach(([label, cell], i) => {
    rows[kpiStart + i] = [{ v: label, s: 'bold' }, cell];
  });

  rows.push([]);
  rows.push([{ v: 'TỔNG HỢP THEO CẶP TÀI KHOẢN', s: 'bold' }]);
  rows.push([{ v: 'TK Nợ', s: 'header' }, { v: 'TK Có', s: 'header' }, { v: 'Số tiền', s: 'header' }]);
  for (const [key, amount] of [...pairs.entries()].sort()) {
    const [dr, cr] = key.split('|');
    rows.push([
      { v: dr, s: 'cell' },
      { v: cr, s: 'cell' },
      { f: `SUMIFS($I$${first}:$I$${last},$G$${first}:$G$${last},"${dr}",$H$${first}:$H$${last},"${cr}")`, v: amount, s: 'moneyCell' },
    ]);
  }

  /* ---------------- Sheet 2 ---------------- */
  const tt = docs.filter((d) => d.type === 'TT');
  const rows2 = [
    [{ v: `BẢNG KÊ CHI PHÍ THEO GIẤY ĐỀ NGHỊ THANH TOÁN — ĐỢT ${batch.code}`, s: 'title' }],
    [],
    ['Số GĐNTT', 'TT', 'Tên chi phí', 'ĐVT', 'SL', 'Đơn giá', 'Thành tiền'].map((h) => ({ v: h, s: 'header' })),
  ];
  for (const d of tt) {
    const s = settlement(d);
    const start = rows2.length + 1;
    (d.items || []).forEach((it, i) => {
      const r = rows2.length + 1;
      rows2.push([
        { v: i === 0 ? d.no : '', s: 'cell' },
        { v: i + 1, s: 'cell' },
        { v: it.name, s: 'wrapCell' },
        { v: it.unit || '', s: 'cell' },
        { v: Number(it.qty) || 0, s: 'moneyCell' },
        { v: Number(it.price) || 0, s: 'moneyCell' },
        { f: `ROUND(E${r}*F${r},0)`, v: itemAmount(it), s: 'moneyCell' },
      ]);
    });
    const end = rows2.length;
    const aRow = rows2.length + 1;
    rows2.push([{ v: '', s: 'totalLabel' }, { v: '', s: 'totalLabel' }, { v: `Tổng cộng (A) — ${d.person}`, s: 'totalLabel' }, { v: '', s: 'totalLabel' }, { v: '', s: 'totalLabel' }, { v: '', s: 'totalLabel' }, { f: `SUM(G${start}:G${end})`, v: s.A, s: 'totalCell' }]);
    const bRow = rows2.length + 1;
    rows2.push([{ v: '' }, { v: '' }, { v: `Đã tạm ứng (B)${d.advanceNo ? ` — ${d.advanceNo}` : ''}`, s: 'italic' }, {}, {}, {}, { v: s.B, s: 'money' }]);
    rows2.push([{ v: '' }, { v: '' }, { v: 'Chênh lệch B − A (dương: hoàn ứng; âm: chi bổ sung)', s: 'italic' }, {}, {}, {}, { f: `G${bRow}-G${aRow}`, v: s.B - s.A, s: 'moneyBold' }]);
    rows2.push([]);
  }
  if (!tt.length) rows2.push([{ v: 'Đợt này không có Giấy đề nghị thanh toán.', s: 'italic' }]);

  return [
    { name: 'Bảng kê kết chuyển', rows, styled: true, headerRows: [headIdx], freezeRows: headIdx + 1, colWidths: [6, 18, 11, 26, 22, 40, 8, 8, 14, 14, 14, 22], merges: ['A1:L1', 'A2:L2', 'A3:L3', 'A4:L4'], landscape: true },
    { name: 'Bảng kê chi phí GĐNTT', rows: rows2, styled: true, headerRows: [2], freezeRows: 3, colWidths: [18, 6, 40, 8, 10, 14, 16], merges: ['A1:G1'] },
  ];
}

export function downloadBatchXlsx(args) {
  return downloadXlsx(`Ket-chuyen_${args.batch.code}`, buildBatchSheets(args));
}
