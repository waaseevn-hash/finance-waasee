/**
 * VIỆC CẦN LÀM — màn hình mở đầu của Kế toán.
 * 3 hàng đợi theo đúng trình tự công việc:
 *   1. Cần lập & Gửi duyệt
 *   2. Sếp đã duyệt — Cần chi ngay
 *   3. Sổ chi tiết & Lưu chứng từ (chốt sổ 111 / 112, in chứng từ Thông tư 200)
 * Mỗi tab có một dòng quy trình (SOP) thu gọn được.
 */
import { useEffect, useMemo, useState } from 'react';
import { BookCheck, ChevronDown, CircleCheck, FilePlus, Inbox, Landmark, Layers, ListChecks, Printer, Send, Wallet } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { fmtDate, todayISO } from '../lib/dates.js';
import { fmtVND } from '../lib/format.js';
import { batchFromDocs, docsOfBatch, isBank, voucherAmount } from '../lib/vouchers.js';
import { useToast } from '../components/feedback.jsx';
import { useToPay } from '../components/NotificationCenter.jsx';
import { useApprovalFlow } from '../components/forms/approvalForms.jsx';
import { VoucherEditor } from '../components/vouchers/VoucherEditor.jsx';
import { VoucherDrawer } from '../components/vouchers/VoucherDrawer.jsx';
import { MarkPaidModal } from '../components/vouchers/MarkPaidModal.jsx';
import { TYPE_ICON, TYPE_STYLE, VStatusBadge, VTypeChip } from '../components/vouchers/common.jsx';
import { PrintPreview } from '../components/vouchers/PrintPreview.jsx';
import { Money } from '../components/Money.jsx';
import { Badge, Button, Card, EmptyState, PageHeader, Tabs, TableWrap, cx, td, th } from '../components/ui.jsx';

const PADS = [
  { type: 'TU', title: 'Đề nghị tạm ứng' },
  { type: 'TT', title: 'Đề nghị thanh toán' },
  { type: 'PC', title: 'Phiếu chi' },
  { type: 'PT', title: 'Phiếu thu' },
];

const SOP = {
  1: [
    'Lập đề xuất (tạm ứng / thanh toán / phiếu chi), chụp kèm ảnh hóa đơn, chứng từ gốc → bấm “Gửi duyệt”. Sếp nhận thông báo ngay.',
    'Khoản bị từ chối: đọc lý do, sửa lại rồi gửi duyệt lần nữa.',
    'Công nợ nhà cung cấp đến hạn tự hiện cho Sếp duyệt — chỉ cần kiểm tra hạn thanh toán và số tài khoản ngân hàng của NCC ở “Công nợ đối tác”.',
  ],
  2: [
    'Chi đúng số Sếp đã chốt (không phải số đề nghị). Chuyển khoản: in lệnh chi để đối chiếu tên, số tài khoản, ngân hàng, nội dung.',
    'Chi tiền mặt: người nhận ký nhận. Chi xong bấm “Đã chi tiền” để Sếp thấy trạng thái.',
    'Công nợ nhà cung cấp: bấm “Đã chi” để ghi thanh toán vào công nợ.',
  ],
  3: [
    'Cuối ngày chọn các khoản đã chi → “Chốt sổ & in phiếu”: hệ thống cấp số phiếu, ghi sổ quỹ tiền mặt (TK 111) / tiền gửi (TK 112), khóa chứng từ.',
    'In phiếu thu / phiếu chi / giấy đề nghị theo Thông tư 200, trình ký, kẹp hóa đơn gốc và lưu hồ sơ theo số đợt KC.',
    'Cần in lại: mở đợt đã chốt ở bảng bên dưới.',
  ],
};

function SopLine({ tab }) {
  const key = `sop-open:${tab}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== '0';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(key) !== '0');
    } catch {
      /* bỏ qua */
    }
  }, [key]);
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(key, o ? '0' : '1');
      } catch {
        /* bỏ qua */
      }
      return !o;
    });
  };
  return (
    <div className="mx-3 mt-3 rounded-xl border border-amber-200 bg-amber-50/70 sm:mx-4">
      <button type="button" onClick={toggle} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-amber-900" aria-expanded={open}>
        <ListChecks className="h-4 w-4 shrink-0" />
        <span className="flex-1">Quy trình</span>
        <ChevronDown className={cx('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ol className="list-decimal space-y-1 px-3 pb-3 pl-8 text-sm text-amber-950/90">
          {SOP[tab].map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Dòng nhóm trong bảng (có vạch màu bên trái + tổng nhóm) */
function GroupRow({ tone, label, count, total, cols }) {
  return (
    <tr className={cx('dt-group', `dt-group-${tone}`)}>
      <td colSpan={cols - 1} className="px-3 py-2 text-[13px] font-semibold text-ink-900">
        {label} <span className="font-normal text-slate-500">({count})</span>
      </td>
      <td className="px-3 py-2 text-right text-[13px] font-semibold tabular-nums text-ink-900">{total != null ? fmtVND(total) : ''}</td>
    </tr>
  );
}

/* ================================================================== */
export default function Work({ params, navigate }) {
  const { actor, me } = useAuth();
  const data = useData();
  const toast = useToast();
  const email = me?.email || '';
  const vouchers = data.vouchers || [];
  const toPay = useToPay();
  const flow = useApprovalFlow({ ap: data.ap || [], approvals: data.approvals || [], suppliers: data.suppliers || [] });

  const [tab, setTab] = useState(params?.tab || '');
  useEffect(() => {
    if (params?.tab) setTab(params.tab);
  }, [params?.tab]);
  const [editor, setEditor] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [paying, setPaying] = useState(null);
  const [print, setPrint] = useState(null);

  const q = useMemo(() => {
    const mine = vouchers.filter((v) => !v.auto && v.requestedBy === email);
    const by = (s) => mine.filter((v) => v.status === s).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const rejected = by('REJECTED');
    const drafts = by('DRAFT');
    const waiting = by('PENDING');
    const approved = vouchers.filter((v) => !v.auto && v.status === 'APPROVED');
    const paid = approved.filter((v) => v.paidAt).sort((a, b) => String(a.paidAt).localeCompare(String(b.paidAt)));
    const unpaid = approved.filter((v) => !v.paidAt);
    const batches = [...(data.batches || [])].sort((a, b) => String(b.postDate || '').localeCompare(String(a.postDate || '')) || String(b.code || '').localeCompare(String(a.code || '')));
    return { rejected, drafts, waiting, approved, paid, unpaid, batches };
  }, [vouchers, email, data.batches]);

  const counts = { 1: q.rejected.length + q.drafts.length, 2: toPay.length, 3: q.paid.length };
  const active = tab || (counts[2] ? '2' : counts[1] ? '1' : counts[3] ? '3' : '1');
  const go = (t) => {
    setTab(t);
    window.history.replaceState(null, '', `#work-${t}`);
  };

  const sum = (list, f = voucherAmount) => list.reduce((t, x) => t + f(x), 0);
  const bankPay = toPay.filter((it) => it.bank);
  const cashPay = toPay.filter((it) => !it.bank);

  const toPost = (ids) => {
    try {
      sessionStorage.setItem('postSel', JSON.stringify(ids));
    } catch {
      /* bỏ qua */
    }
    navigate('vouchers?tab=post');
  };

  const tabs = [
    { value: '1', label: '1. Cần lập & Gửi duyệt', icon: FilePlus, count: counts[1] || null },
    { value: '2', label: '2. Sếp đã duyệt — Cần chi ngay', icon: Wallet, count: counts[2] || null },
    { value: '3', label: '3. Sổ chi tiết & Lưu chứng từ', icon: BookCheck, count: counts[3] || null },
  ];

  const vRow = (v, extra) => (
    <tr key={v.id} className="cursor-pointer" onClick={() => setOpenId(v.id)}>
      <td className={cx(td, 'w-0')}>
        <VTypeChip type={v.type} />
      </td>
      <td className={td}>
        <span className="block font-medium text-ink-900">{v.person}</span>
        <span className="block max-w-[28rem] truncate text-xs text-slate-500">{v.reason}</span>
        {v.status === 'REJECTED' && v.rejectReason && <span className="mt-0.5 block text-xs font-medium text-rose-700">Lý do từ chối: {v.rejectReason}</span>}
      </td>
      <td className={cx(td, 'hidden text-center sm:table-cell')}>{fmtDate(v.date)}</td>
      <td className={cx(td, 'hidden text-center md:table-cell')}>
        <VStatusBadge status={v.status} />
      </td>
      {extra}
      <td className={cx(td, 'text-right font-semibold tabular-nums text-ink-900')}>{fmtVND(voucherAmount(v))}</td>
    </tr>
  );

  return (
    <div>
      <PageHeader icon={ListChecks} tone="amber" title="Việc cần làm" subtitle={`Lập & gửi duyệt → chi khoản Sếp đã duyệt → chốt sổ & lưu chứng từ · ${fmtDate(todayISO())}`} />

      {/* Ba con số dẫn vào ba hàng đợi */}
      <div className="mb-5 grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { t: '1', label: 'Cần sửa / chưa gửi', value: counts[1], sub: q.waiting.length ? `${q.waiting.length} đang chờ Sếp` : 'Không có khoản chờ', icon: Send, tone: 'text-amber-700 bg-amber-50' },
          { t: '2', label: 'Cần chi ngay', value: counts[2], sub: fmtVND(toPay.reduce((s, it) => s + it.amount, 0)), icon: Wallet, tone: 'text-jade-700 bg-jade-50' },
          { t: '3', label: 'Đã chi, chờ chốt sổ', value: counts[3], sub: fmtVND(sum(q.paid)), icon: BookCheck, tone: 'text-sapphire-700 bg-sapphire-50' },
        ].map((x) => (
          <button
            key={x.t}
            type="button"
            onClick={() => go(x.t)}
            className={cx('rounded-2xl border bg-white p-3 text-left shadow-sm transition-colors sm:p-4', active === x.t ? 'border-ink-900 ring-1 ring-ink-900' : 'border-slate-200 hover:border-slate-300')}
          >
            <span className={cx('grid h-8 w-8 place-items-center rounded-lg', x.tone)}>
              <x.icon className="h-4 w-4" />
            </span>
            <span className="mt-2 block font-display text-2xl font-bold tabular-nums text-ink-900">{x.value}</span>
            <span className="block text-xs font-medium text-slate-700 sm:text-sm">{x.label}</span>
            <span className="block truncate text-[11px] text-slate-500 sm:text-xs">{x.sub}</span>
          </button>
        ))}
      </div>

      <Card>
        <div className="px-2 pt-1 sm:px-3">
          <Tabs value={active} onChange={go} tabs={tabs.map((t) => ({ ...t, activeClass: 'border-amber-600 text-ink-900', iconClass: active === t.value ? 'text-amber-600' : '' }))} />
        </div>
        <SopLine tab={active} />

        {/* ========================= 1. CẦN LẬP & GỬI DUYỆT ========================= */}
        {active === '1' && (
          <>
            <div className="grid grid-cols-2 gap-2 px-3 pt-3 sm:grid-cols-4 sm:px-4">
              {PADS.map((p) => {
                const Icon = TYPE_ICON[p.type];
                return (
                  <button
                    key={p.type}
                    type="button"
                    onClick={() => setEditor({ type: p.type })}
                    className="relative flex items-center gap-2.5 overflow-hidden rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm font-semibold text-ink-900 hover:border-slate-300 hover:bg-slate-50"
                  >
                    <span className={cx('absolute inset-y-0 left-0 w-1', TYPE_STYLE[p.type].bar)} />
                    <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-lg', TYPE_STYLE[p.type].icon)}>
                      <Icon className="h-4 w-4" />
                    </span>
                    + {p.title}
                  </button>
                );
              })}
            </div>
            {q.rejected.length + q.drafts.length + q.waiting.length === 0 ? (
              <EmptyState icon={Inbox} title="Không có đề xuất nào đang dở" description="Lập đề xuất mới bằng các nút bên trên. Khoản bị từ chối và nháp chưa gửi sẽ hiện ở đây." />
            ) : (
              <TableWrap>
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={cx(th, 'w-0')}>Loại</th>
                      <th className={th}>Người đề nghị · Nội dung</th>
                      <th className={cx(th, 'hidden text-center sm:table-cell')}>Ngày lập</th>
                      <th className={cx(th, 'hidden text-center md:table-cell')}>Trạng thái</th>
                      <th className={cx(th, 'text-right')}>Số tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.rejected.length > 0 && <GroupRow tone="red" label="Sếp từ chối — cần sửa và gửi lại" count={q.rejected.length} total={sum(q.rejected)} cols={5} />}
                    {q.rejected.map((v) => vRow(v))}
                    {q.drafts.length > 0 && <GroupRow tone="amber" label="Nháp — chưa gửi duyệt" count={q.drafts.length} total={sum(q.drafts)} cols={5} />}
                    {q.drafts.map((v) => vRow(v))}
                    {q.waiting.length > 0 && <GroupRow tone="blue" label="Đã gửi — đang chờ Sếp duyệt" count={q.waiting.length} total={sum(q.waiting)} cols={5} />}
                    {q.waiting.map((v) => vRow(v))}
                  </tbody>
                </table>
              </TableWrap>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3 text-sm text-slate-600 sm:px-5">
              <Landmark className="h-4 w-4 text-slate-400" />
              <span className="flex-1">Công nợ nhà cung cấp đến hạn được đưa thẳng cho Sếp duyệt.</span>
              <Button size="sm" onClick={() => navigate('partners?tab=ap')}>
                Kiểm tra công nợ phải trả
              </Button>
            </div>
          </>
        )}

        {/* ========================= 2. SẾP ĐÃ DUYỆT — CẦN CHI NGAY ========================= */}
        {active === '2' &&
          (toPay.length === 0 ? (
            <EmptyState icon={CircleCheck} title="Không có khoản nào cần chi" description="Khi Sếp duyệt một đề xuất hoặc công nợ, khoản đó hiện ở đây kèm thông báo." />
          ) : (
            <TableWrap>
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={cx(th, 'w-0 text-center')}>STT</th>
                    <th className={th}>Người nhận · Nội dung</th>
                    <th className={cx(th, 'hidden lg:table-cell')}>Tài khoản nhận</th>
                    <th className={cx(th, 'hidden text-center sm:table-cell')}>Ngày duyệt</th>
                    <th className={cx(th, 'text-right')}>Số Sếp duyệt</th>
                    <th className={cx(th, 'w-0 text-center')}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { list: bankPay, tone: 'blue', label: 'Chuyển khoản' },
                    { list: cashPay, tone: 'green', label: 'Tiền mặt' },
                  ].map((g) =>
                    g.list.length === 0
                      ? null
                      : [
                          <tr key={`g-${g.label}`} className={cx('dt-group', `dt-group-${g.tone}`)}>
                            <td colSpan={4} className="px-3 py-2 text-[13px] font-semibold text-ink-900">
                              {g.label} <span className="font-normal text-slate-500">({g.list.length})</span>
                            </td>
                            <td className="px-3 py-2 text-right text-[13px] font-semibold tabular-nums text-ink-900">{fmtVND(g.list.reduce((s, it) => s + it.amount, 0))}</td>
                            <td />
                          </tr>,
                          ...g.list.map((it, i) => (
                            <tr key={it.key}>
                              <td className={cx(td, 'text-center text-slate-500')}>{i + 1}</td>
                              <td className={td}>
                                <button type="button" className="block text-left" onClick={() => (it.kind === 'V' ? setOpenId(it.id) : navigate('partners?tab=chi'))}>
                                  <span className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-medium text-ink-900">{it.who}</span>
                                    {it.kind === 'V' ? <VTypeChip type={it.v.type} /> : <Badge tone="red">Công nợ NCC</Badge>}
                                  </span>
                                  <span className="block max-w-[26rem] truncate text-xs text-slate-500">{it.what}</span>
                                  {it.payee && (
                                    <span className="block text-xs text-sapphire-700 lg:hidden">
                                      {it.payee.account} · {it.payee.bank}
                                    </span>
                                  )}
                                </button>
                              </td>
                              <td className={cx(td, 'hidden lg:table-cell')}>
                                {it.payee ? (
                                  <span className="text-xs">
                                    <span className="block font-medium text-ink-900">{it.payee.name}</span>
                                    <span className="block font-mono">{it.payee.account}</span>
                                    <span className="block text-slate-500">{[it.payee.bank, it.payee.branch].filter(Boolean).join(' – ')}</span>
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-400">{it.bank ? 'Thiếu số tài khoản' : '—'}</span>
                                )}
                              </td>
                              <td className={cx(td, 'hidden text-center sm:table-cell')}>{fmtDate(it.date)}</td>
                              <td className={cx(td, 'text-right font-semibold tabular-nums text-ink-900')}>
                                {fmtVND(it.amount)}
                                {it.kind === 'V' && it.requested > it.amount && <span className="block text-[11px] font-normal text-slate-500">đề nghị {fmtVND(it.requested)}</span>}
                              </td>
                              <td className={cx(td, 'text-center')}>
                                <Button size="sm" variant="jade" icon={Wallet} onClick={() => (it.kind === 'V' ? setPaying(it.v) : flow.execute(it.order.debt, it.order))}>
                                  Đã chi
                                </Button>
                              </td>
                            </tr>
                          )),
                        ],
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} className="px-3 py-2.5 text-sm">
                      Tổng cần chi ({toPay.length} khoản)
                    </td>
                    <td className="px-3 py-2.5 text-right text-sm tabular-nums">{fmtVND(toPay.reduce((s, it) => s + it.amount, 0))}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </TableWrap>
          ))}

        {/* ========================= 3. SỔ CHI TIẾT & LƯU CHỨNG TỪ ========================= */}
        {active === '3' && (
          <>
            <div className="flex flex-wrap items-center gap-2 px-4 pt-3 sm:px-5">
              <p className="flex-1 text-sm text-slate-600">
                <b className="text-ink-900">{q.paid.length}</b> khoản đã chi chờ chốt sổ · <Money value={sum(q.paid)} className="font-semibold text-ink-900" />
                {q.unpaid.length > 0 && <span className="text-slate-500"> · {q.unpaid.length} khoản đã duyệt chưa chi</span>}
              </p>
              <Button variant="primary" icon={BookCheck} disabled={!q.approved.length} onClick={() => toPost(q.paid.map((v) => v.id))}>
                Chốt sổ & in phiếu{q.paid.length ? ` (${q.paid.length})` : ''}
              </Button>
            </div>
            {q.approved.length === 0 ? (
              <EmptyState icon={BookCheck} title="Không có khoản chờ chốt sổ" description="Khoản đã duyệt và đã chi sẽ nằm ở đây để ghi sổ quỹ và in phiếu." />
            ) : (
              <TableWrap>
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={cx(th, 'w-0')}>Loại</th>
                      <th className={th}>Người · Nội dung</th>
                      <th className={cx(th, 'hidden text-center sm:table-cell')}>Sổ ghi</th>
                      <th className={cx(th, 'hidden text-center md:table-cell')}>Ngày chi</th>
                      <th className={cx(th, 'text-right')}>Số tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.paid.length > 0 && <GroupRow tone="green" label="Đã chi — sẵn sàng chốt sổ" count={q.paid.length} total={sum(q.paid)} cols={5} />}
                    {q.paid.map((v) => (
                      <tr key={v.id} className="cursor-pointer" onClick={() => setOpenId(v.id)}>
                        <td className={cx(td, 'w-0')}>
                          <VTypeChip type={v.type} />
                        </td>
                        <td className={td}>
                          <span className="block font-medium text-ink-900">
                            {v.person} {v.no && <span className="font-mono text-[11px] font-normal text-slate-500">{v.no}</span>}
                          </span>
                          <span className="block max-w-[28rem] truncate text-xs text-slate-500">{v.reason}</span>
                        </td>
                        <td className={cx(td, 'hidden text-center sm:table-cell')}>
                          <Badge tone={isBank(v) ? 'blue' : 'green'}>{isBank(v) ? '112 · Tiền gửi' : '111 · Tiền mặt'}</Badge>
                        </td>
                        <td className={cx(td, 'hidden text-center md:table-cell')}>{fmtDate(v.paidAt)}</td>
                        <td className={cx(td, 'text-right font-semibold tabular-nums text-ink-900')}>{fmtVND(voucherAmount(v))}</td>
                      </tr>
                    ))}
                    {q.unpaid.length > 0 && <GroupRow tone="amber" label="Đã duyệt — chưa báo đã chi" count={q.unpaid.length} total={sum(q.unpaid)} cols={5} />}
                    {q.unpaid.map((v) => (
                      <tr key={v.id} className="cursor-pointer text-slate-500" onClick={() => setOpenId(v.id)}>
                        <td className={cx(td, 'w-0')}>
                          <VTypeChip type={v.type} />
                        </td>
                        <td className={td}>
                          <span className="block font-medium text-ink-900">{v.person}</span>
                          <span className="block max-w-[28rem] truncate text-xs">{v.reason}</span>
                        </td>
                        <td className={cx(td, 'hidden text-center sm:table-cell')}>{isBank(v) ? '112' : '111'}</td>
                        <td className={cx(td, 'hidden text-center md:table-cell')}>—</td>
                        <td className={cx(td, 'text-right tabular-nums')}>{fmtVND(voucherAmount(v))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}

            <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 pt-4 sm:px-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                <Layers className="h-4 w-4 text-slate-500" /> Các lần chốt sổ gần đây
              </p>
              <Button size="sm" onClick={() => navigate('vouchers?tab=batches')}>
                Xem tất cả
              </Button>
            </div>
            {q.batches.length === 0 ? (
              <p className="px-4 py-4 text-sm text-slate-500 sm:px-5">Chưa có lần chốt sổ nào.</p>
            ) : (
              <TableWrap>
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={th}>Đợt</th>
                      <th className={cx(th, 'text-center')}>Ngày chốt</th>
                      <th className={cx(th, 'hidden text-center sm:table-cell')}>Chứng từ</th>
                      <th className={cx(th, 'hidden text-right md:table-cell')}>Thu</th>
                      <th className={cx(th, 'text-right')}>Chi</th>
                      <th className={cx(th, 'w-0 text-center')}>In</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.batches.slice(0, 8).map((b) => (
                      <tr key={b.id}>
                        <td className={td}>
                          <span className="font-mono text-[13px] font-semibold text-ink-900">{b.code}</span>
                          {b.status === 'REVERSED' && <Badge tone="red" className="ml-1.5">Đã hủy</Badge>}
                          {b.status === 'PARTIAL' && <Badge tone="amber" className="ml-1.5">Hủy {b.reversedCount}</Badge>}
                        </td>
                        <td className={cx(td, 'text-center')}>{fmtDate(b.postDate)}</td>
                        <td className={cx(td, 'hidden text-center sm:table-cell')}>{(b.voucherIds || []).length + (b.generatedIds || []).length}</td>
                        <td className={cx(td, 'hidden text-right tabular-nums md:table-cell')}>{fmtVND((b.receiptsTotal || 0) + (b.bankInTotal || 0))}</td>
                        <td className={cx(td, 'text-right tabular-nums')}>{fmtVND((b.paymentsTotal || 0) + (b.bankTotal || 0))}</td>
                        <td className={cx(td, 'text-center')}>
                          <Button size="iconSm" variant="ghost" icon={Printer} aria-label={`In lại ${b.code}`} title="In lại" onClick={() => reprint(b)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </>
        )}
      </Card>

      {editor && <VoucherEditor key={editor.existing?.id || editor.type} type={editor.type} existing={editor.existing || null} prefill={editor.prefill || null} onClose={() => setEditor(null)} onSaved={(id) => setOpenId(id)} />}
      {openId && !editor && (
        <VoucherDrawer
          id={openId}
          onClose={() => setOpenId(null)}
          onOpen={setOpenId}
          onEdit={(v) => setEditor({ existing: v })}
          onPrint={(docs, name) => setPrint({ docs, batch: null, title: `Bản in ${name}`, fileBase: `Chung-tu_${name}`, paper: 'A4' })}
          onPostBank={(v) => {
            setOpenId(null);
            toPost([v.id]);
          }}
          onPosted={(res) => setPrint({ docs: res.docs, batch: res.batch, title: `Chốt sổ — đợt ${res.batch.code}`, fileBase: `Chot-so_${res.batch.code}`, paper: 'A4' })}
        />
      )}
      {paying && <MarkPaidModal v={paying} onClose={() => setPaying(null)} />}
      {flow.modals}
      <PrintPreview
        open={!!print}
        onClose={() => setPrint(null)}
        title={print?.title}
        fileBase={print?.fileBase}
        batch={print?.batch || null}
        docs={print?.docs || []}
        poster={actor?.name || ''}
        cash={null}
        defaultPaper={print?.paper || 'A4'}
      />
    </div>
  );

  function reprint(b) {
    const docs = docsOfBatch(b, vouchers);
    if (!docs.length) return toast.info('Các chứng từ của đợt này đã được hủy chốt sổ.');
    setPrint({ docs, batch: batchFromDocs(b, docs), title: `In lại đợt ${b.code}`, fileBase: `Chot-so_${b.code}`, paper: 'A4' });
  }
}
