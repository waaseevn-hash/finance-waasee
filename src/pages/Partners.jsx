import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, increment, onSnapshot, query, where } from 'firebase/firestore';
import {
  CircleArrowDown,
  CircleArrowUp,
  FileSpreadsheet,
  HandCoins,
  History,
  Pencil,
  Plus,
  Search,
  Trash2,
  Wallet,
  Building2,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  ReceiptText,
  TriangleAlert,
  Stamp,
} from 'lucide-react';
import { db } from '../lib/firebase.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { AuditedBatch, C, friendlyError } from '../lib/db.js';
import { apSummary, arSummary, debtTotals, paymentTotals, remaining, tsMillis } from '../lib/calc.js';
import { currentMonth, daysBetween, describeDays, fmtDate, monthLabel, monthRange, todayISO } from '../lib/dates.js';
import { fmtVND, matchSearch } from '../lib/format.js';
import { CERTAINTY, PAY_METHOD, PRIORITY } from '../lib/constants.js';
import { can } from '../lib/roles.js';
import { downloadXlsx } from '../lib/xlsx.js';
import { Who } from '../components/Who.jsx';
import { DebtModal, HistoryModal, KIND, PaymentModal, deleteDebt, raw } from '../components/forms/debtForms.jsx';
import { SUPPLIER_KEYS, SupplierCard, SupplierInfo, SupplierModal, findSupplier, pickSupplier } from '../components/forms/supplierForms.jsx';
import { useQuick } from '../components/QuickPanels.jsx';
import { ApprovalBadge, PayOrdersPanel, useApprovalFlow } from '../components/forms/approvalForms.jsx';
import { openPayOrders } from '../lib/approvals.js';
import { Money, MoneyInput } from '../components/Money.jsx';
import { Figure } from '../components/Figure.jsx';
import { useConfirm, useToast } from '../components/feedback.jsx';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Modal,
  MonthPicker,
  PageHeader,
  StatTile,
  Segmented,
  Select,
  TableWrap,
  Tabs,
  Textarea,
  cx,
  td,
  th,
} from '../components/ui.jsx';

/* --------------------------------- Trang --------------------------------- */
export default function Partners({ params, navigate }) {
  const { ar, ap, loaded, suppliers, approvals } = useData();
  const { actor, role } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const quick = useQuick();
  const tab = ['ap', 'ncc', 'chi'].includes(params?.tab) ? params.tab : 'ar';
  const flow = useApprovalFlow({ ap, approvals, suppliers });
  const orders = useMemo(() => openPayOrders(approvals, ap, suppliers), [approvals, ap, suppliers]);
  const ordersTotal = orders.reduce((s, o) => s + o.payAmount, 0);
  const kind = tab === 'ap' ? 'ap' : 'ar';
  const [supplierModal, setSupplierModal] = useState(null);
  const cfg = KIND[kind];
  const list = kind === 'ar' ? ar : ap;
  const today = todayISO();

  const [status, setStatus] = useState('OPEN');
  const [level, setLevel] = useState('ALL');
  const [q, setQ] = useState('');
  const [debtModal, setDebtModal] = useState(null);
  const [payDebt, setPayDebt] = useState(null);
  const [histDebt, setHistDebt] = useState(null);

  useEffect(() => {
    setLevel('ALL');
  }, [kind]);

  const partnerNames = useMemo(() => [...new Set([...ar, ...ap].map((r) => r.partnerName).filter(Boolean))].sort(), [ar, ap]);
  const sAr = useMemo(() => arSummary(ar, today), [ar, today]);
  const sAp = useMemo(() => apSummary(ap, today), [ap, today]);

  const rows = useMemo(
    () =>
      list
        .map((r) => ({ ...r, remain: remaining(r), days: r.dueDate ? daysBetween(today, r.dueDate) : null }))
        .filter((r) => (status === 'OPEN' ? r.remain > 0 : status === 'DONE' ? r.remain <= 0 : true))
        .filter((r) => level === 'ALL' || (r[cfg.levelField] || cfg.defaultLevel) === level)
        .filter((r) => matchSearch(`${r.partnerName} ${r.description} ${r.note}`, q))
        .sort((a, b) => (b.remain > 0) - (a.remain > 0) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999')),
    [list, status, level, q, today, cfg],
  );

  // Cộng các dòng đang hiển thị (theo bộ lọc)
  const footer = useMemo(() => debtTotals(rows), [rows]);

  // Lấy bản ghi mới nhất (realtime) cho các modal đang mở
  const fresh = (d) => (d ? list.find((x) => x.id === d.id) || d : null);

  const removeDebt = async (r) => {
    const ok = await confirm({
      title: `Xóa công nợ ${cfg.name}?`,
      message: `${r.partnerName} — ${fmtVND(r.total)}. Toàn bộ lịch sử thanh toán của khoản này cũng bị xóa (phiếu sổ quỹ tiền mặt liên quan được giữ nguyên). Mọi thao tác được lưu trong Nhật ký.`,
      confirmText: 'Xóa công nợ',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDebt(actor, kind, r);
      toast.success('Đã xóa công nợ');
    } catch (ex) {
      toast.error(friendlyError(ex));
    }
  };

  const exportXlsx = () => {
    const done = downloadXlsx(`Cong-no-${kind === 'ar' ? 'phai-thu' : 'phai-tra'}_${today}`, [
      {
        name: kind === 'ar' ? 'Phải thu' : 'Phải trả',
        colWidths: [28, 36, 16, 16, 16, 14, 18, 30],
        rows: [
          ['Đối tác', 'Diễn giải', 'Tổng công nợ', cfg.paidLabel, cfg.remainLabel, cfg.dueLabel, cfg.levelLabel, 'Ghi chú'],
          ...rows.map((r) => [
            r.partnerName,
            r.description || '',
            r.total,
            r.paid || 0,
            r.remain,
            r.dueDate ? fmtDate(r.dueDate) : '',
            cfg.levels[r[cfg.levelField] || cfg.defaultLevel]?.label || '',
            r.note || '',
          ]),
          [
            `Cộng ${rows.length} khoản`,
            '',
            { f: `SUM(C2:C${rows.length + 1})`, v: footer.total, s: 'moneyBold' },
            { f: `SUM(D2:D${rows.length + 1})`, v: footer.paid, s: 'moneyBold' },
            { f: `SUM(E2:E${rows.length + 1})`, v: footer.remain, s: 'moneyBold' },
          ],
        ],
      },
    ]);
    done.then(() => toast.success('Đã xuất file Excel')).catch((ex) => ex?.code !== 'declined' && toast.error(friendlyError(ex)));
  };

  const tiles =
    kind === 'ar'
      ? [
          ['Tổng còn phải thu', sAr.total, 'lagoon', 'solid', HandCoins, 'all'],
          ['Trong hạn', sAr.inTerm, 'jade', 'soft', CircleCheck, 'inTerm'],
          ['Quá hạn', sAr.overdue, 'rose', 'soft', TriangleAlert, 'overdue'],
          ['Nợ khó đòi', sAr.doubtful, 'vermilion', 'soft', CircleAlert, 'doubtful'],
        ]
      : [
          ['Tổng còn phải trả', sAp.total, 'vermilion', 'solid', ReceiptText, 'all'],
          ['Đến hạn trong tháng', sAp.dueThisMonth, 'amber', 'soft', CalendarClock, 'month'],
          ['Đã quá hạn', sAp.overdue, 'rose', 'soft', TriangleAlert, 'overdue'],
          ['P1 đến hạn trong tháng', sAp.p1Due, 'vermilion', 'soft', CircleAlert, 'p1'],
        ];

  const LevelBadge = ({ r }) => {
    const lv = cfg.levels[r[cfg.levelField] || cfg.defaultLevel];
    return <Badge tone={lv?.tone}>{kind === 'ap' ? lv?.short : lv?.label}</Badge>;
  };
  const DueBadge = ({ r }) =>
    r.remain > 0 && r.days != null ? (
      <Badge tone={r.days < 0 ? 'red' : r.days <= 7 ? 'amber' : 'slate'}>{describeDays(r.days)}</Badge>
    ) : r.remain <= 0 ? (
      <Badge tone="green">Đã xong</Badge>
    ) : null;

  return (
    <div>
      <PageHeader
        icon={HandCoins}
        tone="vermilion"
        title="Công nợ đối tác"
        subtitle="Phải thu khách hàng, phải trả nhà cung cấp, thanh toán từng đợt"
        actions={
          tab === 'ncc' ? (
            <Button variant="vermilion" icon={Plus} onClick={() => setSupplierModal({})}>
              Thêm nhà cung cấp
            </Button>
          ) : (
            <Button variant={kind === 'ar' ? 'jade' : 'vermilion'} icon={Plus} onClick={() => setDebtModal({})}>
              Thêm khoản {cfg.name}
            </Button>
          )
        }
      />

      <Tabs
        value={tab}
        onChange={(v) => navigate(`partners?tab=${v}`)}
        tabs={[
          { value: 'ar', label: 'Phải thu (Khách hàng)', icon: CircleArrowDown, iconClass: 'text-jade-600', count: sAr.count, activeClass: 'border-jade-600 text-jade-700' },
          { value: 'ap', label: 'Phải trả (Nhà cung cấp)', icon: CircleArrowUp, iconClass: 'text-vermilion-500', count: sAp.count, activeClass: 'border-vermilion-500 text-vermilion-600' },
          { value: 'chi', label: 'Lệnh chi đã duyệt', icon: Stamp, iconClass: 'text-vermilion-600', count: orders.length, activeClass: 'border-vermilion-600 text-vermilion-700' },
          { value: 'ncc', label: 'Danh bạ nhà cung cấp', icon: Building2, iconClass: 'text-ink-700', count: suppliers.length, activeClass: 'border-ink-900 text-ink-900' },
        ]}
      />

      {tab !== 'chi' && orders.length > 0 && (
        <button
          type="button"
          onClick={() => navigate('partners?tab=chi')}
          className="mt-4 flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-vermilion-200 bg-vermilion-50 px-4 py-3 text-left text-sm text-vermilion-800 hover:bg-vermilion-100"
        >
          <Stamp className="h-5 w-5 shrink-0" />
          <span className="flex-1">
            Có <b>{orders.length} lệnh chi đã duyệt</b> chờ chuyển tiền, tổng <Money value={ordersTotal} className="font-bold" />
          </span>
          <span className="font-semibold underline">Xem danh sách đi lệnh</span>
        </button>
      )}

      {tab === 'chi' ? (
        <PayOrdersPanel ap={ap} approvals={approvals} suppliers={suppliers} flow={flow} />
      ) : tab === 'ncc' ? (
        <SupplierDirectory suppliers={suppliers} ap={ap} onEdit={(s) => setSupplierModal({ initial: s })} onAdd={() => setSupplierModal({})} />
      ) : (
      <>
      <SettlementSummary
        kind={kind}
        list={list}
        loaded={!!loaded[kind]}
        action={{ label: kind === 'ar' ? 'Thu tiền / thêm khoản' : can(role, 'approvePayments') ? 'Duyệt chi / thêm khoản' : 'Xem / thêm khoản', onClick: () => quick.open(kind, { filter: 'all' }) }}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 my-5">
        {tiles.slice(1).map(([label, v, tone, variant, Icon, filter]) => (
          <StatTile
            key={label}
            tone={tone}
            variant={variant}
            icon={Icon}
            label={label}
            value={<Money value={v} />}
            action={kind === 'ar' ? 'Thu tiền / thêm khoản' : can(role, 'approvePayments') ? 'Duyệt chi / thêm khoản' : 'Xem / thêm khoản'}
            onClick={() => quick.open(kind, { filter })}
          />
        ))}
      </div>

      <Card>
        <div className="flex flex-col gap-3 p-4 border-b border-slate-100 lg:flex-row lg:items-center lg:justify-between">
          <Segmented
            value={status}
            onChange={setStatus}
            options={[
              { value: 'OPEN', label: 'Còn nợ' },
              { value: 'DONE', label: 'Đã xong' },
              { value: 'ALL', label: 'Tất cả' },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select value={level} onChange={(e) => setLevel(e.target.value)} className="w-auto">
              <option value="ALL">{kind === 'ar' ? 'Mọi mức độ' : 'Mọi mức ưu tiên'}</option>
              {Object.entries(cfg.levels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
            <div className="relative flex-1 min-w-[180px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm đối tác, hóa đơn…" className="pl-9" />
            </div>
            <Button icon={FileSpreadsheet} onClick={exportXlsx} disabled={!rows.length}>
              Xuất Excel
            </Button>
          </div>
        </div>

        {!loaded[kind] ? (
          <EmptyState title="Đang tải…" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={HandCoins}
            title="Không có khoản công nợ nào"
            description={list.length ? 'Thử đổi bộ lọc.' : `Bấm “Thêm khoản ${cfg.name}” để bắt đầu.`}
          />
        ) : (
          <>
            <TableWrap className="hidden md:block">
              <table className="w-full">
                <thead className="bg-slate-50/80">
                  <tr>
                    <th className={th}>{cfg.partnerLabel}</th>
                    <th className={cx(th, 'text-right')}>Tổng công nợ</th>
                    <th className={cx(th, 'text-right')}>{cfg.paidLabel}</th>
                    <th className={cx(th, 'text-right')}>{cfg.remainLabel}</th>
                    <th className={th}>{cfg.dueLabel}</th>
                    <th className={th}>{kind === 'ar' ? 'Mức độ' : 'Ưu tiên'}</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.id} className={cx('hover:bg-slate-50/70', r.remain <= 0 && 'opacity-60')}>
                      <td className={td}>
                        <p className="font-medium text-slate-800">{r.partnerName}</p>
                        {r.description && <p className="text-xs text-slate-500 max-w-[320px] truncate">{r.description}</p>}
                        {kind === 'ap' && <SupplierInfo supplier={findSupplier(suppliers, r) || { name: r.partnerName }} className="mt-0.5" />}
                      </td>
                      <td className={cx(td, 'text-right')}>
                        <Money value={r.total} />
                      </td>
                      <td className={cx(td, 'text-right')}>
                        <Money value={r.paid || 0} className="text-slate-500" />
                      </td>
                      <td className={cx(td, 'text-right')}>
                        <Money value={r.remain} className={cx('font-semibold', kind === 'ar' ? 'text-emerald-700' : 'text-orange-600')} />
                      </td>
                      <td className={cx(td, 'whitespace-nowrap')}>
                        <span className="tabular-nums text-slate-600 mr-2">{fmtDate(r.dueDate)}</span>
                        <DueBadge r={r} />
                      </td>
                      <td className={td}>
                        <LevelBadge r={r} />
                        {kind === 'ap' && r.remain > 0 && flow.openByPayable.get(r.id) && (
                          <div className="mt-1">
                            <ApprovalBadge approval={flow.openByPayable.get(r.id)} outstanding={r.remain} />
                          </div>
                        )}
                      </td>
                      <td className={cx(td, 'text-right whitespace-nowrap space-x-1')}>
                        {r.remain > 0 &&
                          (kind === 'ap' ? (
                            flow.actionsFor(r)
                          ) : (
                            <Button size="xs" variant="success" icon={Wallet} onClick={() => setPayDebt(raw(r))}>
                              {cfg.payVerb}
                            </Button>
                          ))}
                        <Button size="iconSm" variant="ghost" icon={History} onClick={() => setHistDebt(raw(r))} title="Lịch sử thanh toán" />
                        <Button size="iconSm" variant="ghost" icon={Pencil} onClick={() => setDebtModal({ initial: raw(r) })} title="Sửa" />
                        {can(role, 'deleteDebts') && <Button size="iconSm" variant="ghost" icon={Trash2} onClick={() => removeDebt(r)} title="Xóa" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 bg-slate-50/80">
                  <tr>
                    <td className={cx(td, 'font-semibold text-ink-900')}>Cộng {rows.length} khoản</td>
                    <td className={cx(td, 'text-right')}>
                      <Money value={footer.total} className="font-semibold text-ink-900" />
                    </td>
                    <td className={cx(td, 'text-right')}>
                      <Money value={footer.paid} className={cx('font-semibold', kind === 'ar' ? 'text-jade-700' : 'text-vermilion-600')} />
                    </td>
                    <td className={cx(td, 'text-right')}>
                      <Money value={footer.remain} className={cx('font-bold', kind === 'ar' ? 'text-emerald-700' : 'text-orange-600')} />
                    </td>
                    <td className={td} colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </TableWrap>

            <div className="md:hidden grid grid-cols-3 gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5 text-[11px] text-slate-500">
              <span>
                Tổng {rows.length} khoản
                <Money value={footer.total} compact className="block text-sm font-semibold text-ink-900" />
              </span>
              <span>
                {cfg.paidLabel}
                <Money value={footer.paid} compact className={cx('block text-sm font-semibold', kind === 'ar' ? 'text-jade-700' : 'text-vermilion-600')} />
              </span>
              <span className="text-right">
                {cfg.remainLabel}
                <Money value={footer.remain} compact className={cx('block text-sm font-bold', kind === 'ar' ? 'text-emerald-700' : 'text-orange-600')} />
              </span>
            </div>

            <ul className="md:hidden divide-y divide-slate-100">
              {rows.map((r) => (
                <li key={r.id} className={cx('px-4 py-3', r.remain <= 0 && 'opacity-60')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{r.partnerName}</p>
                      {r.description && <p className="text-xs text-slate-500 truncate">{r.description}</p>}
                      {kind === 'ap' && <SupplierInfo supplier={findSupplier(suppliers, r) || { name: r.partnerName }} compact />}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <LevelBadge r={r} />
                        <DueBadge r={r} />
                        {kind === 'ap' && r.remain > 0 && <ApprovalBadge approval={flow.openByPayable.get(r.id)} outstanding={r.remain} />}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <Money value={r.remain} className={cx('block text-sm font-semibold', kind === 'ar' ? 'text-emerald-700' : 'text-orange-600')} />
                      <span className="block text-[11px] text-slate-400">
                        / <Money value={r.total} />
                      </span>
                      <span className="block text-[11px] text-slate-400">{fmtDate(r.dueDate)}</span>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap justify-end gap-1">
                    {r.remain > 0 &&
                      (kind === 'ap' ? (
                        flow.actionsFor(r)
                      ) : (
                        <Button size="xs" variant="success" icon={Wallet} onClick={() => setPayDebt(raw(r))}>
                          {cfg.payVerb}
                        </Button>
                      ))}
                    <Button size="xs" icon={History} onClick={() => setHistDebt(raw(r))}>
                      Lịch sử
                    </Button>
                    <Button size="xs" icon={Pencil} onClick={() => setDebtModal({ initial: raw(r) })}>
                      Sửa
                    </Button>
                    {can(role, 'deleteDebts') && <Button size="xs" variant="dangerGhost" icon={Trash2} onClick={() => removeDebt(r)} />}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      </>
      )}

      <SupplierModal open={!!supplierModal} onClose={() => setSupplierModal(null)} initial={supplierModal?.initial} suppliers={suppliers} />
      <DebtModal open={!!debtModal} onClose={() => setDebtModal(null)} kind={kind} initial={debtModal?.initial} partnerNames={partnerNames} />
      <PaymentModal open={!!payDebt} onClose={() => setPayDebt(null)} kind={kind} debt={payDebt} />
      {flow.modals}
      <HistoryModal open={!!histDebt} onClose={() => setHistDebt(null)} kind={kind} debt={fresh(histDebt) && raw(fresh(histDebt))} />
    </div>
  );
}

/* ----------------------------- Tổng hợp đã thu / đã trả ----------------------------- */
/**
 * Lũy kế: tổng giá trị công nợ – đã thu (trả) – còn lại, kèm thanh tiến độ.
 * Trong tháng: tổng các lần thu (trả) theo ngày thanh toán, chia tiền mặt / chuyển khoản.
 */
function SettlementSummary({ kind, list, loaded, action }) {
  const ar = kind === 'ar';
  const [month, setMonth] = useState(currentMonth());
  const [pays, setPays] = useState(null);
  useEffect(() => {
    const { start, end } = monthRange(month);
    setPays(null);
    return onSnapshot(
      query(collection(db, C.payments), where('date', '>=', start), where('date', '<=', end)),
      (snap) => setPays(snap.docs.map((d) => d.data())),
      () => setPays([]),
    );
  }, [month]);
  const t = useMemo(() => debtTotals(list), [list]);
  const m = useMemo(() => {
    const ids = new Set(list.map((r) => r.id));
    return paymentTotals((pays || []).filter((p) => ids.has(p.parentId)), ar ? 'AR' : 'AP');
  }, [pays, ar, list]);
  const word = ar ? 'thu' : 'trả';
  const bar = ar ? 'bg-jade-500' : 'bg-vermilion-500';
  const paidTone = ar ? 'text-jade-700' : 'text-vermilion-600';
  return (
    <Card className="mt-5 p-4 sm:p-5">
      <div className="grid grid-cols-3 gap-3 sm:gap-6">
        <Figure
          label={
            <>
              Tổng phải {word}
              <span className="hidden sm:inline"> (lũy kế)</span>
            </>
          }
          value={t.total}
          sub={`${t.count} khoản`}
        />
        <Figure
          label={`Đã ${word}`}
          value={t.paid}
          tone={paidTone}
          sub={
            <>
              đạt {t.pct.toLocaleString('vi-VN')}%<span className="hidden sm:inline"> · {t.done} khoản xong</span>
            </>
          }
        />
        <Figure label={`Còn phải ${word}`} value={t.remain} tone={ar ? 'text-emerald-700' : 'text-orange-600'} sub={`${t.open} khoản còn nợ`} align="right" />
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={t.pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Đã ${word} ${t.pct}%`}>
        <div className={cx('h-full rounded-full transition-[width]', bar)} style={{ width: `${loaded ? t.pct : 0}%` }} />
      </div>
      <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3 border-t border-slate-100 pt-4">
        <MonthPicker value={month} onChange={setMonth} className="self-start" />
        <div className="min-w-0 flex-1 sm:order-none">
          <p className="text-sm text-slate-600">
            Đã {word} trong {monthLabel(month).toLowerCase()}:{' '}
            {pays === null ? <span className="text-slate-400">đang tải…</span> : <Money value={m.total} className={cx('font-bold', paidTone)} />}
            {pays !== null && <span className="text-slate-500"> · {m.count} lần</span>}
          </p>
          {pays !== null && m.count > 0 && (
            <p className="mt-0.5 text-xs text-slate-500">
              Tiền mặt <Money value={m.byMethod.CASH} className="font-medium text-slate-700" /> · Chuyển khoản <Money value={m.byMethod.BANK} className="font-medium text-slate-700" />
              {m.byMethod.OTHER > 0 && (
                <>
                  {' '}
                  · Khác <Money value={m.byMethod.OTHER} className="font-medium text-slate-700" />
                </>
              )}
            </p>
          )}
        </div>
        {action && (
          <Button size="sm" variant={ar ? 'jade' : 'vermilion'} icon={Plus} onClick={action.onClick} className="self-start sm:self-center">
            {action.label}
          </Button>
        )}
      </div>
    </Card>
  );
}

/* ----------------------------- Danh bạ nhà cung cấp ----------------------------- */
function SupplierDirectory({ suppliers, ap, onEdit, onAdd }) {
  const { actor, role } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const owed = useMemo(() => {
    const m = new Map();
    for (const r of ap) {
      const s = findSupplier(suppliers, r);
      if (s) m.set(s.id, (m.get(s.id) || 0) + remaining(r));
    }
    return m;
  }, [ap, suppliers]);
  const rows = suppliers
    .filter((s) => matchSearch(`${s.name} ${s.taxCode} ${s.bankAccount} ${s.bankName}`, q))
    .sort((a, b) => (owed.get(b.id) || 0) - (owed.get(a.id) || 0) || a.name.localeCompare(b.name));

  const remove = async (s) => {
    const ok = await confirm({
      title: `Xóa ${s.name} khỏi danh bạ?`,
      message: 'Các khoản công nợ đã ghi vẫn giữ tên nhà cung cấp, chỉ mất thông tin MST / tài khoản.',
      confirmText: 'Xóa',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const b = new AuditedBatch(actor);
      b.remove(C.partners, s.id, pickSupplier(s), `Xóa nhà cung cấp ${s.name}`);
      await b.commit();
      toast.success('Đã xóa nhà cung cấp');
    } catch (ex) {
      toast.error(friendlyError(ex));
    }
  };

  const exportXlsx = () =>
    downloadXlsx(`Danh-ba-nha-cung-cap_${todayISO()}`, [
      {
        name: 'Nhà cung cấp',
        colWidths: [34, 16, 20, 18, 20, 26, 20, 14, 16],
        rows: [
          ['Tên nhà cung cấp', 'Mã số thuế', 'Số tài khoản', 'Ngân hàng', 'Chi nhánh', 'Chủ tài khoản', 'Người liên hệ', 'Điện thoại', 'Còn phải trả'],
          ...rows.map((s) => [s.name, s.taxCode || '', s.bankAccount || '', s.bankName || '', s.bankBranch || '', s.accountHolder || '', s.contactName || '', s.phone || '', owed.get(s.id) || 0]),
        ],
      },
    ])
      .then(() => toast.success('Đã xuất file Excel'))
      .catch((ex) => ex?.code !== 'declined' && toast.error(friendlyError(ex)));

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên, mã số thuế, số tài khoản…" className="pl-9" />
        </div>
        <Button icon={FileSpreadsheet} onClick={exportXlsx} disabled={!rows.length}>
          Xuất Excel
        </Button>
      </div>
      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Building2}
            title={suppliers.length ? 'Không tìm thấy nhà cung cấp' : 'Danh bạ còn trống'}
            description="Lưu mã số thuế, số tài khoản và ngân hàng của từng nhà cung cấp để chuyển khoản nhanh và đúng."
            action={
              <Button variant="vermilion" icon={Plus} onClick={onAdd}>
                Thêm nhà cung cấp
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 2xl:grid-cols-3">
          {rows.map((s) => (
            <SupplierCard
              key={s.id}
              s={s}
              outstanding={fmtVND(owed.get(s.id) || 0)}
              toast={toast}
              onEdit={() => onEdit(pickSupplier(s))}
              onDelete={can(role, 'deletePartners') ? () => remove(s) : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
