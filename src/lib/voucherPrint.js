/**
 * MẪU IN CHỨNG TỪ — Thông tư 200/2014/TT-BTC
 *   01-TT Phiếu thu · 02-TT Phiếu chi · 03-TT Giấy đề nghị tạm ứng · 05-TT Giấy đề nghị thanh toán (kèm bảng kê & quyết toán tạm ứng)
 *   + Bảng kê đợt kết chuyển (tiền mặt 111 và tiền gửi 112)
 *   + Bảng kê lệnh chuyển khoản (đủ thông tin tài khoản người thụ hưởng) để kế toán đi lệnh ngân hàng
 * Khổ giấy: A4 (mỗi chứng từ một trang) hoặc 2 liên A5 trên một tờ A4 (cắt đôi theo đường kẻ).
 * Phông chữ nhúng sẵn (Waasee Serif — có đủ dấu tiếng Việt, cùng khổ chữ với Times New Roman) để bản in
 * và file PDF giống nhau trên mọi máy, kể cả điện thoại không có Times New Roman.
 */
import { moneyToWords } from './vnwords.js';
import {
  VTYPE,
  accountName,
  bankPayments,
  isBank,
  isPartial,
  itemAmount,
  ledgerLines,
  moneyAccount,
  requestedAmount,
  settlement,
  transferContent,
  voucherAmount,
} from './vouchers.js';

const esc = (s) =>
  String(s ?? '')
    .normalize('NFC')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const money = (n) => Math.round(Number(n) || 0).toLocaleString('vi-VN');
const dateParts = (iso) => {
  const [y, m, d] = String(iso || '').split('-');
  return { d: d || '.....', m: m || '.....', y: y || '.........' };
};
const longDate = (iso) => {
  const p = dateParts(iso);
  return `Ngày ${p.d} tháng ${p.m} năm ${p.y}`;
};
const shortDate = (iso) => {
  const p = dateParts(iso);
  return iso ? `${p.d}/${p.m}/${p.y}` : '';
};
const words = (n) => {
  const w = moneyToWords(n);
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : '';
};

/** Thư mục phông chữ (tuyệt đối, để khung in srcdoc và trình tạo PDF đều tải được) */
function defaultFontBase() {
  try {
    if (typeof document !== 'undefined' && document.baseURI) return new URL('fonts/', document.baseURI).href;
  } catch {
    /* bỏ qua */
  }
  return 'fonts/';
}

/** Chứng từ có in vừa nửa trang A5 không */
export function fitsHalf(v) {
  // GĐNTT có bảng quyết toán tạm ứng hoặc nhiều dòng chi phí: in trọn một trang A4
  if (v.type === 'TT') return (v.items || []).length <= 3 && !(Number(v.advanceAmount) > 0) && !isBank(v) && String(v.reason || '').length <= 140;
  if (v.type === 'TU' && (isBank(v) || isPartial(v))) return false;
  if (v.type === 'PC' && isBank(v)) return String(v.reason || '').length <= 120;
  return String(v.reason || '').length <= 220;
}

/* ============================ khối dùng chung ============================ */

/** Một dòng biểu mẫu: nhãn + giá trị trên dòng chấm (dòng trống vẫn có chấm để viết tay) */
function f(label, value, { cls = '', raw = false } = {}) {
  const v = raw ? value : esc(value);
  return `<div class="f ${cls}"><span class="k">${label}</span><span class="v">${v || '&nbsp;'}</span></div>`;
}

function header(company, { formNo, internal = false }) {
  const reg = esc(company.regulation || '')
    .replace(/(\d+\/\d{4}\/[A-ZĐ-]+)/, '<span class="nw">$1</span>')
    .replace(/\s+ngày\s+/, '<br/>ngày ');
  return `
  <header class="hd">
    <div class="org">
      <div>Đơn vị: <b>${esc(company.companyName)}</b></div>
      <div>Địa chỉ: ${esc(company.address)}</div>
      ${company.taxCode ? `<div>Mã số thuế: ${esc(company.taxCode)}</div>` : ''}
    </div>
    <div class="form">
      ${internal ? `<div class="form-no">Chứng từ nội bộ</div><div class="form-reg">(Thanh toán qua ngân hàng)</div>` : `<div class="form-no">${esc(formNo)}</div><div class="form-reg">(Ban hành theo ${reg})</div>`}
    </div>
  </header>`;
}

/** Tiêu đề giữa trang + ô Quyển số / Số / Nợ / Có bên phải (phiếu thu, phiếu chi) */
function titleBlock(title, v, { meta = null, sub = '' } = {}) {
  const right = meta
    ? `<table class="meta">${meta.map(([k, val]) => `<tr><td>${k}:</td><td><b>${esc(val)}</b></td></tr>`).join('')}</table>`
    : '';
  return `
  <div class="tt">
    <div></div>
    <div class="mid">
      <h1>${esc(title)}</h1>
      ${sub ? `<div class="h1-sub">${esc(sub)}</div>` : ''}
      <div class="date">${longDate(v.date)}</div>
      ${meta ? '' : `<div class="no">Số: <b>${esc(v.no || '(chưa cấp số)')}</b></div>`}
    </div>
    <div>${right}</div>
  </div>`;
}

/** Khối chữ ký: các hàng chức danh / hướng dẫn / chỗ ký / họ tên thẳng hàng nhau */
function signatures(cols, date, { dateText = '' } = {}) {
  const row = (cls, fn) => `<tr class="${cls}">${cols.map((c) => `<td>${fn(c)}</td>`).join('')}</tr>`;
  return `<div class="signs${cols.length >= 5 ? ' five' : ''}">
  <div class="sign-date">${dateText || (date ? longDate(date) : 'Ngày ..... tháng ..... năm .........')}</div>
  <table class="sign">
    ${row('role', (c) => esc(c.role))}
    ${row('hint', (c) => `(${esc(c.hint || 'Ký, họ tên')})`)}
    ${row('space', () => '')}
    ${row('name', (c) => esc(c.name || ''))}
  </table></div>`;
}

function cashFoot() {
  return `<div class="foot">
    ${f('Đã nhận đủ số tiền (viết bằng chữ):', '')}
    ${f('+ Tỷ giá ngoại tệ (vàng bạc, đá quý):', '')}
    ${f('+ Số tiền quy đổi:', '')}
    <div class="copy-note">(Liên gửi ra ngoài phải đóng dấu)</div>
  </div>`;
}

/** Khối thông tin chuyển khoản của người thụ hưởng */
function payeeBlock(v, amount) {
  return `<div class="box">
    <div class="box-t">Thông tin chuyển khoản</div>
    ${f('Đơn vị / người thụ hưởng:', `<b>${esc(v.payeeName || v.person)}</b>${v.payeeTaxCode ? ` — MST: ${esc(v.payeeTaxCode)}` : ''}`, { raw: true })}
    ${f('Số tài khoản:', `<b class="acct">${esc(v.payeeAccount)}</b>`, { raw: true })}
    ${f('Tại ngân hàng:', [v.payeeBank, v.payeeBranch].filter(Boolean).join(' – '))}
    ${amount ? f('Số tiền chuyển:', `<b>${money(amount)} đồng</b>`, { raw: true }) : ''}
    ${f('Nội dung chuyển khoản:', v.transferNote || transferContent(v))}
  </div>`;
}

/* ============================ 01-TT PHIẾU THU ============================ */
function receipt(v, company, names) {
  const amount = voucherAmount(v);
  const bank = isBank(v);
  return `
  ${header(company, { formNo: 'Mẫu số 01 - TT', internal: bank })}
  ${titleBlock('PHIẾU THU', v, {
    sub: bank ? '(Thu qua tài khoản ngân hàng)' : '',
    meta: [['Quyển số', v.bookNo || company.bookNo || ''], ['Số', v.no || '(chưa cấp số)'], ['Nợ', moneyAccount(v)], ['Có', v.credit || '131']],
  })}
  <div class="body">
    ${f('Họ và tên người nộp tiền:', v.person)}
    ${f('Địa chỉ:', v.address || v.position)}
    ${f('Lý do nộp:', v.reason)}
    ${f('Số tiền:', `<b>${money(amount)} đồng</b>`, { raw: true })}
    ${f('(Viết bằng chữ):', `<i>${esc(words(amount))}</i>`, { raw: true })}
    ${f('Kèm theo:', `${esc(v.attachedDocs || '')}${v.attachedDocs ? ' chứng từ gốc' : ''}`, { raw: true })}
  </div>
  ${signatures(
    bank
      ? [
          { role: 'Giám đốc', hint: 'Ký, họ tên, đóng dấu', name: company.director },
          { role: 'Kế toán trưởng', name: company.chiefAccountant },
          { role: 'Người lập phiếu', name: names.preparer },
        ]
      : [
          { role: 'Giám đốc', hint: 'Ký, họ tên, đóng dấu', name: company.director },
          { role: 'Kế toán trưởng', name: company.chiefAccountant },
          { role: 'Người nộp tiền', name: v.person },
          { role: 'Người lập phiếu', name: names.preparer },
          { role: 'Thủ quỹ', name: company.cashier },
        ],
    v.date,
  )}
  ${bank ? '' : cashFoot()}`;
}

/* ============================ 02-TT PHIẾU CHI ============================ */
function payment(v, company, names) {
  const amount = voucherAmount(v);
  const bank = isBank(v);
  const partialNote = isPartial(v) ? `Duyệt chi một phần — số đề nghị ${money(requestedAmount(v))} đồng${v.approvalNote ? `. ${v.approvalNote}` : ''}` : '';
  return `
  ${header(company, { formNo: 'Mẫu số 02 - TT', internal: bank })}
  ${titleBlock(bank ? 'LỆNH CHI' : 'PHIẾU CHI', v, {
    sub: bank ? '(Chi bằng chuyển khoản)' : '',
    meta: [['Quyển số', v.bookNo || company.bookNo || ''], ['Số', v.no || '(chưa cấp số)'], ['Nợ', v.debit || '642'], ['Có', moneyAccount(v)]],
  })}
  <div class="body">
    ${f(bank ? 'Đơn vị / người nhận tiền:' : 'Họ và tên người nhận tiền:', v.person)}
    ${f('Địa chỉ:', v.address || v.position)}
    ${f('Lý do chi:', v.reason)}
    ${f('Số tiền:', `<b>${money(amount)} đồng</b>`, { raw: true })}
    ${f('(Viết bằng chữ):', `<i>${esc(words(amount))}</i>`, { raw: true })}
    ${partialNote ? f('Ghi chú:', partialNote) : ''}
    ${f('Kèm theo:', `${esc(v.attachedDocs || '')}${v.attachedDocs ? ' chứng từ gốc' : ''}`, { raw: true })}
  </div>
  ${bank ? payeeBlock(v) : ''}
  ${signatures(
    bank
      ? [
          { role: 'Giám đốc', hint: 'Ký, họ tên, đóng dấu', name: company.director },
          { role: 'Kế toán trưởng', name: company.chiefAccountant },
          { role: 'Người lập phiếu', name: names.preparer },
        ]
      : [
          { role: 'Giám đốc', hint: 'Ký, họ tên, đóng dấu', name: company.director },
          { role: 'Kế toán trưởng', name: company.chiefAccountant },
          { role: 'Thủ quỹ', name: company.cashier },
          { role: 'Người lập phiếu', name: names.preparer },
          { role: 'Người nhận tiền', name: v.person },
        ],
    v.date,
  )}
  ${bank ? '' : cashFoot()}`;
}

/* ============================ 03-TT GIẤY ĐỀ NGHỊ TẠM ỨNG ============================ */
function advanceRequest(v, company) {
  const amount = requestedAmount(v);
  const approved = voucherAmount(v);
  return `
  ${header(company, { formNo: 'Mẫu số 03 - TT' })}
  ${titleBlock('GIẤY ĐỀ NGHỊ TẠM ỨNG', v)}
  <div class="body">
    <div class="to">Kính gửi: <b>${esc(company.addressee || 'Giám đốc Công ty')}</b></div>
    ${f('Tên tôi là:', v.person)}
    ${f('Bộ phận (hoặc địa chỉ):', v.position || v.address)}
    ${f('Đề nghị cho tạm ứng số tiền:', `<b>${money(amount)} đồng</b>`, { raw: true })}
    ${f('(Viết bằng chữ):', `<i>${esc(words(amount))}</i>`, { raw: true })}
    ${isPartial(v) ? f('Số tiền được duyệt tạm ứng:', `<b>${money(approved)} đồng</b> <i>(${esc(words(approved))})</i>${v.approvalNote ? ` — ${esc(v.approvalNote)}` : ''}`, { raw: true }) : ''}
    ${f('Lý do tạm ứng:', v.reason)}
    ${f('Thời hạn thanh toán:', v.dueDate ? shortDate(v.dueDate) : '')}
    ${f('Hình thức nhận tạm ứng:', isBank(v) ? 'Chuyển khoản' : 'Tiền mặt')}
  </div>
  ${isBank(v) ? payeeBlock(v, approved) : ''}
  ${signatures(
    [
      { role: 'Giám đốc', hint: 'Ký, họ tên, đóng dấu', name: company.director },
      { role: 'Kế toán trưởng', name: company.chiefAccountant },
      { role: 'Phụ trách bộ phận', name: '' },
      { role: 'Người đề nghị tạm ứng', name: v.person },
    ],
    null,
  )}`;
}

/* ============================ 05-TT GIẤY ĐỀ NGHỊ THANH TOÁN ============================ */
function paymentRequest(v, company) {
  const s = settlement(v);
  const partial = isPartial(v);
  const listed = requestedAmount(v);
  const items = v.items || [];
  const rows = items
    .map(
      (it, i) => `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(it.name)}</td>
        <td class="c">${esc(it.unit || '')}</td>
        <td class="r">${Number(it.qty || 0).toLocaleString('vi-VN')}</td>
        <td class="r">${money(it.price)}</td>
        <td class="r">${money(itemAmount(it))}</td>
      </tr>`,
    )
    .join('');
  let settle = '';
  if (s.B > 0) {
    settle = `
    <table class="grid settle">
      ${partial ? `<tr><td>Tổng số tiền chi theo bảng kê</td><td class="r">${money(listed)}</td></tr>` : ''}
      <tr><td>${partial ? 'Số tiền được duyệt thanh toán' : 'Tổng số tiền đề nghị thanh toán'} <b>(A)</b></td><td class="r"><b>${money(s.A)}</b></td></tr>
      <tr><td>Số tiền đã tạm ứng <b>(B)</b>${v.advanceNo ? ` — theo Giấy đề nghị tạm ứng số <b>${esc(v.advanceNo)}</b>` : ''}</td><td class="r"><b>${money(s.B)}</b></td></tr>
      ${
        s.refund > 0
          ? `<tr class="hl"><td>Số tạm ứng chi không hết (B − A) — nộp lại ${isBank(v) ? 'qua chuyển khoản' : 'quỹ'}</td><td class="r"><b>${money(s.refund)}</b></td></tr>`
          : s.extra > 0
            ? `<tr class="hl"><td>Chi quá số tạm ứng (A − B) — đề nghị chi bổ sung${isBank(v) ? ' bằng chuyển khoản' : ''}</td><td class="r"><b>${money(s.extra)}</b></td></tr>`
            : `<tr class="hl"><td>Chênh lệch</td><td class="r"><b>0</b></td></tr>`
      }
    </table>`;
  }
  const diff = s.B > 0 ? (s.refund > 0 ? ['Số tạm ứng chi không hết (viết bằng chữ):', s.refund] : s.extra > 0 ? ['Số chi quá tạm ứng (viết bằng chữ):', s.extra] : null) : null;
  const payOut = s.B > 0 ? s.extra : s.A;
  return `
  ${header(company, { formNo: 'Mẫu số 05 - TT' })}
  ${titleBlock('GIẤY ĐỀ NGHỊ THANH TOÁN', v)}
  <div class="body">
    <div class="to">Kính gửi: <b>${esc(company.addressee || 'Giám đốc Công ty')}</b></div>
    ${f('Họ và tên người đề nghị thanh toán:', v.person)}
    ${f('Bộ phận (hoặc địa chỉ):', v.position || v.address)}
    ${f('Nội dung thanh toán:', v.reason)}
  </div>
  <table class="grid items">
    <thead><tr><th style="width:8%">TT</th><th>Nội dung chi</th><th style="width:10%">ĐVT</th><th style="width:9%">SL</th><th style="width:16%">Đơn giá</th><th style="width:18%">Thành tiền</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr><td colspan="5" class="r"><b>Tổng cộng${partial ? '' : ' (A)'}</b></td><td class="r"><b>${money(listed)}</b></td></tr>
      ${partial ? `<tr><td colspan="5" class="r"><b>Số tiền được duyệt thanh toán (A)</b></td><td class="r"><b>${money(s.A)}</b></td></tr>` : ''}
    </tfoot>
  </table>
  <div class="body">
    ${f(partial ? 'Số tiền được duyệt (viết bằng chữ):' : 'Số tiền (viết bằng chữ):', `<i>${esc(words(s.A))}</i>`, { raw: true })}
    ${partial && v.approvalNote ? f('Ghi chú duyệt:', v.approvalNote) : ''}
  </div>
  ${settle}
  ${diff ? `<div class="body">${f(diff[0], `<i>${esc(words(diff[1]))}</i>`, { raw: true })}</div>` : ''}
  <div class="body">${f('Hình thức thanh toán:', isBank(v) ? 'Chuyển khoản' : 'Tiền mặt')}${f('Kèm theo:', `${esc(v.attachedDocs || '')}${v.attachedDocs ? ' chứng từ gốc' : ''}`, { raw: true })}</div>
  ${isBank(v) && payOut > 0 ? payeeBlock(v, payOut) : ''}
  ${signatures(
    [
      { role: 'Người đề nghị thanh toán', name: v.person },
      { role: 'Kế toán trưởng', name: company.chiefAccountant },
      { role: 'Người duyệt', hint: 'Ký, họ tên, đóng dấu', name: company.director },
    ],
    null,
  )}`;
}

function renderDoc(v, company, names) {
  if (v.type === 'PT') return receipt(v, company, names);
  if (v.type === 'PC') return payment(v, company, names);
  if (v.type === 'TU') return advanceRequest(v, company);
  return paymentRequest(v, company);
}

/* ============================ BẢNG KÊ ĐỢT KẾT CHUYỂN ============================ */
const SHORT = { PT: 'Phiếu thu', PC: 'Phiếu chi', TU: 'GĐ tạm ứng', TT: 'GĐ thanh toán' };

function batchSummary(batch, docs, company, names, cash) {
  const lines = ledgerLines(docs);
  const hasBank = lines.some((l) => !l.info && (l.debit === '1121' || l.credit === '1121'));
  const sum = { ci: 0, co: 0, bi: 0, bo: 0 };
  const rows = lines.map((l, idx) => {
    const d = l.doc;
    const ci = !l.info && l.debit === '1111' ? l.amount : 0;
    const co = !l.info && l.credit === '1111' ? l.amount : 0;
    const bi = !l.info && l.debit === '1121' ? l.amount : 0;
    const bo = !l.info && l.credit === '1121' ? l.amount : 0;
    sum.ci += ci;
    sum.co += co;
    sum.bi += bi;
    sum.bo += bo;
    const note = l.info ? `<div class="tag">${money(voucherAmount(d))} đ — thanh toán qua phiếu ${d.type === 'TU' ? 'chi' : 'thu / chi'} tự động</div>` : '';
    return `<tr${l.info ? ' class="info"' : ''}>
        <td class="c">${idx + 1}</td>
        <td><b class="nw">${esc(d.no)}</b><div class="tag">${esc(shortDate(d.date))} · ${esc(SHORT[d.type] || '')}${d.auto ? ' (tự động)' : ''}</div></td>
        <td><b>${esc(d.person)}</b> — ${esc(d.reason)}${note}</td>
        <td class="c nw">${l.debit || l.credit ? `${esc(l.debit)}/${esc(l.credit)}` : ''}</td>
        <td class="r">${ci ? money(ci) : ''}</td>
        <td class="r">${co ? money(co) : ''}</td>
        ${hasBank ? `<td class="r">${bi ? money(bi) : ''}</td><td class="r">${bo ? money(bo) : ''}</td>` : ''}
      </tr>`;
  });
  const cashBefore = cash && Number.isFinite(cash.before) ? cash.before : null;
  const bankBefore = Number.isFinite(batch.bankBalanceBefore) ? batch.bankBalanceBefore : null;
  const cell = (n) => (n === null ? '' : money(n));
  const signed = (n) => `${n < 0 ? '−' : ''}${money(Math.abs(n))}`;
  const bankName = batch.payBank ? `${esc(batch.payBank.name)}${batch.payBank.accountNo ? ` · ${esc(batch.payBank.accountNo)}` : ''}` : '';
  return `
  <header class="hd">
    <div class="org">
      <div>Đơn vị: <b>${esc(company.companyName)}</b></div>
      <div>Địa chỉ: ${esc(company.address)}</div>
    </div>
    <div class="form"><div class="form-no">Đợt ${esc(batch.code)}</div><div class="form-reg">Ngày kết chuyển ${esc(shortDate(batch.postDate))}</div></div>
  </header>
  <div class="tt single"><div class="mid">
    <h1>BẢNG KÊ CHỨNG TỪ KẾT CHUYỂN</h1>
    <div class="date">Thu – chi tiền mặt (TK 111) và tiền gửi ngân hàng (TK 112)</div>
  </div></div>
  <table class="grid sum">
    <thead><tr><th style="width:30%"></th><th>Thu / nhận</th><th>Chi</th><th>Chênh lệch</th><th>Số dư trước</th><th>Số dư sau</th></tr></thead>
    <tbody>
      <tr><td><b>Tiền mặt</b> (111)</td><td class="r">${money(sum.ci)}</td><td class="r">${money(sum.co)}</td><td class="r">${signed(sum.ci - sum.co)}</td><td class="r">${cell(cashBefore)}</td><td class="r"><b>${cashBefore === null ? '' : money(cashBefore + sum.ci - sum.co)}</b></td></tr>
      ${
        hasBank
          ? `<tr><td><b>Tiền gửi ngân hàng</b> (112)${bankName ? `<div class="tag">${bankName}</div>` : ''}</td><td class="r">${money(sum.bi)}</td><td class="r">${money(sum.bo)}</td><td class="r">${signed(sum.bi - sum.bo)}</td><td class="r">${cell(bankBefore)}</td><td class="r"><b>${bankBefore === null ? '' : money(bankBefore + sum.bi - sum.bo)}</b></td></tr>`
          : ''
      }
      <tr class="tot"><td><b>Cộng dòng tiền</b></td><td class="r"><b>${money(sum.ci + sum.bi)}</b></td><td class="r"><b>${money(sum.co + sum.bo)}</b></td><td class="r"><b>${signed(sum.ci + sum.bi - sum.co - sum.bo)}</b></td><td></td><td></td></tr>
    </tbody>
  </table>
  <table class="grid list">
    <colgroup><col style="width:5%"/><col style="width:15%"/><col/><col style="width:9.5%"/>${(hasBank ? [10.5, 10.5, 10.5, 10.5] : [13, 13]).map((w) => `<col style="width:${w}%"/>`).join('')}</colgroup>
    <thead>
      <tr>
        <th rowspan="2">STT</th><th rowspan="2">Số chứng từ</th><th rowspan="2">Đối tượng – diễn giải</th>
        <th rowspan="2">TK Nợ/Có</th>
        <th colspan="2">Tiền mặt (111)</th>${hasBank ? '<th colspan="2">Ngân hàng (112)</th>' : ''}
      </tr>
      <tr><th>Thu</th><th>Chi</th>${hasBank ? '<th>Nhận</th><th>Chi</th>' : ''}</tr>
    </thead>
    <tbody>${rows.join('')}</tbody>
    <tfoot><tr><td colspan="4" class="r"><b>Cộng</b></td><td class="r"><b>${money(sum.ci)}</b></td><td class="r"><b>${money(sum.co)}</b></td>${hasBank ? `<td class="r"><b>${money(sum.bi)}</b></td><td class="r"><b>${money(sum.bo)}</b></td>` : ''}</tr></tfoot>
  </table>
  <div class="note">Các chứng từ trong đợt đã được ghi sổ (tiền mặt vào Sổ quỹ, chuyển khoản vào số dư tiền gửi) và khóa sửa. Điều chỉnh bằng chức năng “Hủy kết chuyển” (bút toán đảo) của Chủ doanh nghiệp.</div>
  ${signatures(
    [
      { role: 'Người lập', name: names.poster },
      { role: 'Kế toán trưởng', name: company.chiefAccountant },
      { role: 'Giám đốc', hint: 'Ký, họ tên, đóng dấu', name: company.director },
    ],
    batch.postDate,
  )}`;
}

/* ============================ BẢNG KÊ LỆNH CHUYỂN KHOẢN ============================ */
function bankOrderList(batch, docs, company, names) {
  const list = bankPayments(docs);
  if (!list.length) return '';
  const total = list.reduce((t, p) => t + p.amount, 0);
  const pb = batch?.payBank || {};
  const rows = list
    .map(
      (p, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td><b>${esc(p.payee)}</b>${p.taxCode ? `<div class="tag">MST: ${esc(p.taxCode)}</div>` : ''}<div class="tag">${esc(p.no)} · ${esc(SHORT[p.doc.type] || '')}</div></td>
      <td class="acct">${esc(p.account)}</td>
      <td>${esc(p.bank)}${p.branch ? `<div class="tag">${esc(p.branch)}</div>` : ''}</td>
      <td class="r"><b>${money(p.amount)}</b></td>
      <td>${esc(p.content)}</td>
    </tr>`,
    )
    .join('');
  return `
  <header class="hd">
    <div class="org">
      <div>Đơn vị: <b>${esc(company.companyName)}</b></div>
      <div>Địa chỉ: ${esc(company.address)}</div>
      ${company.taxCode ? `<div>Mã số thuế: ${esc(company.taxCode)}</div>` : ''}
    </div>
    <div class="form">${batch ? `<div class="form-no">Kèm đợt ${esc(batch.code)}</div><div class="form-reg">Ngày ${esc(shortDate(batch.postDate))}</div>` : ''}</div>
  </header>
  <div class="tt single"><div class="mid">
    <h1>BẢNG KÊ LỆNH CHUYỂN KHOẢN</h1>
    <div class="date">${batch ? longDate(batch.postDate) : ''}</div>
  </div></div>
  <div class="body">
    ${f('Đơn vị trả tiền:', `<b>${esc(pb.accountName || company.companyName)}</b>`, { raw: true })}
    ${f('Tài khoản trích nợ:', pb.accountNo ? `<b class="acct">${esc(pb.accountNo)}</b> tại ${esc(pb.name || '')}` : esc(pb.name || ''), { raw: true })}
    ${f('Số món / tổng tiền:', `<b>${list.length} món — ${money(total)} đồng</b>`, { raw: true })}
  </div>
  <table class="grid bank">
    <thead><tr><th style="width:6%">STT</th><th style="width:25%">Đơn vị / người thụ hưởng</th><th style="width:17%">Số tài khoản</th><th style="width:17%">Ngân hàng – chi nhánh</th><th style="width:14%">Số tiền (đ)</th><th>Nội dung chuyển khoản</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="4" class="r"><b>Tổng cộng</b></td><td class="r"><b>${money(total)}</b></td><td></td></tr></tfoot>
  </table>
  <div class="body">${f('Số tiền bằng chữ:', `<i>${esc(words(total))}</i>`, { raw: true })}</div>
  <div class="note">Kế toán đối chiếu tên chủ tài khoản và số tài khoản trước khi lập lệnh trên ngân hàng điện tử (có thể nhập từ file Excel kèm theo). Sau khi chuyển, lưu ủy nhiệm chi / sao kê ngân hàng cùng bảng kê này.</div>
  ${signatures(
    [
      { role: 'Người lập', name: names.poster },
      { role: 'Kế toán trưởng', name: company.chiefAccountant },
      { role: 'Giám đốc (chủ tài khoản)', hint: 'Ký, họ tên, đóng dấu', name: company.director },
    ],
    batch?.postDate || null,
  )}`;
}

function attachmentPages(files) {
  const imgs = files.filter((x) => String(x.type || '').startsWith('image/'));
  const out = [];
  for (let i = 0; i < imgs.length; i += 2) {
    const pair = imgs.slice(i, i + 2);
    out.push(`<section class="page a4 att">${pair
      .map((x) => `<figure><img src="${x.dataUrl}" alt=""/><figcaption>${esc(x.voucherNo || '')} — ${esc(x.name)}</figcaption></figure>`)
      .join('')}</section>`);
  }
  return out.join('');
}

const css = (base) => `
@font-face { font-family: "Waasee Serif"; src: url("${base}WaaseeSerif-Regular.woff") format("woff"); font-weight: 400; font-style: normal; }
@font-face { font-family: "Waasee Serif"; src: url("${base}WaaseeSerif-Bold.woff") format("woff"); font-weight: 700; font-style: normal; }
@font-face { font-family: "Waasee Serif"; src: url("${base}WaaseeSerif-Italic.woff") format("woff"); font-weight: 400; font-style: italic; }
@font-face { font-family: "Waasee Serif"; src: url("${base}WaaseeSerif-BoldItalic.woff") format("woff"); font-weight: 700; font-style: italic; }
@page { size: A4 portrait; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: "Waasee Serif", "Times New Roman", Times, serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-kerning: normal; }
b { font-weight: 700; }
.page { width: 210mm; background: #fff; position: relative; break-after: page; page-break-after: always; overflow: hidden; }
.page:last-child { break-after: auto; page-break-after: auto; }
.a4 { min-height: 297mm; padding: 13mm 15mm 12mm 20mm; font-size: 12.5pt; line-height: 1.4; }
.a5pair { height: 297mm; }
.half { height: 148.5mm; padding: 7mm 11mm 5mm 15mm; font-size: 10.5pt; line-height: 1.35; overflow: hidden; position: relative; }
.half + .half { border-top: 1px dashed #777; }
.half + .half::before { content: "✂"; position: absolute; top: -9px; left: 5mm; font-size: 12px; color: #555; background: #fff; padding: 0 2px; font-family: sans-serif; }

.hd { display: grid; grid-template-columns: minmax(0, 1fr) 66mm; gap: 6mm; align-items: start; }
.half .hd { grid-template-columns: minmax(0, 1fr) 54mm; gap: 4mm; }
.org { line-height: 1.35; }
.form { text-align: center; line-height: 1.3; }
.form-no { font-weight: 700; }
.form-reg { font-size: .8em; font-style: italic; }

.tt { display: grid; grid-template-columns: 44mm minmax(0, 1fr) 44mm; align-items: start; margin: 5mm 0 3mm; }
.half .tt { grid-template-columns: 38mm minmax(0, 1fr) 38mm; margin: 3mm 0 1.5mm; }
.tt.single { display: block; text-align: center; }
.tt .mid { text-align: center; }
h1 { font-size: 1.45em; font-weight: 700; margin: 0; line-height: 1.2; }
.h1-sub { font-size: .85em; font-style: italic; }
.date { font-style: italic; margin-top: .6mm; }
.no { margin-top: .6mm; }
table.meta { border-collapse: collapse; font-size: .88em; margin-left: auto; line-height: 1.4; }
table.meta td { padding: 0 0 0 1.5mm; white-space: nowrap; vertical-align: top; }
table.meta td:first-child { padding-left: 0; }

.body { margin-top: 2mm; }
.to { text-align: left; margin: 1mm 0 1.5mm 22mm; }
.f { display: flex; align-items: baseline; gap: 1.6mm; margin-top: 1.1mm; }
.f .k { white-space: nowrap; }
.f .v { flex: 1; min-width: 0; border-bottom: 1px dotted #444; min-height: 1.3em; padding: 0 1mm; overflow-wrap: anywhere; }
.half .f { margin-top: .6mm; }
.acct { font-variant-numeric: tabular-nums; letter-spacing: 0; }

.box { margin-top: 3mm; border: 1px solid #000; padding: 1.5mm 3mm 2.5mm; break-inside: avoid; }
.box-t { font-weight: 700; font-size: .92em; }
.half .box { margin-top: 2mm; padding: 1mm 2.5mm 1.5mm; }

.signs { margin-top: 5mm; break-inside: avoid; page-break-inside: avoid; }
.half .signs { margin-top: 2.5mm; }
.sign-date { text-align: right; font-style: italic; margin-bottom: 1mm; padding-right: 3mm; }
table.sign { width: 100%; border-collapse: collapse; table-layout: fixed; }
table.sign td { text-align: center; vertical-align: top; padding: 0 1mm; }
table.sign tr.role td { font-weight: 700; vertical-align: bottom; }
.half table.sign tr.role td, .five table.sign tr.name td { font-size: .92em; }
table.sign tr.hint td { font-style: italic; font-size: .8em; }
table.sign tr.space td { height: 22mm; }
.half table.sign tr.space td { height: 12mm; }
table.sign tr.name td { font-weight: 700; }
.foot { margin-top: 4mm; font-size: .92em; }
.half .foot { margin-top: 1.5mm; }
.copy-note { text-align: right; font-style: italic; font-size: .85em; margin-top: 1.5mm; }

table.grid { width: 100%; border-collapse: collapse; margin-top: 3mm; }
table.grid th, table.grid td { border: 0.75pt solid #000; padding: 1.1mm 1.6mm; vertical-align: top; }
table.grid th { background: #efefef; font-weight: 700; text-align: center; vertical-align: middle; font-size: .92em; }
table.grid tr { break-inside: avoid; page-break-inside: avoid; }
table.items { font-size: .95em; }
table.settle { margin-left: auto; }
table.settle tr.hl td { background: #f6f6f6; }
table.sum { font-size: .88em; }
table.sum tr.tot td { background: #f6f6f6; }
table.list { font-size: .78em; table-layout: fixed; }
table.list th, table.list td { padding: .9mm 1.2mm; }
table.list td { overflow-wrap: anywhere; }
table.bank { font-size: .84em; table-layout: fixed; }
table.bank td { overflow-wrap: anywhere; }
tr.info td { color: #444; }
.tag { font-size: .86em; color: #333; }
.c { text-align: center; } .r { text-align: right; white-space: nowrap; } .nw { white-space: nowrap; }
.note { font-size: .82em; font-style: italic; margin-top: 3mm; }
.att { display: flex; flex-direction: column; gap: 6mm; }
.att figure { margin: 0; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 0; }
.att img { max-width: 100%; max-height: 125mm; object-fit: contain; border: 1px solid #ccc; }
.att figcaption { font-size: 10pt; margin-top: 2mm; }
@media screen {
  body { background: #d9dde3; padding: 14px 0 40px; }
  .page { margin: 0 auto 14px; box-shadow: 0 6px 24px rgba(15, 23, 42, .18); }
}
@media print {
  body { background: #fff; }
  .page { box-shadow: none; margin: 0; }
}
`;

/**
 * @param opts.batch     đợt kết chuyển (null khi in lẻ)
 * @param opts.docs      danh sách chứng từ theo thứ tự in (đã có số, định khoản)
 * @param opts.company   thông tin doanh nghiệp (đã gộp phần sửa tay trước khi in)
 * @param opts.paper     'A4' | 'A5'
 * @param opts.names     { [email]: tên hiển thị } — để in tên người lập phiếu
 * @param opts.preparer  tên người lập phiếu sửa tay (áp cho mọi chứng từ); trống = tự điền theo người lập
 * @param opts.poster    tên người kết chuyển
 * @param opts.cash      { before } tồn quỹ tiền mặt trước kết chuyển (tùy chọn)
 * @param opts.files     ảnh chứng từ gốc in kèm (tùy chọn)
 * @param opts.only      'all' | 'bank' — chỉ in bảng kê lệnh chuyển khoản
 */
export function buildPrintHtml({ batch = null, docs = [], company, paper = 'A4', names = {}, preparer = '', poster = '', cash = null, files = [], title = 'Chứng từ', only = 'all', fontBase = defaultFontBase() }) {
  const preparerOf = (d) => preparer || (d.auto ? names[d.postedBy] || poster : names[d.createdBy] || d.createdByName || '');
  const pages = [];
  const bankList = bankOrderList(batch, docs, company, { poster });
  if (only === 'bank') {
    if (bankList) pages.push(`<section class="page a4">${bankList}</section>`);
  } else {
    if (batch) pages.push(`<section class="page a4">${batchSummary(batch, docs, company, { poster }, cash)}</section>`);
    if (batch && bankList) pages.push(`<section class="page a4">${bankList}</section>`);
    if (paper === 'A5') {
      const halves = [];
      const flush = () => {
        if (!halves.length) return;
        pages.push(`<section class="page a5pair">${halves.map((h) => `<div class="half">${h}</div>`).join('')}</section>`);
        halves.length = 0;
      };
      for (const d of docs) {
        const html = renderDoc(d, company, { preparer: preparerOf(d) });
        if (fitsHalf(d)) {
          halves.push(html);
          if (halves.length === 2) flush();
        } else {
          flush();
          pages.push(`<section class="page a4">${html}</section>`);
        }
      }
      flush();
    } else {
      for (const d of docs) pages.push(`<section class="page a4">${renderDoc(d, company, { preparer: preparerOf(d) })}</section>`);
    }
    if (!batch && bankList && docs.some((d) => isBank(d) && d.type !== 'PT' && d.status === 'POSTED')) pages.push(`<section class="page a4">${bankList}</section>`);
    if (files.length) pages.push(attachmentPages(files));
  }
  return wrapPages(pages, { title, fontBase });
}

/**
 * Bọc các trang A4 thành tài liệu in hoàn chỉnh (phông nhúng, tự co theo khung xem trước).
 * extraCss: CSS riêng của mẫu in (bảng duyệt chi, lệnh chi…)
 */
export function wrapPages(pages, { title = 'Bản in', fontBase = defaultFontBase(), extraCss = '' } = {}) {
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${css(fontBase)}${extraCss}</style></head>
<body>${pages.join('\n') || '<section class="page a4"><p>Không có nội dung để in.</p></section>'}
<script>
(function(){
  function fit(){ var w = document.documentElement.clientWidth; var pw = 210 * 96 / 25.4 + 16; document.body.style.zoom = w < pw ? (w / pw).toFixed(3) : ''; }
  window.addEventListener('resize', fit); fit();
  window.matchMedia && window.matchMedia('print').addListener && window.matchMedia('print').addListener(function(m){ if (m.matches) document.body.style.zoom = ''; else fit(); });
  window.addEventListener('beforeprint', function(){ document.body.style.zoom = ''; });
  window.addEventListener('afterprint', fit);
})();
<\/script></body></html>`;
}

/** Có khoản chuyển khoản nào trong danh sách in không */
export const hasBankPayments = (docs) => bankPayments(docs).length > 0;

export { longDate, shortDate, accountName, esc, money, words, signatures, defaultFontBase };
