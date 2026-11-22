import { getCompanyName } from '../lib/brand.js';
import { fmtDate, fmtDateTime, monthLabel } from '../lib/dates.js';
import { fmtPct, fmtVND } from '../lib/format.js';
import { CERTAINTY, PRIORITY } from '../lib/constants.js';
import { findSupplier } from '../components/forms/supplierForms.jsx';

const MISSING = 'text-amber-700 italic';

/** Gộp các khoản phải trả NCC được chọn chi theo từng nhà cung cấp */
function supplierPayments(rows, suppliers) {
  const groups = new Map();
  for (const r of rows) {
    if (!r.selected || r.kind !== 'AP') continue;
    const sup = r.supplier || findSupplier(suppliers, { supplierId: r.supplierId, partnerName: r.partner }) || { name: r.partner };
    const key = r.supplierId || sup.name || r.partner;
    const g = groups.get(key) || { sup, items: [], amount: 0, modes: new Set() };
    g.items.push(r);
    g.amount += Number(r.amount) || 0;
    g.modes.add(r.mode === 'PART' ? 'PART' : 'FULL');
    groups.set(key, g);
  }
  return [...groups.values()];
}

const GROUP_OF = { AP: 'SUPPLIER', CUSTOM: 'FIXED', LOAN: 'BANK', INTEREST: 'BANK' };
const GROUP_LABEL = { SUPPLIER: 'Trả nhà cung cấp', FIXED: 'Chi cố định', BANK: 'Trả ngân hàng' };
const GROUP_ROWS = [
  ['SUPPLIER', 'A. Trả nhà cung cấp'],
  ['FIXED', 'B. Chi cố định (lương, thuế, vận hành…)'],
  ['BANK', 'C. Trả ngân hàng (lãi vay, đáo hạn)'],
];

/** Cân đối nguồn tiền; tính lại được cho cả bản chốt cũ (trước khi có "Tổng có" và giải ngân) */
function funding(s, t, paid) {
  const have = s.haveTotal ?? (Number(s.cashUsable) || 0) + (Number(s.depositUsable) || 0);
  const base = s.haveTotal != null ? s.baseSources : have + (Number(s.arIn) || 0);
  const groups = { SUPPLIER: 0, FIXED: 0, BANK: 0 };
  const count = { SUPPLIER: 0, FIXED: 0, BANK: 0 };
  for (const r of paid) {
    const g = r.group || GROUP_OF[r.kind] || 'FIXED';
    groups[g] += Number(r.amount) || 0;
    count[g] += 1;
  }
  const balance = base - (Number(t.payTotal) || 0);
  const shortfall = Math.max(0, -balance);
  const credit = Number(s.creditAvailable) || 0;
  const draw = Math.min(shortfall, credit);
  return { have, base, groups, count, balance, draw, uncovered: Math.max(0, shortfall - credit), drawPlan: t.drawPlan || [] };
}

const cell = 'border border-slate-300 px-2 py-1 text-[11px]';
const head = 'border border-slate-300 px-2 py-1 text-[10px] font-semibold uppercase bg-slate-100 text-left';
const R = 'text-right tabular-nums whitespace-nowrap';

/**
 * Báo cáo in A4 (dùng cho cả bản nháp và bản đã chốt).
 * `snap` có cấu trúc giống tài liệu plan_snapshots.
 * `variance` (tùy chọn) là kết quả computeVariance để in kèm đối chiếu.
 */
export default function PlanReport({ snap, variance, creatorName, suppliers = [] }) {
  const s = snap.sources;
  const t = snap.totals;
  const paid = snap.rows.filter((r) => r.selected);
  const deferred = snap.rows.filter((r) => !r.selected);
  const inRows = snap.arRows.filter((r) => r.selected);
  const supPays = supplierPayments(snap.rows, suppliers);
  const supTotal = supPays.reduce((x, g) => x + g.amount, 0);
  const f = funding(s, t, paid);

  return (
    <div className="text-slate-900 font-sans" style={{ fontSize: 12 }}>
      <div className="flex justify-between items-start border-b-2 border-slate-900 pb-2 mb-3">
        <div>
          <p className="text-[11px] font-semibold uppercase">{getCompanyName()}</p>
          <p className="text-[10px] text-slate-500">Tài liệu nội bộ – Tối mật</p>
        </div>
        <div className="text-right text-[10px] text-slate-500">
          Xuất lúc {fmtDateTime(new Date())}
        </div>
      </div>

      <h1 className="text-center text-lg font-bold uppercase">Kế hoạch điều phối dòng tiền</h1>
      <p className="text-center text-sm font-semibold">{monthLabel(snap.month)}</p>
      <p className="text-center text-[11px] text-slate-600 mt-1">
        {snap.version
          ? `Bản chốt số ${snap.version} · ${fmtDateTime(snap.createdAt)} · Người chốt: ${creatorName || ''}`
          : 'BẢN NHÁP – CHƯA CHỐT'}
      </p>
      {snap.note && <p className="text-center text-[11px] italic mt-1">Ghi chú: {snap.note}</p>}

      <h2 className="mt-4 mb-1 text-[12px] font-bold uppercase">I. Bảng tổng hợp chi trả & cân đối nguồn tiền</h2>
      <table className="w-full border-collapse print-avoid-break">
        <tbody>
          <tr>
            <td className={cell}>Tồn quỹ tiền mặt trong két</td>
            <td className={`${cell} ${R}`}>{fmtVND(s.cashBalance)}</td>
          </tr>
          <tr>
            <td className={cell}>Trừ: Quỹ dự phòng giữ lại tối thiểu</td>
            <td className={`${cell} ${R}`}>({fmtVND(s.reserve)})</td>
          </tr>
          <tr>
            <td className={cell}>Tiền gửi tài khoản ngân hàng {s.includeDeposits === false ? '(không tính)' : ''}</td>
            <td className={`${cell} ${R}`}>{fmtVND(s.depositUsable)}</td>
          </tr>
          <tr className="font-bold bg-emerald-50">
            <td className={cell}>(1) TỔNG CÓ = tiền mặt có thể dùng + tiền gửi tài khoản</td>
            <td className={`${cell} ${R}`}>{fmtVND(f.have)}</td>
          </tr>
          {s.arIn > 0 && (
            <tr>
              <td className={cell}>Cộng: Phải thu chắc chắn về trong tháng ({inRows.length} khoản)</td>
              <td className={`${cell} ${R}`}>{fmtVND(s.arIn)}</td>
            </tr>
          )}
          <tr className="font-bold">
            <td className={cell}>(2) TỔNG PHẢI CHI ({paid.length} khoản)</td>
            <td className={`${cell} ${R}`}>{fmtVND(t.payTotal)}</td>
          </tr>
          {GROUP_ROWS.map(([k, label]) => (
            <tr key={k}>
              <td className={`${cell} pl-6`}>
                {label} ({f.count[k]} khoản)
              </td>
              <td className={`${cell} ${R}`}>{fmtVND(f.groups[k])}</td>
            </tr>
          ))}
          <tr className={`font-bold text-[13px] ${f.balance < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
            <td className={cell}>(3) {f.balance < 0 ? 'THIẾU' : 'CÒN DƯ'} = (1){s.arIn > 0 ? ' + phải thu' : ''} − (2)</td>
            <td className={`${cell} ${R}`}>{fmtVND(Math.abs(f.balance))}</td>
          </tr>
          {f.balance < 0 && (
            <>
              <tr className="font-bold text-[13px] bg-sky-50">
                <td className={cell}>(4) CẦN GIẢI NGÂN TỪ HẠN MỨC VAY</td>
                <td className={`${cell} ${R}`}>{fmtVND(f.draw)}</td>
              </tr>
              {f.drawPlan.map((d, i) => (
                <tr key={i}>
                  <td className={`${cell} pl-6`}>
                    {d.name} (còn được vay {fmtVND(d.available)})
                  </td>
                  <td className={`${cell} ${R}`}>{fmtVND(d.amount)}</td>
                </tr>
              ))}
              {f.uncovered > 0 && (
                <tr className="text-rose-700 font-semibold">
                  <td className={cell}>Giải ngân hết hạn mức vẫn thiếu – cần hoãn bớt khoản P2/P3 hoặc giãn nợ</td>
                  <td className={`${cell} ${R}`}>{fmtVND(f.uncovered)}</td>
                </tr>
              )}
            </>
          )}
          <tr className="text-slate-600">
            <td className={cell}>Hạn mức vay còn được giải ngân (tham khảo)</td>
            <td className={`${cell} ${R}`}>{fmtVND(s.creditAvailable)}</td>
          </tr>
        </tbody>
      </table>

      {inRows.length > 0 && (
        <table className="w-full border-collapse mt-2">
          <thead>
            <tr>
              <th className={head}>Khách hàng</th>
              <th className={head}>Diễn giải</th>
              <th className={head}>Ngày dự kiến</th>
              <th className={head}>Mức độ</th>
              <th className={`${head} text-right`}>Dự kiến thu</th>
            </tr>
          </thead>
          <tbody>
            {inRows.map((r) => (
              <tr key={r.key}>
                <td className={cell}>{r.partner}</td>
                <td className={cell}>{r.label}</td>
                <td className={cell}>{fmtDate(r.dueDate)}</td>
                <td className={cell}>{CERTAINTY[r.certainty]?.label}</td>
                <td className={`${cell} ${R}`}>{fmtVND(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="mt-4 mb-1 text-[12px] font-bold uppercase">II. Chi tiết các khoản phải chi (theo thứ tự ưu tiên)</h2>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={head}>#</th>
            <th className={head}>Nội dung</th>
            <th className={head}>Đối tác / Nhóm</th>
            <th className={head}>Hạn</th>
            <th className={head}>Ưu tiên</th>
            <th className={`${head} text-right`}>Còn nợ</th>
            <th className={head}>Hình thức</th>
            <th className={`${head} text-right`}>Trả đợt này</th>
            <th className={`${head} text-right`}>Số dư lũy kế</th>
          </tr>
        </thead>
        <tbody>
          {paid.map((r, i) => (
            <tr key={r.key} className={r.overflow ? 'bg-sky-50' : ''}>
              <td className={cell}>{i + 1}</td>
              <td className={cell}>
                {r.label}
                <div className="text-[10px] text-slate-500">
                  {GROUP_LABEL[r.group || GROUP_OF[r.kind]]}
                  {r.kind === 'AP' && (r.approved ? ' · Đã duyệt chi' : ' · Chưa duyệt chi')}
                </div>
              </td>
              <td className={cell}>
                {r.partner}
                {r.payTo && <div className="text-[10px] text-slate-500">TK nhận: {r.payTo}</div>}
              </td>
              <td className={cell}>{fmtDate(r.dueDate)}</td>
              <td className={cell}>{PRIORITY[r.priority]?.short}</td>
              <td className={`${cell} ${R}`}>{fmtVND(r.outstanding)}</td>
              <td className={cell}>{r.kind === 'AP' || r.kind === 'LOAN' ? (r.mode === 'PART' ? 'Trả 1 phần' : 'Trả toàn bộ') : '—'}</td>
              <td className={`${cell} ${R} font-semibold`}>{fmtVND(r.amount)}</td>
              <td className={`${cell} ${R} ${r.runningAfter < 0 ? 'text-sky-800 font-semibold' : ''}`}>{fmtVND(r.runningAfter)}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className={cell} colSpan={7}>
              (2) TỔNG PHẢI CHI — P1: {fmtVND(t.byPriority.P1)} · P2: {fmtVND(t.byPriority.P2)} · P3: {fmtVND(t.byPriority.P3)}
            </td>
            <td className={`${cell} ${R}`}>{fmtVND(t.payTotal)}</td>
            <td className={cell} />
          </tr>
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-slate-500">Số dư lũy kế âm (tô xanh) = từ khoản đó trở đi phải dùng tiền giải ngân.</p>

      <h2 className="mt-4 mb-1 text-[12px] font-bold uppercase">III. Thông tin thanh toán nhà cung cấp (đợt chi này)</h2>
      {supPays.length === 0 ? (
        <p className="text-[11px] text-slate-600 border border-slate-300 px-2 py-1.5">Đợt chi này không có khoản phải trả nhà cung cấp nào được chọn.</p>
      ) : (
        <table className="w-full border-collapse print-avoid-break">
          <thead>
            <tr>
              <th className={head}>#</th>
              <th className={head}>Nhà cung cấp</th>
              <th className={head}>Mã số thuế</th>
              <th className={head}>Số tài khoản</th>
              <th className={head}>Ngân hàng – Chi nhánh</th>
              <th className={head}>Chủ tài khoản</th>
              <th className={head}>Nội dung thanh toán</th>
              <th className={head}>Hình thức</th>
              <th className={`${head} text-right`}>Số tiền chuyển</th>
            </tr>
          </thead>
          <tbody>
            {supPays.map((g, i) => (
              <tr key={i} className="align-top">
                <td className={cell}>{i + 1}</td>
                <td className={`${cell} font-semibold`}>
                  {g.sup.name}
                  {g.sup.phone && <div className="text-[10px] font-normal text-slate-500">ĐT: {g.sup.phone}</div>}
                </td>
                <td className={cell}>{g.sup.taxCode || <span className={MISSING}>Chưa có</span>}</td>
                <td className={`${cell} font-semibold tabular-nums`}>{g.sup.bankAccount || <span className={MISSING}>Chưa có</span>}</td>
                <td className={cell}>{[g.sup.bankName, g.sup.bankBranch].filter(Boolean).join(' – ') || <span className={MISSING}>Chưa có</span>}</td>
                <td className={cell}>{g.sup.accountHolder || <span className={MISSING}>Chưa có</span>}</td>
                <td className={cell}>{g.items.map((r) => r.label).filter(Boolean).join('; ')}</td>
                <td className={cell}>
                  {g.modes.size > 1 ? 'Toàn bộ + 1 phần' : g.modes.has('PART') ? 'Trả 1 phần' : 'Trả toàn bộ'}
                  <div className={`text-[10px] ${g.items.every((r) => r.approved) ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {g.items.every((r) => r.approved) ? 'Đã duyệt chi' : g.items.some((r) => r.approved) ? 'Duyệt 1 số khoản' : 'Chưa duyệt chi'}
                  </div>
                </td>
                <td className={`${cell} ${R} font-semibold`}>{fmtVND(g.amount)}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className={cell} colSpan={8}>
                TỔNG CHUYỂN KHOẢN CHO NHÀ CUNG CẤP ({supPays.length} đơn vị)
              </td>
              <td className={`${cell} ${R}`}>{fmtVND(supTotal)}</td>
            </tr>
          </tbody>
        </table>
      )}

      {deferred.length > 0 && (
        <>
          <h2 className="mt-4 mb-1 text-[12px] font-bold uppercase">IV. Các khoản tạm hoãn / chưa chi tháng này</h2>
          <table className="w-full border-collapse">
            <tbody>
              {deferred.map((r) => (
                <tr key={r.key}>
                  <td className={cell}>{r.label}</td>
                  <td className={cell}>{r.partner}</td>
                  <td className={cell}>{PRIORITY[r.priority]?.short}</td>
                  <td className={`${cell} ${R}`}>{fmtVND(r.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {variance && (
        <>
          <h2 className="mt-4 mb-1 text-[12px] font-bold uppercase">V. Đối chiếu kế hoạch – thực tế</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={head}>Chỉ tiêu</th>
                <th className={`${head} text-right`}>Kế hoạch</th>
                <th className={`${head} text-right`}>Thực tế</th>
                <th className={`${head} text-right`}>Tỷ lệ thực hiện</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={cell}>Thu từ khách hàng (theo kế hoạch)</td>
                <td className={`${cell} ${R}`}>{fmtVND(variance.totals.plannedIn)}</td>
                <td className={`${cell} ${R}`}>{fmtVND(variance.totals.actualIn)}</td>
                <td className={`${cell} ${R}`}>{variance.totals.inRate == null ? '—' : fmtPct(variance.totals.inRate, 0)}</td>
              </tr>
              <tr>
                <td className={cell}>Trả nhà cung cấp (theo kế hoạch)</td>
                <td className={`${cell} ${R}`}>{fmtVND(variance.totals.plannedOut)}</td>
                <td className={`${cell} ${R}`}>{fmtVND(variance.totals.actualOut)}</td>
                <td className={`${cell} ${R}`}>{variance.totals.outRate == null ? '—' : fmtPct(variance.totals.outRate, 0)}</td>
              </tr>
              <tr>
                <td className={cell}>Thu ngoài kế hoạch / Chi ngoài kế hoạch</td>
                <td className={`${cell} ${R}`}>—</td>
                <td className={`${cell} ${R}`}>
                  {fmtVND(variance.totals.unplannedIn)} / {fmtVND(variance.totals.unplannedOut)}
                </td>
                <td className={cell} />
              </tr>
            </tbody>
          </table>
        </>
      )}

      <div className="mt-10 grid grid-cols-3 text-center text-[11px] print-avoid-break">
        <div>
          <p className="font-semibold">Người lập</p>
          <p className="text-slate-500 italic">(Ký, ghi rõ họ tên)</p>
        </div>
        <div>
          <p className="font-semibold">Đồng quản trị</p>
          <p className="text-slate-500 italic">(Ký, ghi rõ họ tên)</p>
        </div>
        <div>
          <p className="font-semibold">Chủ doanh nghiệp duyệt</p>
          <p className="text-slate-500 italic">(Ký, ghi rõ họ tên)</p>
        </div>
      </div>
    </div>
  );
}
