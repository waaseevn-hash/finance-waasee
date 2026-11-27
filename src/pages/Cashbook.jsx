import { useMemo, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  BadgeCheck,
  CircleArrowDown,
  CircleArrowUp,
  CircleCheck,
  ClipboardCheck,
  Eye,
  FileSpreadsheet,
  Landmark,
  Lock,
  Pencil,
  PiggyBank,
  Plus,
  Search,
  Send,
  Stamp,
  UserPlus,
  UserRound,
  Vault,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { friendlyError } from '../lib/db.js';
import { MAIN_HOLDER, bankSummary, cashBalance, cashLedgerFor, holderBalances, holderOf, remaining } from '../lib/calc.js';
import { currentMonth, daysBetween, fmtDate, monthLabel, monthRange, todayISO } from '../lib/dates.js';
import { fmtVND, matchSearch } from '../lib/format.js';
import { downloadXlsx } from '../lib/xlsx.js';
import { resolveNames } from '../lib/runtime.js';
import { can } from '../lib/roles.js';
import { useCashHolders } from '../lib/holders.js';
import { cashEffect } from '../lib/vouchers.js';
import { approveVouchers } from '../lib/voucherService.js';
import { openPayOrders } from '../lib/approvals.js';
import { Who } from '../components/Who.jsx';
import { useQuick } from '../components/QuickPanels.jsx';
import { CountModal, EntryModal, HoldersModal, TYPE_LABEL, TransferModal, openVoucher } from '../components/forms/cashForms.jsx';
import { useApprovalFlow } from '../components/forms/approvalForms.jsx';
import { VTypeChip } from '../components/vouchers/common.jsx';
import { ApproveVoucherModal } from '../components/vouchers/ApproveVoucherModal.jsx';
import { Money } from '../components/Money.jsx';
import { Figure } from '../components/Figure.jsx';
import { useToast } from '../components/feedback.jsx';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  Input,
  MonthPicker,
  PageHeader,
  Segmented,
  Select,
  StatTile,
  TableWrap,
  cx,
  td,
  th,
} from '../components/ui.jsx';

/** Nội dung bút toán từ chứng từ đã có số phiếu ở nhãn riêng: bỏ phần số phiếu lặp lại ở đầu */
const stripNo = (e) => (e.voucherNo && String(e.description || '').startsWith(e.voucherNo) ? e.description.slice(e.voucherNo.length).replace(/^\s*—\s*/, '') : e.description);

export default function Cashbook() {
  const data = useData();
  const { cash, banks, loans, loaded } = data;
  const holders = useCashHolders();
  const quick = useQuick();
  const toast = useToast();
  const ledgerRef = useRef(null);

  const [month, setMonth] = useState(currentMonth());
  const [allMonths, setAllMonths] = useState(false);
  const [type, setType] = useState('ALL');
  const [holder, setHolder] = useState('ALL');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null); // {initial?, type?}
  const [countOpen, setCountOpen] = useState(false);
  const [transfer, setTransfer] = useState(null); // {defaultFrom}
  const [holdersOpen, setHoldersOpen] = useState(false);

  const total = useMemo(() => cashBalance(cash), [cash]);
  const balances = useMemo(() => holderBalances(cash), [cash]);
  const multi = holders.active.length > 1 || Object.keys(balances).some((id) => id !== MAIN_HOLDER);
  // Người đang giữ + người đã ngừng nhưng sổ vẫn còn tiền
  const shown = useMemo(() => {
    const list = holders.active.slice();
    for (const [id, v] of Object.entries(balances)) if (v !== 0 && !list.some((h) => h.id === id)) list.push({ id, name: holders.name(id), active: false });
    return list;
  }, [holders, balances]);

  const ledger = useMemo(() => cashLedgerFor(cash, holder === 'ALL' ? null : holder), [cash, holder]);
  const rows = useMemo(() => {
    const { start, end } = monthRange(month);
    return ledger
      .filter((e) => allMonths || (e.date >= start && e.date <= end))
      .filter((e) => type === 'ALL' || (!e.move && e.type === type))
      .filter((e) => matchSearch(`${e.description} ${e.counterparty} ${e.note}`, q))
      .reverse();
  }, [ledger, month, allMonths, type, q]);

  const viewHolder = (id) => {
    setHolder(id);
    setType('ALL');
    ledgerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const exportXlsx = async () => {
    const sorted = [...rows].reverse();
    try {
      const names = await resolveNames(sorted.map((e) => e.createdBy));
      const scope = holder === 'ALL' ? 'Sổ quỹ' : `Sổ quỹ ${holders.name(holder)}`;
      await downloadXlsx(`So-quy-tien-mat_${allMonths ? 'tat-ca' : month}`, [
        {
          name: `${scope}${allMonths ? '' : ` ${monthLabel(month)}`}`.slice(0, 31),
          colWidths: [12, 10, 20, 26, 40, 26, 16, 16, 18, 24],
          rows: [
            ['Ngày', 'Loại', 'Người giữ', 'Đối tượng', 'Nội dung', 'Ghi chú', 'Thu', 'Chi', 'Tồn quỹ', 'Người tạo'],
            ...sorted.map((e) => [
              fmtDate(e.date),
              e.move ? 'Bàn giao' : TYPE_LABEL[e.type],
              e.move ? `${holders.name(e.fromHolder)} → ${holders.name(e.toHolder)}` : holders.name(holderOf(e)),
              e.counterparty || '',
              e.move ? `Bàn giao ${fmtVND(e.amount)}` : e.description || '',
              e.note || '',
              !e.move && e.type === 'IN' ? e.amount : null,
              !e.move && e.type === 'OUT' ? e.amount : null,
              e.balance,
              names[e.createdBy] || '',
            ]),
          ],
        },
      ]);
      toast.success('Đã xuất file Excel');
    } catch (ex) {
      if (ex?.code !== 'declined') toast.error(friendlyError(ex));
    }
  };

  return (
    <div>
      <PageHeader
        icon={Vault}
        tone="jade"
        title="Tiền mặt và tiền gửi ngân hàng"
        subtitle="Tiền mặt theo người giữ, tiền gửi ngân hàng và các khoản cần duyệt chi"
        actions={
          <>
            <Button variant="jade" icon={Plus} onClick={() => setModal({ type: 'IN' })}>
              Phiếu thu
            </Button>
            <Button variant="vermilion" icon={Plus} onClick={() => setModal({ type: 'OUT' })}>
              Phiếu chi
            </Button>
            <Button icon={ArrowRightLeft} onClick={() => (holders.active.length > 1 ? setTransfer({}) : setHoldersOpen(true))}>
              Bàn giao tiền
            </Button>
            <Button icon={ClipboardCheck} onClick={() => setCountOpen(true)}>
              Kiểm kê quỹ
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <StatTile
          variant="solid"
          tone="jade"
          icon={Vault}
          label="Tồn quỹ tiền mặt"
          value={<Money value={total} />}
          sub={multi ? `Két công ty và ${shown.length - 1} người giữ` : 'Toàn bộ tiền mặt đang ở két'}
          action={holder === 'ALL' ? 'Thu / chi tiền' : 'Xem sổ toàn bộ'}
          onClick={() => (holder === 'ALL' ? quick.open('cash') : viewHolder('ALL'))}
          className="col-span-2 sm:col-span-1"
        />
        {shown.map((h) => (
          <HolderTile key={h.id} holder={h} balance={balances[h.id] || 0} total={total} selected={holder === h.id} onClick={() => viewHolder(holder === h.id ? 'ALL' : h.id)} />
        ))}
        <button
          type="button"
          onClick={() => setHoldersOpen(true)}
          className="flex flex-col items-start justify-center gap-1.5 rounded-2xl border-2 border-dashed border-slate-300 bg-white/60 p-3.5 text-left text-slate-600 transition-colors hover:border-jade-400 hover:bg-white hover:text-jade-700 sm:p-5"
        >
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-slate-100 text-slate-600">
            <UserPlus className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold">{multi ? 'Thêm / sửa người giữ' : 'Thêm người giữ tiền'}</span>
          <span className="hidden text-xs text-slate-500 sm:block">Người đang cầm tiền mặt của công ty ngoài két</span>
        </button>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ApprovalsCard total={total} className="xl:col-span-2" />
        <DepositsCard banks={banks} loans={loans} onEdit={() => quick.open('deposits')} />
      </div>

      <Card>
        <div ref={ledgerRef} className="scroll-mt-20 flex flex-col gap-3 p-4 border-b border-slate-100 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="mr-2 text-sm font-semibold text-ink-900">Sổ quỹ{holder !== 'ALL' && ` — ${holders.name(holder)}`}</h3>
            <MonthPicker value={month} onChange={(m) => { setMonth(m); setAllMonths(false); }} className={cx(allMonths && 'opacity-50')} />
            <Checkbox checked={allMonths} onChange={setAllMonths} label="Tất cả các tháng" className="ml-1" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {multi && (
              <Select value={holder} onChange={(e) => setHolder(e.target.value)} className="!w-auto min-w-[150px]" aria-label="Lọc theo người giữ">
                <option value="ALL">Tất cả người giữ</option>
                {holders.all
                  .filter((h) => h.active || balances[h.id] !== undefined)
                  .map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
              </Select>
            )}
            <Segmented
              value={type}
              onChange={setType}
              options={[
                { value: 'ALL', label: 'Tất cả' },
                { value: 'IN', label: 'Thu', activeClass: 'text-emerald-700' },
                { value: 'OUT', label: 'Chi', activeClass: 'text-rose-700' },
              ]}
            />
            <div className="relative flex-1 min-w-[180px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm nội dung, đối tượng…" className="pl-9" />
            </div>
            <Button icon={FileSpreadsheet} onClick={exportXlsx} disabled={!rows.length}>
              Xuất Excel
            </Button>
          </div>
        </div>

        {!loaded.cash ? (
          <EmptyState title="Đang tải sổ quỹ…" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Vault}
            title="Chưa có phiếu nào"
            description={cash.length === 0 ? 'Gợi ý: ghi một "Phiếu thu" với nội dung "Tồn quỹ đầu kỳ" bằng số tiền đang có trong két để bắt đầu.' : 'Không có phiếu phù hợp bộ lọc.'}
            action={<Button variant="success" icon={Plus} onClick={() => setModal({ type: 'IN' })}>Phiếu thu</Button>}
          />
        ) : (
          <>
            {/* Máy tính */}
            <TableWrap className="hidden md:block">
              <table className="w-full">
                <thead className="bg-slate-50/80">
                  <tr>
                    <th className={th}>Ngày</th>
                    <th className={th}>Nội dung / Đối tượng</th>
                    <th className={cx(th, 'text-right')}>Thu</th>
                    <th className={cx(th, 'text-right')}>Chi</th>
                    <th className={cx(th, 'text-right')}>Tồn quỹ</th>
                    <th className={th}>Người tạo</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((e) => (
                    <tr key={e.id} className={cx('hover:bg-slate-50/70 group', e.move && 'bg-slate-50/40')}>
                      <td className={cx(td, 'whitespace-nowrap tabular-nums text-slate-500')}>{fmtDate(e.date)}</td>
                      <td className={td}>
                        {e.move ? (
                          <p className="flex items-center gap-1.5 font-medium text-slate-700">
                            <ArrowRightLeft className="h-3.5 w-3.5 text-slate-400" />
                            Bàn giao: {holders.name(e.fromHolder)} → {holders.name(e.toHolder)}
                          </p>
                        ) : (
                          <p className="font-medium text-slate-800">
                            {e.voucherNo && (
                              <button type="button" onClick={() => openVoucher(e.sourceVoucherId || e.voucherId)} className="mr-1.5 rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200 hover:bg-amber-100" title="Mở chứng từ">
                                {e.voucherNo}
                              </button>
                            )}
                            {stripNo(e)}
                          </p>
                        )}
                        <p className="text-xs text-slate-500">
                          {holder === 'ALL' && !e.move && holderOf(e) !== MAIN_HOLDER && <span className="mr-1 rounded bg-jade-50 px-1.5 py-px text-[11px] font-medium text-jade-800">{holders.name(holderOf(e))}</span>}
                          {!e.move && e.counterparty}
                          {e.note && <span className="text-slate-400"> {e.move ? '' : '· '}{e.note}</span>}
                        </p>
                      </td>
                      {e.move ? (
                        <td colSpan={2} className={cx(td, 'text-right text-slate-500')}>
                          <Money value={e.amount} className="font-medium" />
                        </td>
                      ) : (
                        <>
                          <td className={cx(td, 'text-right')}>{e.type === 'IN' && <Money value={e.amount} className="font-semibold text-jade-600" />}</td>
                          <td className={cx(td, 'text-right')}>{e.type === 'OUT' && <Money value={e.amount} className="font-semibold text-vermilion-600" />}</td>
                        </>
                      )}
                      <td className={cx(td, 'text-right')}>
                        <Money value={e.balance} className={cx('font-medium', e.balance < 0 ? 'text-rose-600' : 'text-slate-700')} />
                      </td>
                      <td className={cx(td, 'text-xs text-slate-500 whitespace-nowrap')}>
                        <Who id={e.createdBy} />
                      </td>
                      <td className={cx(td, 'text-right whitespace-nowrap')}>
                        <Button size="iconSm" variant="ghost" icon={e.voucherId ? Lock : Pencil} onClick={() => setModal({ initial: e })} title={e.voucherId ? 'Bút toán từ chứng từ — đã khóa' : 'Sửa / Xóa'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>

            {/* Điện thoại */}
            <ul className="md:hidden divide-y divide-slate-100">
              {rows.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => setModal({ initial: e })} className="flex w-full items-start gap-3 px-4 py-3 text-left active:bg-slate-50">
                    <span className={cx('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full', e.move ? 'bg-slate-100 text-slate-500' : e.type === 'IN' ? 'bg-jade-50 text-jade-600' : 'bg-vermilion-50 text-vermilion-600')}>
                      {e.move ? <ArrowRightLeft className="h-4 w-4" /> : e.type === 'IN' ? <CircleArrowDown className="h-4 w-4" /> : <CircleArrowUp className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-800 truncate">
                        {e.move ? (
                          `Bàn giao: ${holders.name(e.fromHolder)} → ${holders.name(e.toHolder)}`
                        ) : (
                          <>
                            {e.voucherNo && <span className="mr-1 font-mono text-[11px] text-amber-800">{e.voucherNo}</span>}
                            {stripNo(e)}
                          </>
                        )}
                      </span>
                      <span className="block text-xs text-slate-500 truncate">
                        {fmtDate(e.date)}
                        {holder === 'ALL' && !e.move && holderOf(e) !== MAIN_HOLDER && ` · ${holders.name(holderOf(e))}`}
                        {!e.move && e.counterparty && ` · ${e.counterparty}`}
                      </span>
                    </span>
                    <span className="text-right">
                      {e.move ? (
                        <Money value={e.amount} className="block text-sm font-medium text-slate-500" />
                      ) : (
                        <Money value={e.type === 'IN' ? e.amount : -e.amount} sign className={cx('block text-sm font-semibold', e.type === 'IN' ? 'text-jade-600' : 'text-vermilion-600')} />
                      )}
                      <span className="block text-[11px] text-slate-400">
                        Tồn <Money value={e.balance} />
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <EntryModal open={!!modal} onClose={() => setModal(null)} initial={modal?.initial} defaultType={modal?.type} defaultHolder={holder === 'ALL' ? MAIN_HOLDER : holder} />
      <CountModal open={countOpen} onClose={() => setCountOpen(false)} defaultHolder={holder === 'ALL' ? MAIN_HOLDER : holder} />
      <TransferModal open={!!transfer} onClose={() => setTransfer(null)} defaultFrom={holder === 'ALL' ? MAIN_HOLDER : holder} />
      <HoldersModal open={holdersOpen} onClose={() => setHoldersOpen(false)} />
    </div>
  );
}

/* ============================ Thẻ người giữ tiền ============================ */
function HolderTile({ holder: h, balance, total, selected, onClick }) {
  const main = h.id === MAIN_HOLDER;
  const Icon = main ? Vault : UserRound;
  const share = total > 0 && balance > 0 ? Math.round((balance / total) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-white p-3.5 text-left shadow-[0_1px_2px_rgba(15,30,58,0.05),0_8px_24px_-12px_rgba(15,30,58,0.12)] transition-all hover:-translate-y-0.5 hover:shadow-xl sm:p-5',
        selected ? 'border-jade-500 ring-2 ring-jade-500' : 'border-slate-200/70',
      )}
    >
      <span className={cx('absolute inset-y-0 left-0 w-1', main ? 'bg-jade-500' : 'bg-ink-700')} />
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-[13px] font-medium text-slate-500">{main ? h.name : `${h.name} đang giữ`}</span>
        <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-xl sm:h-9 sm:w-9', main ? 'bg-jade-50 text-jade-700' : 'bg-ink-900 text-white')}>
          <Icon className="h-4 w-4" />
        </span>
      </span>
      <span className={cx('mt-1 block font-display text-lg font-bold tracking-tight sm:text-2xl', balance < 0 ? 'text-rose-600' : main ? 'text-jade-700' : 'text-ink-900')}>
        <span className="sm:hidden">
          <Money value={balance} compact />
        </span>
        <span className="hidden sm:inline">
          <Money value={balance} />
        </span>
      </span>
      <span className="mt-1 block truncate text-xs text-slate-500">
        {!h.active ? 'Đã ngừng giữ — bàn giao về két' : share ? `${share}% tiền mặt` : 'Chưa giữ tiền'}
      </span>
      <span className="mt-2 hidden w-fit items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 group-hover:bg-slate-200 sm:inline-flex">
        <Eye className="h-3.5 w-3.5" /> {selected ? 'Đang xem sổ' : 'Xem sổ'}
      </span>
    </button>
  );
}

/* ============================ Tiền gửi ngân hàng ============================ */
function DepositsCard({ banks, loans, onEdit }) {
  const sum = useMemo(() => bankSummary(banks, loans), [banks, loans]);
  return (
    <Card className="flex flex-col xl:self-start">
      <CardHeader
        title="Tiền gửi ngân hàng"
        subtitle="Số dư theo sao kê / ứng dụng ngân hàng"
        icon={PiggyBank}
        iconClass="bg-lagoon-50 text-lagoon-700"
        actions={
          banks.length > 0 && (
            <Button size="sm" icon={Pencil} onClick={onEdit}>
              Cập nhật
            </Button>
          )
        }
      />
      {banks.length === 0 ? (
        <EmptyState icon={Landmark} title="Chưa có tài khoản ngân hàng" description="Thêm ngân hàng ở mục Vay & Hạn mức NH." />
      ) : (
        <>
          <ul className="flex-1 divide-y divide-slate-100 border-t border-slate-100">
            {sum.rows.map((b) => (
              <li key={b.id}>
                <button type="button" onClick={onEdit} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 sm:px-5">
                  <span className="min-w-0 truncate text-sm text-slate-700">{b.name}</span>
                  <Money value={b.deposit} className="text-sm font-semibold text-ink-900" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-slate-100 bg-lagoon-50/60 px-4 py-3 sm:px-5">
            <span className="text-sm font-medium text-lagoon-800">Tổng tiền gửi</span>
            <Money value={sum.totals.deposit} className="font-display text-lg font-bold text-lagoon-800" />
          </div>
        </>
      )}
    </Card>
  );
}

/* ============================ Các khoản cần duyệt chi ============================ */
function ApprovalsCard({ total, className = '' }) {
  const { role, actor } = useAuth();
  const data = useData();
  const toast = useToast();
  const today = todayISO();
  const [apScope, setApScope] = useState('month');
  const [busy, setBusy] = useState('');
  const [approving, setApproving] = useState(null);
  const flow = useApprovalFlow({ ap: data.ap, approvals: data.approvals, suppliers: data.suppliers });
  const canVouchers = can(role, 'approveVouchers');
  const canPay = can(role, 'approvePayments');

  const v = useMemo(() => {
    const own = (data.vouchers || []).filter((x) => !x.auto);
    const pending = own.filter((x) => x.status === 'PENDING').sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const approved = own.filter((x) => x.status === 'APPROVED');
    const approvedOut = approved.reduce((s, x) => s + cashEffect(x).out, 0);
    const approvedIn = approved.reduce((s, x) => s + cashEffect(x).in, 0);
    const pendingOut = pending.reduce((s, x) => s + cashEffect(x).out, 0);
    // Tiền còn lại nếu duyệt lần lượt từng chứng từ (sau khi đã trừ phần đã duyệt chờ kết chuyển)
    let run = total - approvedOut + approvedIn;
    const rows = pending.map((x) => {
      const e = cashEffect(x);
      run += e.in - e.out;
      return { ...x, out: e.out, inn: e.in, after: run };
    });
    return { rows, approved, approvedOut, approvedIn, pendingOut, afterAll: run };
  }, [data.vouchers, total]);

  const ap = useMemo(() => {
    const { end } = monthRange(currentMonth());
    const list = (data.ap || [])
      .filter((r) => remaining(r) > 0 && !flow.openByPayable.has(r.id))
      .filter((r) => apScope === 'all' || (r.dueDate && r.dueDate <= end))
      .map((r) => ({ ...r, rem: remaining(r), overdue: r.dueDate && r.dueDate < today ? daysBetween(r.dueDate, today) : 0 }))
      .sort((a, b) => ((a.priority || 'P2') === 'P1' ? 0 : 1) - ((b.priority || 'P2') === 'P1' ? 0 : 1) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
    return { list, sum: list.reduce((s, r) => s + r.rem, 0) };
  }, [data.ap, flow.openByPayable, apScope, today]);

  const orders = useMemo(() => openPayOrders(data.approvals, data.ap, data.suppliers), [data.approvals, data.ap, data.suppliers]);
  const ordersSum = orders.reduce((s, o) => s + o.payAmount, 0);
  const need = v.pendingOut + v.approvedOut;
  const left = v.afterAll;

  const approve = async (ids, key) => {
    setBusy(key);
    try {
      const nums = await approveVouchers({ actor, ids });
      const list = Object.values(nums || {});
      toast.success(ids.length === 1 && list[0] ? `Đã duyệt, số ${list[0]}` : `Đã duyệt ${list.length || ids.length} chứng từ`);
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy('');
    }
  };

  const nothing = v.rows.length === 0 && ap.list.length === 0 && v.approved.length === 0 && orders.length === 0;

  return (
    <Card className={cx('flex flex-col', className)}>
      <CardHeader
        title="Các khoản cần duyệt chi"
        subtitle="Đối chiếu với tiền mặt đang có để biết duyệt được những khoản nào"
        icon={Stamp}
        iconClass="bg-vermilion-50 text-vermilion-700"
      />
      <div className="grid grid-cols-3 gap-px border-y border-slate-100 bg-slate-100">
        <div className="bg-white px-3 py-3 sm:px-5">
          <Figure label="Tiền mặt khả dụng" value={total} tone="text-jade-700" />
        </div>
        <div className="bg-white px-3 py-3 sm:px-5">
          <Figure
            label="Chứng từ cần chi"
            value={need}
            tone={need ? 'text-vermilion-600' : 'text-slate-400'}
            sub={
              <span className="hidden sm:inline">
                chờ duyệt <Money value={v.pendingOut} /> · chờ kết chuyển <Money value={v.approvedOut} />
              </span>
            }
          />
        </div>
        <div className={cx('px-3 py-3 sm:px-5', left < 0 ? 'bg-rose-50' : 'bg-white')}>
          <Figure label={left < 0 ? 'Thiếu nếu chi hết' : 'Còn lại sau khi chi'} value={Math.abs(left)} tone={left < 0 ? 'text-rose-600' : 'text-ink-900'} />
        </div>
      </div>

      {nothing ? (
        <EmptyState icon={BadgeCheck} title="Không có khoản nào cần duyệt" description="Chứng từ nội bộ và công nợ phải trả đến hạn đều đã được duyệt." />
      ) : (
        <div className="flex-1 divide-y divide-slate-100">
          {/* Chứng từ nội bộ chờ duyệt */}
          <section>
            <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-3 sm:px-5">
              <h4 className="text-xs font-semibold text-slate-600">
                Chứng từ nội bộ chờ duyệt <span className="font-normal text-slate-400">({v.rows.length})</span>
              </h4>
              {canVouchers && v.rows.length > 1 && (
                <Button size="xs" variant="primary" icon={CircleCheck} loading={busy === 'all'} disabled={!!busy} onClick={() => approve(v.rows.map((r) => r.id), 'all')} title="Duyệt toàn bộ số đề nghị của tất cả chứng từ">
                  Duyệt tất cả
                </Button>
              )}
            </div>
            {v.rows.length === 0 ? (
              <p className="px-4 pb-3 text-xs text-slate-400 sm:px-5">Không có chứng từ chờ duyệt.</p>
            ) : (
              <ul className="pb-1">
                {v.rows.map((r) => (
                  <li key={r.id} className="px-4 py-2 sm:flex sm:items-center sm:gap-3 sm:px-5">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <VTypeChip type={r.type} className="shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink-900">{r.person || '—'}</p>
                        <p className="truncate text-xs text-slate-500">
                          {fmtDate(r.date)}
                          {r.reason && ` · ${r.reason}`}
                        </p>
                      </div>
                    </div>
                    <div className="mt-1.5 flex items-center justify-end gap-2 sm:mt-0">
                      <div className="text-right">
                        <Money value={r.out ? -r.out : r.inn} sign className={cx('block text-sm font-semibold', r.out ? 'text-vermilion-600' : 'text-jade-600')} />
                        <span className={cx('block text-[11px]', r.after < 0 ? 'font-semibold text-rose-600' : 'text-slate-400')}>
                          {r.after < 0 ? 'thiếu ' : 'còn '}
                          <Money value={Math.abs(r.after)} />
                        </span>
                      </div>
                      <Button size="iconSm" variant="ghost" icon={Eye} onClick={() => openVoucher(r.id)} title="Xem chứng từ" />
                      {canVouchers && (
                        <Button size="xs" variant="primary" icon={CircleCheck} disabled={!!busy} onClick={() => setApproving(r)}>
                          Duyệt
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {v.approved.length > 0 && (
              <a href="#vouchers-post" className="mx-4 mb-3 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-sapphire-50 px-3 py-2 text-xs text-sapphire-800 hover:bg-sapphire-100 sm:mx-5">
                <span className="flex-1">
                  Đã duyệt, chờ kết chuyển: <b>{v.approved.length} chứng từ</b>
                  {v.approvedOut > 0 && (
                    <>
                      {' '}
                      · chi <Money value={v.approvedOut} className="font-semibold" />
                    </>
                  )}
                </span>
                <span className="font-semibold underline">Kết chuyển</span>
              </a>
            )}
          </section>

          {/* Công nợ phải trả chưa duyệt chi */}
          <section>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-1 pt-3 sm:px-5">
              <h4 className="text-xs font-semibold text-slate-600">
                Công nợ phải trả chưa duyệt chi <span className="font-normal text-slate-400">({ap.list.length} · <Money value={ap.sum} />)</span>
              </h4>
              <Segmented
                value={apScope}
                onChange={setApScope}
                className="!p-0.5 text-xs"
                options={[
                  { value: 'month', label: 'Đến hạn tháng này' },
                  { value: 'all', label: 'Tất cả' },
                ]}
              />
            </div>
            {ap.list.length === 0 ? (
              <p className="px-4 pb-3 text-xs text-slate-400 sm:px-5">{apScope === 'month' ? 'Không có khoản phải trả đến hạn tháng này cần duyệt.' : 'Không có khoản phải trả nào cần duyệt.'}</p>
            ) : (
              <ul className="max-h-[360px] overflow-y-auto pb-1 thin-scroll">
                {ap.list.map((r) => (
                  <li key={r.id} className="px-4 py-2 sm:flex sm:items-center sm:gap-3 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-sm font-medium text-ink-900">
                        {(r.priority || 'P2') === 'P1' && <Badge tone="red">P1</Badge>}
                        <span className="truncate">{r.partnerName}</span>
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {r.dueDate ? (r.overdue ? <span className="font-medium text-rose-600">Quá hạn {r.overdue} ngày</span> : `Hạn ${fmtDate(r.dueDate)}`) : 'Chưa có hạn'}
                        {r.description && ` · ${r.description}`}
                      </p>
                    </div>
                    <div className="mt-1.5 flex items-center justify-end gap-2 sm:mt-0">
                      <Money value={r.rem} className="text-sm font-semibold text-ink-900" />
                      {canPay && (
                        <Button size="xs" variant="vermilion" icon={Stamp} onClick={() => flow.approve(r, null)}>
                          Duyệt chi
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {orders.length > 0 && (
              <a href="#partners-chi" className="mx-4 mb-3 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-vermilion-50 px-3 py-2 text-xs text-vermilion-800 hover:bg-vermilion-100 sm:mx-5">
                <Send className="h-3.5 w-3.5" />
                <span className="flex-1">
                  Lệnh chi đã duyệt chờ chuyển tiền: <b>{orders.length} lệnh</b> · <Money value={ordersSum} className="font-semibold" />
                </span>
                <span className="font-semibold underline">Xem danh sách</span>
              </a>
            )}
          </section>
        </div>
      )}
      {flow.modals}
      {approving && <ApproveVoucherModal voucher={(data.vouchers || []).find((x) => x.id === approving.id) || approving} onClose={() => setApproving(null)} />}
    </Card>
  );
}
