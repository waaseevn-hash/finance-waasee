/**
 * MẪU IN CHỨNG TỪ — Thông tư 200/2014/TT-BTC
 *   01-TT Phiếu thu · 02-TT Phiếu chi · 03-TT Giấy đề nghị tạm ứng · 05-TT Giấy đề nghị thanh toán (kèm bảng kê & quyết toán tạm ứng)
 *   + Trang 1: Bảng kê đợt kết xuất & kết chuyển
 * Khổ giấy: A4 (mỗi chứng từ một trang) hoặc 2 liên A5 trên một tờ A4 (cắt đôi theo đường kẻ).
 * Kết quả là một tài liệu HTML hoàn chỉnh (in bằng hộp thoại In của trình duyệt -> "Lưu thành PDF").
 */
import { moneyToWords } from './vnwords.js';
import { VTYPE, accountName, isPartial, itemAmount, ledgerLines, requestedAmount, settlement, voucherAmount } from './vouchers.js';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const money = (n) => (Math.round(Number(n) || 0)).toLocaleString('vi-VN');
const dateParts = (iso) => {
  const [y, m, d] = String(iso || '').split('-');
  return { d: d || '....', m: m || '....', y: y || '........' };
};
const longDate = (iso) => {
  const p = dateParts(iso);
  return `Ngày ${p.d} tháng ${p.m} năm ${p.y}`;
};
const shortDate = (iso) => {
  const p = dateParts(iso);
  return iso ? `${p.d}/${p.m}/${p.y}` : '';
};
const dots = (v, min = 0) => (v ? esc(v) : '<span class="dots">' + '.'.repeat(Math.max(min, 20)) + '</span>');

/** Chứng từ có in vừa nửa trang A5 không */
export function fitsHalf(v) {
  // GĐNTT có bảng quyết toán tạm ứng hoặc nhiều dòng chi phí: in trọn một trang A4
  if (v.type === 'TT') return (v.items || []).length <= 3 && !(Number(v.advanceAmount) > 0) && String(v.reason || '').length <= 140;
  return String(v.reason || '').length <= 260;
}

function header(company, v, title) {
  const t = VTYPE[v.type];
  const head = `
  <div class="hd">
    <div class="org">
      <div><b>Đơn vị:</b> ${esc(company.companyName)}</div>
      <div><b>Địa chỉ:</b> ${esc(company.address)}</div>
      ${company.taxCode ? `<div><b>MST:</b> ${esc(company.taxCode)}</div>` : ''}
    </div>
    <div class="form">
      <div class="form-no">${esc(t.form)}</div>
      <div class="form-reg">(Ban hành theo ${esc(company.regulation)})</div>
    </div>
  </div>`;
  const cashForm = v.type === 'PT' || v.type === 'PC';
  return `${head}
  <div class="title-row${cashForm ? '' : ' plain'}">
    <div class="title-mid">
      <h1>${esc(title)}</h1>
      <div class="date">${longDate(v.date)}</div>
      ${cashForm ? '' : `<div class="no-line">Số: <b>${esc(v.no || '(chưa cấp số)')}</b></div>`}
    </div>
    ${cashForm ? `<div class="meta">${metaBox(v, company)}</div>` : ''}
  </div>`;
}

function metaBox(v, company) {
  const rows = [];
  if (v.type === 'PT' || v.type === 'PC') rows.push(['Quyển số', v.bookNo || company.bookNo || '']);
  rows.push(['Số', v.no || '(chưa cấp số)']);
  if (v.type === 'PT') {
    rows.push(['Nợ', '1111']);
    rows.push(['Có', v.credit || '141']);
  }
  if (v.type === 'PC') {
    rows.push(['Nợ', v.debit || '642']);
    rows.push(['Có', '1111']);
  }
  return rows.map(([k, val]) => `<div><span>${k}:</span> <b>${esc(val)}</b></div>`).join('');
}

function signatures(cols, date) {
  return `<div class="signs">
  <div class="sign-date">${date ? longDate(date) : 'Ngày ..... tháng ..... năm .........'}</div>
  <table class="sign"><tr>${cols
    .map(
      (c) => `<td>
        <div class="role">${esc(c.role)}</div>
        <div class="hint">(${esc(c.hint || 'Ký, họ tên')})</div>
        <div class="space"></div>
        <div class="name">${esc(c.name || '')}</div>
      </td>`,
    )
    .join('')}</tr></table></div>`;
}

function line(label, value, cls = '') {
  return `<div class="ln ${cls}"><span class="lb">${label}</span> <span class="val">${value}</span></div>`;
}

/* ---------------- 01-TT PHIẾU THU ---------------- */
function receipt(v, company, names) {
  const amount = voucherAmount(v);
  return `
  ${header(company, v, 'PHIẾU THU')}
  <div class="body">
    ${line('Họ và tên người nộp tiền:', dots(v.person))}
    ${line('Địa chỉ:', dots(v.address || v.position))}
    ${line('Lý do nộp:', dots(v.reason))}
    ${line('Số tiền:', `<b>${money(amount)} đồng</b>`)}
    ${line('(Viết bằng chữ):', `<i>${esc(moneyToWords(amount))}</i>`)}
    ${line('Kèm theo:', `${dots(v.attachedDocs, 10)} <span class="lb">Chứng từ gốc.</span>`)}
  </div>
  ${signatures(
    [
      { role: 'Giám đốc', hint: 'Ký, họ tên, đóng dấu', name: company.director },
      { role: 'Kế toán trưởng', name: company.chiefAccountant },
      { role: 'Người nộp tiền', name: v.person },
      { role: 'Người lập phiếu', name: names.preparer },
      { role: 'Thủ quỹ', name: company.cashier },
    ],
    v.date,
  )}
  <div class="foot">
    ${line('Đã nhận đủ số tiền (viết bằng chữ):', '<span class="dots">' + '.'.repeat(90) + '</span>')}
    ${line('+ Tỷ giá ngoại tệ (vàng bạc, đá quý):', '<span class="dots">' + '.'.repeat(40) + '</span>')}
    ${line('+ Số tiền quy đổi:', '<span class="dots">' + '.'.repeat(60) + '</span>')}
  </div>`;
}

/* ---------------- 02-TT PHIẾU CHI ---------------- */
function payment(v, company, names) {
  const amount = voucherAmount(v);
  return `
  ${header(company, v, 'PHIẾU CHI')}
  <div class="body">
    ${line('Họ và tên người nhận tiền:', dots(v.person))}
    ${line('Địa chỉ:', dots(v.address || v.position))}
    ${line('Lý do chi:', dots(v.reason))}
    ${line('Số tiền:', `<b>${money(amount)} đồng</b>`)}
    ${line('(Viết bằng chữ):', `<i>${esc(moneyToWords(amount))}</i>`)}
    ${isPartial(v) ? line('Ghi chú:', `Duyệt chi một phần — số đề nghị ${money(requestedAmount(v))} đồng${v.approvalNote ? `. ${esc(v.approvalNote)}` : ''}`) : ''}
    ${line('Kèm theo:', `${dots(v.attachedDocs, 10)} <span class="lb">Chứng từ gốc.</span>`)}
  </div>
  ${signatures(
    [
      { role: 'Giám đốc', hint: 'Ký, họ tên, đóng dấu', name: company.director },
      { role: 'Kế toán trưởng', name: company.chiefAccountant },
      { role: 'Thủ quỹ', name: company.cashier },
      { role: 'Người lập phiếu', name: names.preparer },
      { role: 'Người nhận tiền', name: v.person },
    ],
    v.date,
  )}
  <div class="foot">
    ${line('Đã nhận đủ số tiền (viết bằng chữ):', '<span class="dots">' + '.'.repeat(90) + '</span>')}
    ${line('+ Tỷ giá ngoại tệ (vàng bạc, đá quý):', '<span class="dots">' + '.'.repeat(40) + '</span>')}
    ${line('+ Số tiền quy đổi:', '<span class="dots">' + '.'.repeat(60) + '</span>')}
  </div>`;
}

/* ---------------- 03-TT GIẤY ĐỀ NGHỊ TẠM ỨNG ---------------- */
function advanceRequest(v, company) {
  const amount = requestedAmount(v);
  const approved = voucherAmount(v);
  return `
  ${header(company, v, 'GIẤY ĐỀ NGHỊ TẠM ỨNG')}
  <div class="body">
    ${line('Kính gửi:', esc(company.addressee))}
    ${line('Tên tôi là:', dots(v.person))}
    ${line('Bộ phận (hoặc địa chỉ):', dots(v.position || v.address))}
    ${line('Đề nghị cho tạm ứng số tiền:', `<b>${money(amount)} đồng</b>`)}
    ${line('(Viết bằng chữ):', `<i>${esc(moneyToWords(amount))}</i>`)}
    ${isPartial(v) ? line('Số tiền được duyệt tạm ứng:', `<b>${money(approved)} đồng</b> <i>(${esc(moneyToWords(approved))})</i>${v.approvalNote ? ` — ${esc(v.approvalNote)}` : ''}`) : ''}
    ${line('Lý do tạm ứng:', dots(v.reason))}
    ${line('Thời hạn thanh toán:', v.dueDate ? esc(shortDate(v.dueDate)) : dots(''))}
  </div>
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

/* ---------------- 05-TT GIẤY ĐỀ NGHỊ THANH TOÁN ---------------- */
function paymentRequest(v, company) {
  const s = settlement(v);
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
  const partial = isPartial(v);
  const listed = requestedAmount(v);
  let settle = '';
  if (s.B > 0) {
    settle = `
    <table class="settle">
      ${partial ? `<tr><td>Tổng số tiền chi theo bảng kê</td><td class="r">${money(listed)}</td></tr>` : ''}
      <tr><td>${partial ? 'Số tiền được duyệt thanh toán' : 'Tổng số tiền chi theo bảng kê'} <b>(A)</b></td><td class="r"><b>${money(s.A)}</b></td></tr>
      <tr><td>Số tiền đã tạm ứng <b>(B)</b>${v.advanceNo ? ` — theo Giấy đề nghị tạm ứng số <b>${esc(v.advanceNo)}</b>` : ''}</td><td class="r"><b>${money(s.B)}</b></td></tr>
      ${
        s.refund > 0
          ? `<tr class="hl"><td>Số tạm ứng chi không hết (B − A) — nộp lại quỹ</td><td class="r"><b>${money(s.refund)}</b></td></tr>`
          : s.extra > 0
            ? `<tr class="hl"><td>Chi quá số tạm ứng (A − B) — đề nghị chi bổ sung</td><td class="r"><b>${money(s.extra)}</b></td></tr>`
            : `<tr class="hl"><td>Chênh lệch</td><td class="r"><b>0</b></td></tr>`
      }
    </table>`;
  }
  const diffWords =
    s.B > 0
      ? s.refund > 0
        ? `Số tạm ứng chi không hết (viết bằng chữ): <i>${esc(moneyToWords(s.refund))}</i>`
        : s.extra > 0
          ? `Số chi quá tạm ứng (viết bằng chữ): <i>${esc(moneyToWords(s.extra))}</i>`
          : ''
      : '';
  return `
  ${header(company, v, 'GIẤY ĐỀ NGHỊ THANH TOÁN')}
  <div class="body">
    ${line('Kính gửi:', esc(company.addressee))}
    ${line('Họ và tên người đề nghị thanh toán:', dots(v.person))}
    ${line('Bộ phận (hoặc địa chỉ):', dots(v.position || v.address))}
    ${line('Nội dung thanh toán:', dots(v.reason))}
  </div>
  <table class="items">
    <thead><tr><th style="width:7%">TT</th><th>Tên chi phí</th><th style="width:9%">ĐVT</th><th style="width:9%">SL</th><th style="width:15%">Đơn giá</th><th style="width:17%">Thành tiền</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="5" class="r"><b>Tổng cộng${partial ? '' : ' (A)'}</b></td><td class="r"><b>${money(listed)}</b></td></tr>${
      partial ? `<tr><td colspan="5" class="r"><b>Số tiền được duyệt thanh toán (A)</b></td><td class="r"><b>${money(s.A)}</b></td></tr>` : ''
    }</tfoot>
  </table>
  <div class="body">
    ${line(partial ? 'Số tiền được duyệt (viết bằng chữ):' : 'Số tiền (viết bằng chữ):', `<i>${esc(moneyToWords(s.A))}</i>`)}
    ${partial && v.approvalNote ? line('Ghi chú duyệt:', esc(v.approvalNote)) : ''}
  </div>
  ${settle}
  ${diffWords ? `<div class="body">${line('', diffWords)}</div>` : ''}
  <div class="body">${line('(Kèm theo', `${dots(v.attachedDocs, 8)} <span class="lb">chứng từ gốc)</span>`)}</div>
  ${signatures(
    [
      { role: 'Người đề nghị', name: v.person },
      { role: 'Kế toán', name: company.chiefAccountant },
      { role: 'Giám đốc', hint: 'Ký, họ tên, đóng dấu', name: company.director },
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

/* ---------------- TRANG 1: BẢNG KÊ ĐỢT KẾT CHUYỂN ---------------- */
const SHORT = { PT: 'Phiếu thu', PC: 'Phiếu chi', TU: 'GĐ tạm ứng', TT: 'GĐ thanh toán' };

function batchSummary(batch, docs, company, names, cash) {
  const rows = ledgerLines(docs).map((l, idx) => {
    const d = l.doc;
    const thu = !l.info && l.debit === '1111' ? l.amount : 0;
    const chi = !l.info && l.credit === '1111' ? l.amount : 0;
    return `<tr${l.info ? ' class="info"' : ''}>
        <td class="c">${idx + 1}</td>
        <td class="nw">${esc(d.no)}</td>
        <td class="c nw">${esc(shortDate(d.date))}</td>
        <td>${esc(SHORT[d.type] || '')}${d.auto ? ' <span class="tag">(tự động)</span>' : ''}</td>
        <td>${esc(d.person)}</td>
        <td>${esc(d.reason)}${l.info ? ` <span class="tag">(${money(voucherAmount(d))} đ — thanh toán qua phiếu ${d.type === 'TU' ? 'chi' : 'thu / chi'} tự động)</span>` : ''}</td>
        <td class="c">${esc(l.debit)}</td>
        <td class="c">${esc(l.credit)}</td>
        <td class="r">${thu ? money(thu) : ''}</td>
        <td class="r">${chi ? money(chi) : ''}</td>
      </tr>`;
  });
  const cashRows =
    cash && Number.isFinite(cash.before)
      ? `<tr><td>Tồn quỹ tiền mặt trước kết chuyển</td><td class="r">${money(cash.before)}</td></tr>
         <tr><td>Tồn quỹ tiền mặt sau kết chuyển</td><td class="r"><b>${money(cash.before + batch.net)}</b></td></tr>`
      : '';
  return `
  <div class="hd">
    <div class="org">
      <div><b>${esc(company.companyName)}</b></div>
      <div>${esc(company.address)}</div>
    </div>
    <div class="form"><div class="form-no">Đợt ${esc(batch.code)}</div></div>
  </div>
  <div class="title-mid single">
    <h1>BẢNG KÊ CHỨNG TỪ KẾT XUẤT &amp; KẾT CHUYỂN</h1>
    <div class="date">Ngày kết chuyển: ${esc(shortDate(batch.postDate))} · Người thực hiện: ${esc(names.poster || '')}</div>
  </div>
  <table class="kpi">
    <tr>
      <td><span>Số phiếu thu</span><b>${batch.receiptsCount}</b></td>
      <td><span>Tổng thu</span><b>${money(batch.receiptsTotal)}</b></td>
      <td><span>Số phiếu chi</span><b>${batch.paymentsCount}</b></td>
      <td><span>Tổng chi</span><b>${money(batch.paymentsTotal)}</b></td>
      <td><span>Chênh lệch (thu − chi)</span><b>${batch.net < 0 ? '−' : ''}${money(Math.abs(batch.net))}</b></td>
    </tr>
  </table>
  <table class="items list">
    <thead><tr><th style="width:5%">STT</th><th style="width:14%">Số CT</th><th style="width:9%">Ngày</th><th style="width:10%">Loại</th><th style="width:13%">Người nộp / nhận</th><th>Diễn giải</th><th style="width:5.5%">Nợ</th><th style="width:5.5%">Có</th><th style="width:10%">Thu</th><th style="width:10%">Chi</th></tr></thead>
    <tbody>${rows.join('')}</tbody>
    <tfoot><tr><td colspan="8" class="r"><b>Cộng</b></td><td class="r"><b>${money(batch.receiptsTotal)}</b></td><td class="r"><b>${money(batch.paymentsTotal)}</b></td></tr></tfoot>
  </table>
  ${cashRows ? `<table class="settle narrow">${cashRows}</table>` : ''}
  <div class="note">Các chứng từ trong đợt đã được ghi sổ quỹ tiền mặt và khóa sửa. Muốn điều chỉnh phải dùng chức năng "Hủy kết chuyển" (bút toán đảo) của Chủ doanh nghiệp.</div>
  ${signatures(
    [
      { role: 'Người lập', name: names.poster },
      { role: 'Kế toán trưởng', name: company.chiefAccountant },
      { role: 'Giám đốc', hint: 'Ký, họ tên, đóng dấu', name: company.director },
    ],
    batch.postDate,
  )}`;
}

function attachmentPages(files, landscapeHalf) {
  const imgs = files.filter((f) => String(f.type || '').startsWith('image/'));
  const out = [];
  for (let i = 0; i < imgs.length; i += 2) {
    const pair = imgs.slice(i, i + 2);
    out.push(`<section class="page a4 att">${pair
      .map((f) => `<figure><img src="${f.dataUrl}" alt=""/><figcaption>${esc(f.voucherNo || '')} — ${esc(f.name)}</figcaption></figure>`)
      .join('')}</section>`);
  }
  void landscapeHalf;
  return out.join('');
}

const CSS = `
@page { size: A4 portrait; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: "Times New Roman", "Noto Serif", "Liberation Serif", Tinos, serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 210mm; background: #fff; position: relative; break-after: page; page-break-after: always; overflow: hidden; }
.page:last-child { break-after: auto; page-break-after: auto; }
.a4 { min-height: 297mm; padding: 13mm 15mm 12mm; font-size: 12.5pt; }
.a5pair { height: 297mm; }
.half { height: 148.5mm; padding: 7mm 11mm 5mm; font-size: 10.2pt; overflow: hidden; position: relative; }
.half + .half { border-top: 1px dashed #888; }
.half + .half::before { content: "✂"; position: absolute; top: -9px; left: 4mm; font-size: 12px; color: #666; background: #fff; padding: 0 2px; font-family: sans-serif; }
.hd { display: flex; justify-content: space-between; gap: 10mm; line-height: 1.3; }
.org { max-width: 60%; }
.form { text-align: center; max-width: 40%; }
.form-no { font-weight: bold; }
.form-reg { font-size: .82em; font-style: italic; }
.title-row { position: relative; margin-top: 4mm; min-height: 15mm; }
.title-mid { text-align: center; padding: 0 30mm; }
.title-row.plain { min-height: 0; }
.title-row.plain .title-mid, .title-mid.single { padding: 0; }
.no-line { margin-top: .5mm; }
.title-mid.single { margin: 5mm 0 3mm; }
h1 { font-size: 1.55em; margin: 0; letter-spacing: .5px; }
.date { font-style: italic; margin-top: 1mm; }
.meta { position: absolute; right: 0; top: 0; font-size: .92em; line-height: 1.45; white-space: nowrap; }
.meta span { display: inline-block; min-width: 14mm; }
.body { margin-top: 3mm; line-height: 1.6; }
.half .body { margin-top: 2mm; line-height: 1.45; }
.ln { display: flex; gap: 2mm; }
.ln .lb { white-space: nowrap; }
.ln .val { flex: 1; }
.dots { color: #777; letter-spacing: 1px; overflow: hidden; }
.sign-date { text-align: right; font-style: italic; margin-top: 4mm; padding-right: 4mm; }
.half .sign-date { margin-top: 2mm; }
table.sign { width: 100%; border-collapse: collapse; margin-top: 1mm; table-layout: fixed; }
table.sign td { text-align: center; vertical-align: top; padding: 0 1mm; }
table.sign .role { font-weight: bold; }
table.sign .hint { font-style: italic; font-size: .82em; }
table.sign .space { height: 20mm; }
.half table.sign .space { height: 11mm; }
.signs { break-inside: avoid; page-break-inside: avoid; }
.list .signs, .summary .signs { margin-top: 2mm; }
table.items tr { break-inside: avoid; page-break-inside: avoid; }
tr.info td { color: #555; }
table.sign .name { font-weight: bold; min-height: 1.2em; }
.foot { margin-top: 3mm; font-size: .92em; line-height: 1.5; }
.half .foot { margin-top: 1mm; }
table.items { width: 100%; border-collapse: collapse; margin-top: 3mm; font-size: .95em; }
table.items th, table.items td { border: 1px solid #444; padding: 1.2mm 1.6mm; vertical-align: top; }
table.items th { background: #eef1f5; font-weight: bold; text-align: center; }
table.items.list { font-size: .76em; table-layout: fixed; }
table.items.list td { word-wrap: break-word; }
.summary table.sign .space { height: 14mm; }
.summary h1 { font-size: 1.35em; }
table.items .tag { font-size: .8em; font-style: italic; color: #555; }
.c { text-align: center; } .r { text-align: right; white-space: nowrap; } .nw { white-space: nowrap; }
table.settle { width: 100%; border-collapse: collapse; margin-top: 3mm; }
table.settle td { border: 1px solid #444; padding: 1.2mm 2mm; }
table.settle.narrow { width: 60%; margin-left: auto; font-size: .9em; }
table.settle tr.hl td { background: #fff6dc; }
table.kpi { width: 100%; border-collapse: collapse; margin-top: 2mm; }
table.kpi td { border: 1px solid #444; padding: 2mm; text-align: center; width: 20%; }
table.kpi span { display: block; font-size: .78em; }
table.kpi b { font-size: 1.05em; }
.note { font-size: .82em; font-style: italic; margin-top: 3mm; color: #333; }
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
 * @param opts.batch    đợt kết chuyển (null khi in lẻ)
 * @param opts.docs     danh sách chứng từ theo thứ tự in (đã có số, định khoản)
 * @param opts.company  thông tin doanh nghiệp
 * @param opts.paper    'A4' | 'A5'
 * @param opts.names    { [email]: tên hiển thị }
 * @param opts.poster   tên người kết chuyển
 * @param opts.cash     { before } tồn quỹ trước kết chuyển (tùy chọn)
 * @param opts.files    ảnh chứng từ gốc in kèm (tùy chọn)
 */
export function buildPrintHtml({ batch = null, docs = [], company, paper = 'A4', names = {}, poster = '', cash = null, files = [], title = 'Chứng từ' }) {
  const preparerOf = (d) => (d.auto ? names[d.postedBy] || poster : names[d.createdBy] || d.createdByName || '');
  const pages = [];
  if (batch) pages.push(`<section class="page a4 summary">${batchSummary(batch, docs, company, { poster }, cash)}</section>`);
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
  if (files.length) pages.push(attachmentPages(files));
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head>
<body>${pages.join('\n')}
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

export { longDate, shortDate, accountName };
