/**
 * Xuất Bảng điều phối tháng ra Excel (có công thức):
 *   Sheet "Điều phối": khối nguồn tiền → Nguồn khả dụng (SUM) → Tổng dự chi (SUMIF cột "Chọn chi")
 *                      → Số dư sau chi, Cần rút hạn mức; bảng khoản chi nhóm P1/P2/P3 với tạm tính SUMIFS.
 *   Sheet "Phải thu": các khoản phải thu dự kiến, cột "Tính vào nguồn" Có/Không, tổng SUMIF.
 */
import { downloadXlsx } from './xlsx.js';
import { monthLabel } from './dates.js';

const KIND_LABEL = { AP: 'Công nợ NCC', LOAN: 'Đáo hạn NH', INTEREST: 'Lãi vay NH', INTERNAL: 'Chi nội bộ', CUSTOM: 'Chi cố định' };
const CERT = { SURE: 'Chắc chắn về', MAYBE_LATE: 'Có khả năng chậm', DOUBTFUL: 'Nợ khó đòi' };
const d = (iso) => {
  if (!iso) return '';
  const [y, m, dd] = iso.split('-');
  return `${dd}/${m}/${y}`;
};

export function buildPlanSheets({ plan, arRows, month, companyName }) {
  /* ---------- Sheet Phải thu ---------- */
  const ar = [[{ v: `PHẢI THU DỰ KIẾN — ${monthLabel(month).toUpperCase()}`, s: 'title' }], [], ['Đối tác', 'Nội dung', 'Hạn', 'Mức chắc chắn', 'Còn phải thu', 'Tính vào nguồn', 'Số tiền tính'].map((h) => ({ v: h, s: 'header' }))];
  const arFirst = ar.length + 1;
  for (const r of arRows) {
    const n = ar.length + 1;
    ar.push([
      { v: r.partner, s: 'cell' },
      { v: r.label || '', s: 'wrapCell' },
      { v: d(r.dueDate), s: 'cell' },
      { v: CERT[r.certainty] || '', s: 'cell' },
      { v: r.outstanding, s: 'moneyCell' },
      { v: r.selected ? 'Có' : 'Không', s: 'cell' },
      { f: `IF(F${n}="Có",${Number(r.amount) || 0},0)`, v: r.selected ? Number(r.amount) || 0 : 0, s: 'moneyCell' },
    ]);
  }
  const arLast = Math.max(arFirst, ar.length);
  const arTotalRow = ar.length + 1;
  ar.push([{ v: 'Cộng phải thu tính vào nguồn', s: 'totalLabel' }, ...Array.from({ length: 5 }, () => ({ v: '', s: 'totalLabel' })), { f: `SUM(G${arFirst}:G${arLast})`, v: plan.arIn, s: 'totalCell' }]);

  /* ---------- Sheet Điều phối ---------- */
  const rows = [];
  rows.push([{ v: companyName || '', s: 'italic' }]);
  rows.push([{ v: `BẢNG ĐIỀU PHỐI TÀI CHÍNH ${monthLabel(month).toUpperCase()}`, s: 'title' }]);
  rows.push([]);
  rows.push([{ v: 'NGUỒN TIỀN', s: 'bold' }]);
  const R = (label, cell) => {
    rows.push([{ v: label }, cell]);
    return rows.length;
  };
  const rCash = R('Tồn quỹ tiền mặt trong két', { v: plan.cashBalance, s: 'money' });
  const rReserve = R('Trừ: giữ lại dự phòng', { v: plan.reserve, s: 'money' });
  const rDeposit = R('Tiền gửi ngân hàng (nếu tính)', { v: plan.depositUsable, s: 'money' });
  const rAr = R('Phải thu đã chọn (sheet Phải thu)', { f: `'Phải thu'!G${arTotalRow}`, v: plan.arIn, s: 'money' });
  const rCredit = R(`Hạn mức vay gộp vào nguồn${plan.includeCredit ? '' : ' (đang tắt)'}`, { v: plan.creditInSources, s: 'money' });
  const rAvail = R('NGUỒN TIỀN KHẢ DỤNG', { f: `B${rCash}-B${rReserve}+B${rDeposit}+B${rAr}+B${rCredit}`, v: plan.available, s: 'moneyBold' });
  const rPay = rows.length + 1;
  rows.push([{ v: 'TỔNG DỰ CHI (các khoản chọn chi)', s: 'bold' }, null]);
  const rBal = R('SỐ DƯ SAU CHI', { f: `B${rAvail}-B${rPay}`, v: plan.balanceAvailable, s: 'moneyBold' });
  R('Hạn mức vay còn trống', { v: plan.creditAvailable, s: 'money' });
  const rLimit = rows.length;
  R('Cần rút từ hạn mức (nếu thiếu)', { f: `MIN(MAX(0,B${rPay}-(B${rAvail}-B${rCredit})),B${rLimit})`, v: plan.suggestedDraw, s: 'moneyBold' });
  void rBal;
  rows.push([]);
  const head = rows.length;
  rows.push(['STT', 'Ưu tiên', 'Đối tác / khoản chi', 'Loại', 'Nội dung', 'Hạn', 'Còn phải trả', 'Dự chi đợt này', 'Chọn chi', 'Còn lại sau đợt'].map((h) => ({ v: h, s: 'header' })));
  const first = rows.length + 1;
  let stt = 0;
  for (const p of ['P1', 'P2', 'P3']) {
    for (const r of plan.rows.filter((x) => x.priority === p)) {
      stt += 1;
      const n = rows.length + 1;
      rows.push([
        { v: stt, s: 'cell' },
        { v: p, s: 'cell' },
        { v: r.kind === 'CUSTOM' || r.kind === 'INTERNAL' ? r.label : r.partner, s: 'wrapCell' },
        { v: KIND_LABEL[r.kind] || '', s: 'cell' },
        { v: r.kind === 'CUSTOM' ? r.category || '' : r.kind === 'INTERNAL' ? r.partner : r.label || '', s: 'wrapCell' },
        { v: d(r.dueDate), s: 'cell' },
        { v: r.outstanding, s: 'moneyCell' },
        { v: Number(r.amount) || 0, s: 'moneyCell' },
        { v: r.selected ? 'Có' : 'Không', s: 'cell' },
        { f: `IF(I${n}="Có",MAX(0,G${n}-H${n}),G${n})`, v: r.selected ? Math.max(0, r.outstanding - (Number(r.amount) || 0)) : r.outstanding, s: 'moneyCell' },
      ]);
    }
  }
  const last = Math.max(first, rows.length);
  rows[rPay - 1][1] = { f: `SUMIF(I${first}:I${last},"Có",H${first}:H${last})`, v: plan.payTotal, s: 'moneyBold' };
  rows.push([]);
  rows.push([{ v: 'TẠM TÍNH THEO NHÓM ƯU TIÊN', s: 'bold' }]);
  for (const p of ['P1', 'P2', 'P3']) {
    rows.push([{ v: p, s: 'cell' }, { f: `SUMIFS(H${first}:H${last},B${first}:B${last},"${p}",I${first}:I${last},"Có")`, v: plan.byPriority[p] || 0, s: 'moneyCell' }]);
  }

  return [
    { name: 'Điều phối', rows, styled: true, headerRows: [head], freezeRows: 0, colWidths: [40, 18, 32, 14, 34, 11, 15, 15, 9, 15], merges: ['A1:J1', 'A2:J2'], landscape: true },
    { name: 'Phải thu', rows: ar, styled: true, headerRows: [2], freezeRows: 3, colWidths: [30, 30, 11, 18, 15, 13, 15], merges: ['A1:G1'] },
  ];
}

export function downloadPlanXlsx({ plan, arRows, month, companyName }) {
  return downloadXlsx(`Dieu-phoi_${month}`, buildPlanSheets({ plan, arRows, month, companyName }));
}
