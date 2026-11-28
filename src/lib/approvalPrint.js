/**
 * MẪU IN CHO SẾP VÀ BÀN GIAO KẾ TOÁN (không có mã tài khoản, không có mã hệ thống)
 *   1. BẢNG ĐỀ XUẤT & DUYỆT CHI THÁNG MM/YYYY — in từ Bảng điều phối tháng để Sếp duyệt bằng bút
 *   2. LỆNH CHI / BÀN GIAO THANH TOÁN — các khoản Sếp đã duyệt, Phần I chuyển khoản, Phần II tiền mặt
 * Dùng chung phông nhúng và khung trang A4 với mẫu chứng từ Thông tư 200 (voucherPrint.js).
 */
import { defaultFontBase, esc, longDate, money, shortDate, signatures, words, wrapPages } from './voucherPrint.js';

const EXTRA_CSS = `
.a4.sheet { font-size: 11.5pt; line-height: 1.35; }
.sheet h1 { font-size: 1.55em; letter-spacing: .01em; }
.kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 3mm; margin: 4mm 0 2mm; }
.kpi { border: 1.5pt solid #000; padding: 2mm 3mm 2.2mm; text-align: center; break-inside: avoid; }
.kpi .kl { font-weight: 700; font-size: .78em; letter-spacing: .02em; }
.kpi .kv { font-weight: 700; font-size: 1.35em; margin-top: .8mm; font-variant-numeric: tabular-nums; white-space: nowrap; }
.kpi .ks { font-size: .78em; font-style: italic; margin-top: .4mm; }
.kpi.neg { background: #f3f3f3; }
table.prop { font-size: .86em; table-layout: fixed; }
table.prop td { overflow-wrap: anywhere; vertical-align: middle; }
table.prop tr.grp td { background: #e9e9e9; font-weight: 700; }
table.prop tr.sub td { background: #f6f6f6; font-style: italic; }
table.prop tr.tot td { background: #e9e9e9; font-weight: 700; }
.tick { white-space: nowrap; line-height: 1.6; font-size: .95em; }
.write { display: block; border-bottom: 1px dotted #555; height: 5mm; }
.write + .write { margin-top: 1mm; }
.dots { display: inline-block; min-width: 70mm; border-bottom: 1px dotted #000; height: 1em; vertical-align: baseline; }
.decide { margin-top: 4mm; border: 1pt solid #000; padding: 2mm 3mm; break-inside: avoid; }
.decide .f { margin-top: 1.6mm; }
.part { margin-top: 5mm; font-weight: 700; font-size: 1.02em; break-after: avoid; }
.part .tag { font-weight: 400; font-style: italic; }
table.pay { font-size: .86em; table-layout: fixed; }
table.pay td { overflow-wrap: anywhere; vertical-align: middle; }
table.pay tfoot td { background: #efefef; font-weight: 700; }
.miss { font-style: italic; color: #555; }
.lead { margin-top: 2mm; }
`;

function orgHeader(company, right = '') {
  return `
  <header class="hd">
    <div class="org">
      <div>Đơn vị: <b>${esc(company.companyName)}</b></div>
      <div>Địa chỉ: ${esc(company.address)}</div>
      ${company.taxCode ? `<div>Mã số thuế: ${esc(company.taxCode)}</div>` : ''}
    </div>
    <div class="form">${right}</div>
  </header>`;
}

const PRIORITY_NAME = {
  P1: 'NHÓM P1 — BẮT BUỘC CHI (lương, thuế, đáo hạn ngân hàng, đối tác sống còn)',
  P2: 'NHÓM P2 — QUAN TRỌNG (nhà cung cấp vật tư chính)',
  P3: 'NHÓM P3 — CÓ THỂ GIÃN (thương lượng trả sau)',
};

/**
 * Bảng đề xuất & duyệt chi tháng.
 * @param opts.month      'YYYY-MM'
 * @param opts.available  tổng tiền có thể chi
 * @param opts.items      [{ priority:'P1'|'P2'|'P3', who, what, due, amount, note }]
 * @param opts.date       ngày lập (ISO)
 */
export function buildApprovalSheetHtml({ month, company, available = 0, items = [], date = '', preparer = '', fontBase = defaultFontBase() }) {
  const [y, m] = String(month || '').split('-');
  const label = m && y ? `${m}/${y}` : '';
  const total = items.reduce((t, it) => t + (Number(it.amount) || 0), 0);
  const diff = available - total;
  let stt = 0;
  const groups = ['P1', 'P2', 'P3']
    .map((p) => ({ p, list: items.filter((it) => (it.priority || 'P2') === p) }))
    .filter((g) => g.list.length);
  const body = groups
    .map((g) => {
      const sub = g.list.reduce((t, it) => t + (Number(it.amount) || 0), 0);
      const rows = g.list
        .map((it) => {
          stt += 1;
          return `<tr>
        <td class="c">${stt}</td>
        <td><b>${esc(it.who)}</b></td>
        <td>${esc(it.what)}${it.note ? `<div class="tag">${esc(it.note)}</div>` : ''}</td>
        <td class="c nw">${esc(shortDate(it.due)) || '—'}</td>
        <td class="r"><b>${money(it.amount)}</b>${it.part ? '<div class="tag">trả một phần</div>' : ''}</td>
        <td class="tick">☐ Chi<br/>☐ Hoãn</td>
        <td><span class="write"></span><span class="write"></span></td>
      </tr>`;
        })
        .join('');
      return `<tr class="grp"><td colspan="7">${esc(PRIORITY_NAME[g.p])} — ${g.list.length} khoản</td></tr>${rows}
      <tr class="sub"><td colspan="4" class="r">Cộng ${g.p}</td><td class="r"><b>${money(sub)}</b></td><td></td><td></td></tr>`;
    })
    .join('');

  const page = `
  ${orgHeader(company, `<div class="form-no">Lưu hành nội bộ</div><div class="form-reg">Trình Giám đốc duyệt</div>`)}
  <div class="tt single"><div class="mid">
    <h1>BẢNG ĐỀ XUẤT &amp; DUYỆT CHI THÁNG ${esc(label)}</h1>
    <div class="date">${date ? longDate(date) : 'Ngày ..... tháng ..... năm .........'}</div>
  </div></div>

  <div class="kpis">
    <div class="kpi"><div class="kl">TỔNG TIỀN CÓ THỂ CHI</div><div class="kv">${money(available)} đ</div><div class="ks">tiền mặt + tiền gửi + khoản thu chắc chắn</div></div>
    <div class="kpi"><div class="kl">TỔNG TIỀN ĐỀ XUẤT CHI</div><div class="kv">${money(total)} đ</div><div class="ks">${items.length} khoản</div></div>
    <div class="kpi${diff < 0 ? ' neg' : ''}"><div class="kl">CHÊNH LỆCH ${diff < 0 ? 'THIẾU' : 'THỪA'}</div><div class="kv">${diff < 0 ? '−' : ''}${money(Math.abs(diff))} đ</div><div class="ks">${diff < 0 ? 'cần hoãn bớt hoặc vay thêm' : 'đủ tiền chi hết đề xuất'}</div></div>
  </div>

  <table class="grid prop">
    <thead><tr>
      <th style="width:6%">STT</th>
      <th style="width:19%">Đối tác / Khoản chi</th>
      <th style="width:21%">Nội dung tóm tắt</th>
      <th style="width:12%">Hạn TT</th>
      <th style="width:14.5%">Số tiền đề xuất (đ)</th>
      <th style="width:10.5%">Duyệt (✓ / ✗)</th>
      <th>Số Sếp chốt &amp; Ghi chú</th>
    </tr></thead>
    <tbody>${body || '<tr><td colspan="7" class="c">Chưa chọn khoản chi nào trong bảng điều phối.</td></tr>'}</tbody>
    <tfoot><tr class="tot"><td colspan="4" class="r">TỔNG CỘNG ĐỀ XUẤT</td><td class="r">${money(total)}</td><td></td><td></td></tr></tfoot>
  </table>
  <div class="body">${f2('Bằng chữ:', `<i>${esc(words(total))}</i>`)}</div>

  <div class="decide">
    <div class="f"><span class="k"><b>Tổng số tiền Giám đốc duyệt chi:</b></span><span class="v"></span><span class="k">đồng</span></div>
    <div class="f"><span class="k">Viết bằng chữ:</span><span class="v"></span></div>
    <div class="f"><span class="k">Ý kiến khác:</span><span class="v"></span></div>
  </div>
  ${signatures(
    [
      { role: 'Người lập đề xuất', name: preparer },
      { role: 'Giám đốc phê duyệt', hint: 'Ký, họ tên', name: company.director },
    ],
    date,
  )}`;
  return wrapPages([`<section class="page a4 sheet">${page}</section>`], { title: `Bảng đề xuất & duyệt chi tháng ${label}`, fontBase, extraCss: EXTRA_CSS });
}

function f2(label, raw) {
  return `<div class="f"><span class="k">${label}</span><span class="v">${raw || '&nbsp;'}</span></div>`;
}

/**
 * Lệnh chi / bàn giao thanh toán.
 * @param opts.bank  [{ who, account, bank, branch, amount, content, requested }]
 * @param opts.cash  [{ who, what, amount, requested }]
 * @param opts.payFrom  { name, accountNo, accountName } tài khoản công ty trích tiền (tùy chọn)
 */
export function buildPayOrderHtml({ company, date = '', bank = [], cash = [], payFrom = null, preparer = '', fontBase = defaultFontBase() }) {
  const bt = bank.reduce((t, x) => t + (Number(x.amount) || 0), 0);
  const ct = cash.reduce((t, x) => t + (Number(x.amount) || 0), 0);
  const total = bt + ct;
  const bankRows = bank
    .map(
      (x, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td><b>${esc(x.who)}</b></td>
      <td class="acct">${x.account ? `<b>${esc(x.account)}</b>` : '<span class="miss">(chưa có số TK)</span>'}</td>
      <td>${esc(x.bank) || '<span class="miss">(chưa có)</span>'}${x.branch ? `<div class="tag">${esc(x.branch)}</div>` : ''}</td>
      <td class="r"><b>${money(x.amount)}</b>${x.requested > x.amount ? `<div class="tag">đề nghị ${money(x.requested)}</div>` : ''}</td>
      <td>${esc(x.content)}</td>
    </tr>`,
    )
    .join('');
  const cashRows = cash
    .map(
      (x, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td><b>${esc(x.who)}</b></td>
      <td>${esc(x.what)}</td>
      <td class="r"><b>${money(x.amount)}</b>${x.requested > x.amount ? `<div class="tag">đề nghị ${money(x.requested)}</div>` : ''}</td>
      <td></td>
    </tr>`,
    )
    .join('');

  const page = `
  ${orgHeader(company, `<div class="form-no">Lưu hành nội bộ</div><div class="form-reg">Kèm chứng từ gốc khi chốt sổ</div>`)}
  <div class="tt single"><div class="mid">
    <h1>LỆNH CHI / BÀN GIAO THANH TOÁN</h1>
    <div class="date">${date ? longDate(date) : 'Ngày ..... tháng ..... năm .........'}</div>
  </div></div>
  <p class="lead">Căn cứ các khoản Giám đốc đã phê duyệt, đề nghị Kế toán / Thủ quỹ thực hiện chi đúng số tiền được duyệt dưới đây:</p>

  <div class="part">Phần I. Chi chuyển khoản <span class="tag">— ${bank.length} món, ${money(bt)} đồng</span></div>
  ${
    bank.length
      ? `${payFrom?.name ? `<div class="body">${f2('Tài khoản trích nợ:', `${payFrom.accountNo ? `<b class="acct">${esc(payFrom.accountNo)}</b> tại ` : ''}${esc(payFrom.name)}`)}</div>` : ''}
  <table class="grid pay">
    <thead><tr><th style="width:6%">STT</th><th style="width:22%">Người / đơn vị thụ hưởng</th><th style="width:17%">Số tài khoản</th><th style="width:17%">Ngân hàng – chi nhánh</th><th style="width:15%">Số tiền Sếp duyệt (đ)</th><th>Nội dung chuyển khoản</th></tr></thead>
    <tbody>${bankRows}</tbody>
    <tfoot><tr><td colspan="4" class="r">Cộng Phần I</td><td class="r">${money(bt)}</td><td></td></tr></tfoot>
  </table>`
      : '<div class="body"><i>Không có khoản chuyển khoản.</i></div>'
  }

  <div class="part">Phần II. Chi tiền mặt <span class="tag">— ${cash.length} món, ${money(ct)} đồng</span></div>
  ${
    cash.length
      ? `<table class="grid pay">
    <thead><tr><th style="width:6%">STT</th><th style="width:26%">Người nhận tiền</th><th>Nội dung chi</th><th style="width:17%">Số tiền Sếp duyệt (đ)</th><th style="width:17%">Người nhận ký</th></tr></thead>
    <tbody>${cashRows}</tbody>
    <tfoot><tr><td colspan="3" class="r">Cộng Phần II</td><td class="r">${money(ct)}</td><td></td></tr></tfoot>
  </table>`
      : '<div class="body"><i>Không có khoản chi tiền mặt.</i></div>'
  }

  <div class="decide">
    ${f2('<b>Tổng cộng lệnh chi:</b>', `<b>${money(total)} đồng</b> (chuyển khoản ${money(bt)} · tiền mặt ${money(ct)})`)}
    ${f2('Bằng chữ:', `<i>${esc(words(total))}</i>`)}
  </div>
  <div class="note">Đối chiếu tên chủ tài khoản và số tài khoản trước khi lập lệnh trên ngân hàng điện tử. Chi xong bấm “Đã chi” trên app, lưu ủy nhiệm chi / chữ ký người nhận cùng bản này và chốt sổ cuối ngày.</div>
  ${signatures(
    [
      { role: 'Người lập', name: preparer },
      { role: 'Kế toán trưởng', name: company.chiefAccountant },
      { role: 'Thủ quỹ', name: company.cashier },
      { role: 'Giám đốc duyệt', hint: 'Ký, họ tên, đóng dấu', name: company.director },
    ],
    date,
  )}`;
  return wrapPages([`<section class="page a4 sheet">${page}</section>`], { title: 'Lệnh chi / bàn giao thanh toán', fontBase, extraCss: EXTRA_CSS });
}
