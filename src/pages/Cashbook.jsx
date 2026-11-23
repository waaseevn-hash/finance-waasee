import { useEffect, useMemo, useState } from 'react';
import {
  CircleArrowDown,
  CircleArrowUp,
  ClipboardCheck,
  FileSpreadsheet,
  Lock,
  Pencil,
  Plus,
  Search,
  Trash2,
  Vault,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { AuditedBatch, C, friendlyError } from '../lib/db.js';
import { cashLedger, cashMonthStats } from '../lib/calc.js';
import { currentMonth, fmtDate, monthLabel, monthRange, todayISO } from '../lib/dates.js';
import { fmtVND, matchSearch } from '../lib/format.js';
import { downloadXlsx } from '../lib/xlsx.js';
import { resolveNames } from '../lib/runtime.js';
import { Who } from '../components/Who.jsx';
import { useQuick } from '../components/QuickPanels.jsx';
import { CountModal, EntryModal, TYPE_LABEL, openVoucher } from '../components/forms/cashForms.jsx';
import { Money, MoneyInput } from '../components/Money.jsx';
import { useConfirm, useToast } from '../components/feedback.jsx';
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Modal,
  MonthPicker,
  PageHeader,
  Segmented,
  StatTile,
  TableWrap,
  Textarea,
  cx,
  td,
  th,
} from '../components/ui.jsx';

/** Nội dung bút toán từ chứng từ đã có số phiếu ở nhãn riêng: bỏ phần số phiếu lặp lại ở đầu */
const stripNo = (e) => (e.voucherNo && String(e.description || '').startsWith(e.voucherNo) ? e.description.slice(e.voucherNo.length).replace(/^\s*—\s*/, '') : e.description);

export default function Cashbook() {
  const { cash, loaded } = useData();
  const [month, setMonth] = useState(currentMonth());
  const [allMonths, setAllMonths] = useState(false);
  const [type, setType] = useState('ALL');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null); // {initial?, type?}
  const [countOpen, setCountOpen] = useState(false);

  const ledger = useMemo(() => cashLedger(cash), [cash]);
  const balance = ledger.length ? ledger[ledger.length - 1].balance : 0;
  const stats = useMemo(() => cashMonthStats(cash, month), [cash, month]);

  const rows = useMemo(() => {
    const { start, end } = monthRange(month);
    return ledger
      .filter((e) => allMonths || (e.date >= start && e.date <= end))
      .filter((e) => type === 'ALL' || e.type === type)
      .filter((e) => matchSearch(`${e.description} ${e.counterparty} ${e.note}`, q))
      .reverse();
  }, [ledger, month, allMonths, type, q]);

  const toast = useToast();
  const quick = useQuick();
  const exportXlsx = async () => {
    const sorted = [...rows].reverse();
    try {
      const names = await resolveNames(sorted.map((e) => e.createdBy));
      await downloadXlsx(`So-quy-tien-mat_${allMonths ? 'tat-ca' : month}`, [
        {
          name: allMonths ? 'Sổ quỹ - tất cả' : `Sổ quỹ ${monthLabel(month)}`,
          colWidths: [12, 8, 26, 40, 26, 16, 16, 18, 24],
          rows: [
            ['Ngày', 'Loại', 'Đối tượng', 'Nội dung', 'Ghi chú', 'Thu', 'Chi', 'Tồn quỹ', 'Người tạo'],
            ...sorted.map((e) => [
              fmtDate(e.date),
              TYPE_LABEL[e.type],
              e.counterparty || '',
              e.description || '',
              e.note || '',
              e.type === 'IN' ? e.amount : null,
              e.type === 'OUT' ? e.amount : null,
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
        title="Tiền mặt trong két"
        subtitle="Sổ quỹ thu – chi tiền mặt, tự động tính tồn quỹ"
        actions={
          <>
            <Button variant="jade" icon={Plus} onClick={() => setModal({ type: 'IN' })}>
              Phiếu thu
            </Button>
            <Button variant="vermilion" icon={Plus} onClick={() => setModal({ type: 'OUT' })}>
              Phiếu chi
            </Button>
            <Button icon={ClipboardCheck} onClick={() => setCountOpen(true)}>
              Kiểm kê quỹ
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <StatTile variant="solid" tone="jade" icon={Vault} label="Tồn quỹ hiện tại" value={<Money value={balance} />} action="Thu / chi tiền" onClick={() => quick.open('cash')} />
        <StatTile tone="ink" icon={Wallet} label={`Tồn đầu ${monthLabel(month).toLowerCase()}`} value={<Money value={stats.opening} />} action="Xem phiếu trong tháng" onClick={() => quick.open('cash', { month })} />
        <StatTile tone="jade" icon={CircleArrowDown} label="Tổng thu trong tháng" value={<Money value={stats.inSum} />} action="Thêm phiếu thu" onClick={() => setModal({ type: 'IN' })} />
        <StatTile tone="vermilion" icon={CircleArrowUp} label="Tổng chi trong tháng" value={<Money value={stats.outSum} />} action="Thêm phiếu chi" onClick={() => setModal({ type: 'OUT' })} />
      </div>

      <Card>
        <div className="flex flex-col gap-3 p-4 border-b border-slate-100 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <MonthPicker value={month} onChange={(m) => { setMonth(m); setAllMonths(false); }} className={cx(allMonths && 'opacity-50')} />
            <Checkbox checked={allMonths} onChange={setAllMonths} label="Tất cả các tháng" className="ml-1" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
                    <tr key={e.id} className="hover:bg-slate-50/70 group">
                      <td className={cx(td, 'whitespace-nowrap tabular-nums text-slate-500')}>{fmtDate(e.date)}</td>
                      <td className={td}>
                        <p className="font-medium text-slate-800">
                          {e.voucherNo && (
                            <button type="button" onClick={() => openVoucher(e.sourceVoucherId || e.voucherId)} className="mr-1.5 rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200 hover:bg-amber-100" title="Mở chứng từ">
                              {e.voucherNo}
                            </button>
                          )}
                          {stripNo(e)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {e.counterparty}
                          {e.note && <span className="text-slate-400"> · {e.note}</span>}
                        </p>
                      </td>
                      <td className={cx(td, 'text-right')}>{e.type === 'IN' && <Money value={e.amount} className="font-semibold text-jade-600" />}</td>
                      <td className={cx(td, 'text-right')}>{e.type === 'OUT' && <Money value={e.amount} className="font-semibold text-vermilion-600" />}</td>
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
                    <span className={cx('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full', e.type === 'IN' ? 'bg-jade-50 text-jade-600' : 'bg-vermilion-50 text-vermilion-600')}>
                      {e.type === 'IN' ? <CircleArrowDown className="h-4 w-4" /> : <CircleArrowUp className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-800 truncate">
                        {e.voucherNo && <span className="mr-1 font-mono text-[11px] text-amber-800">{e.voucherNo}</span>}
                        {stripNo(e)}
                      </span>
                      <span className="block text-xs text-slate-500 truncate">
                        {fmtDate(e.date)}
                        {e.counterparty && ` · ${e.counterparty}`}
                      </span>
                    </span>
                    <span className="text-right">
                      <Money value={e.type === 'IN' ? e.amount : -e.amount} sign className={cx('block text-sm font-semibold', e.type === 'IN' ? 'text-jade-600' : 'text-vermilion-600')} />
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

      <EntryModal open={!!modal} onClose={() => setModal(null)} initial={modal?.initial} defaultType={modal?.type} balance={balance} />
      <CountModal open={countOpen} onClose={() => setCountOpen(false)} balance={balance} />
    </div>
  );
}
