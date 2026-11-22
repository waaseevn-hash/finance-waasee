import { useEffect, useMemo, useState } from 'react';
import { Banknote, Building2, CircleCheck, Landmark, Pencil, PiggyBank, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { AuditedBatch, C, friendlyError } from '../lib/db.js';
import { bankSummary, loanInterestForMonth } from '../lib/calc.js';
import { currentMonth, daysBetween, describeDays, fmtDate, todayISO } from '../lib/dates.js';
import { fmtPct, fmtVND } from '../lib/format.js';
import { Money, MoneyInput } from '../components/Money.jsx';
import { useConfirm, useToast } from '../components/feedback.jsx';
import { useQuick } from '../components/QuickPanels.jsx';
import { BANK_KEYS, BankModal, LOAN_KEYS, LoanModal, SettleModal, daysTone, pickRaw } from '../components/forms/bankForms.jsx';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  StatTile,
  ProgressBar,
  Segmented,
  Select,
  TableWrap,
  Textarea,
  cx,
  td,
  th,
} from '../components/ui.jsx';

/* ----------------------------- Trang ----------------------------- */
export default function BankCredit() {
  const quick = useQuick();
  const { banks, loans, loaded } = useData();
  const { actor } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const today = todayISO();
  const month = currentMonth();
  const [bankModal, setBankModal] = useState(null);
  const [loanModal, setLoanModal] = useState(null);
  const [settle, setSettle] = useState(null);
  const [status, setStatus] = useState('ACTIVE');
  const [bankFilter, setBankFilter] = useState('ALL');

  const summary = useMemo(() => bankSummary(banks, loans, today), [banks, loans, today]);
  const bankName = (id) => banks.find((b) => b.id === id)?.name || '(ngân hàng đã xóa)';

  const loanRows = useMemo(
    () =>
      loans
        .filter((l) => status === 'ALL' || l.status === status)
        .filter((l) => bankFilter === 'ALL' || l.bankId === bankFilter)
        .map((l) => ({
          ...l,
          days: l.status === 'ACTIVE' && l.maturityDate ? daysBetween(today, l.maturityDate) : null,
          interest: loanInterestForMonth(l, month),
        }))
        .sort((a, b) => (a.status === b.status ? (a.maturityDate || '').localeCompare(b.maturityDate || '') : a.status === 'ACTIVE' ? -1 : 1)),
    [loans, status, bankFilter, today, month],
  );
  const monthInterest = loanRows.reduce((s, l) => s + (l.status === 'ACTIVE' ? l.interest : 0), 0);

  const removeBank = async (b) => {
    if (loans.some((l) => l.bankId === b.id)) {
      toast.error('Ngân hàng còn khế ước. Hãy xóa hoặc chuyển các KUNN trước.');
      return;
    }
    const ok = await confirm({ title: `Xóa ngân hàng ${b.name}?`, message: 'Thông tin hạn mức sẽ bị xóa (vẫn lưu trong Nhật ký hệ thống).', confirmText: 'Xóa', tone: 'danger' });
    if (!ok) return;
    try {
      const batch = new AuditedBatch(actor);
      batch.remove(C.banks, b.id, pickRaw(b, BANK_KEYS), `Xóa ngân hàng ${b.name}`);
      await batch.commit();
      toast.success('Đã xóa ngân hàng');
    } catch (ex) {
      toast.error(friendlyError(ex));
    }
  };

  const removeLoan = async (l) => {
    const ok = await confirm({
      title: `Xóa KUNN ${l.contractNo}?`,
      message: 'Chỉ nên xóa khi nhập nhầm. Khoản vay đã trả xong hãy dùng "Tất toán" để giữ lịch sử.',
      confirmText: 'Xóa khế ước',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const batch = new AuditedBatch(actor);
      batch.remove(C.loans, l.id, pickRaw(l, LOAN_KEYS), `Xóa KUNN ${l.contractNo} (${bankName(l.bankId)}) — ${fmtVND(l.amount)}`);
      await batch.commit();
      toast.success('Đã xóa khế ước');
    } catch (ex) {
      toast.error(friendlyError(ex));
    }
  };

  const reopen = async (l) => {
    try {
      const batch = new AuditedBatch(actor);
      batch.update(C.loans, l.id, { status: 'ACTIVE', settledDate: '' }, pickRaw(l, LOAN_KEYS), `Mở lại KUNN ${l.contractNo} (hủy tất toán)`);
      await batch.commit();
      toast.success('Đã chuyển về trạng thái Đang vay');
    } catch (ex) {
      toast.error(friendlyError(ex));
    }
  };

  const t = summary.totals;

  return (
    <div>
      <PageHeader
        icon={Landmark}
        tone="sapphire"
        title="Vay ngân hàng & Hạn mức tín dụng"
        subtitle="Theo dõi dư nợ vay và số tiền còn được vay ở từng ngân hàng"
        actions={
          <>
            <Button icon={Building2} onClick={() => setBankModal({})}>
              Thêm ngân hàng
            </Button>
            <Button variant="blue" icon={Plus} onClick={() => setLoanModal({})} disabled={!banks.length}>
              Thêm KUNN
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <StatTile variant="solid" tone="sapphire" icon={Landmark} label="Tổng dư nợ đang vay" value={<Money value={t.outstanding} />} action="Vay / tất toán" onClick={() => quick.open('credit')} />
        <StatTile tone="sapphire" icon={Banknote} label="Còn được vay" value={<Money value={t.available} />} sub={`Đã dùng ${fmtPct(t.usedPct, 0)} hạn mức`} action="Thêm khoản vay" onClick={() => setLoanModal({})} />
        <StatTile tone="ink" icon={Building2} label="Tổng hạn mức được cấp" value={<Money value={t.limit} />} action="Thêm / sửa ngân hàng" onClick={() => setBankModal({})} />
        <StatTile tone="lagoon" icon={PiggyBank} label="Tiền gửi tài khoản" value={<Money value={t.deposit} />} action="Cập nhật số dư" onClick={() => quick.open('deposits')} />
      </div>

      {!loaded.banks ? (
        <Card>
          <EmptyState title="Đang tải…" />
        </Card>
      ) : banks.length === 0 ? (
        <Card>
          <EmptyState
            icon={Landmark}
            title="Chưa có ngân hàng nào"
            description="Thêm ngân hàng cùng tổng hạn mức được cấp, sau đó nhập từng khế ước nhận nợ (KUNN)."
            action={<Button variant="blue" icon={Building2} onClick={() => setBankModal({})}>Thêm ngân hàng</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 mb-4">
          {summary.rows.map((b) => (
            <Card key={b.id} className="p-4 sm:p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-display font-semibold text-ink-900 truncate">{b.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone="blue">{b.activeLoans} khoản vay đang vay</Badge>
                  </div>
                </div>
                <div className="flex shrink-0">
                  <Button size="iconSm" variant="ghost" icon={Plus} title="Thêm KUNN" onClick={() => setLoanModal({ bankId: b.id })} />
                  <Button size="iconSm" variant="ghost" icon={Pencil} title="Sửa" onClick={() => setBankModal({ initial: pickRaw(b, BANK_KEYS) })} />
                  <Button size="iconSm" variant="ghost" icon={Trash2} title="Xóa" onClick={() => removeBank(b)} />
                </div>
              </div>
              <div className="mt-4 flex items-end justify-between gap-2">
                <div>
                  <p className="text-xs text-slate-500">Dư nợ đang vay / Hạn mức</p>
                  <p className="text-sm">
                    <Money value={b.outstanding} className="text-base font-semibold text-slate-900" /> /{' '}
                    <Money value={b.limit} className="text-slate-500" />
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums text-slate-600">{fmtPct(b.usedPct, 0)}</span>
              </div>
              <ProgressBar value={b.usedPct} className="mt-2" />
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <button type="button" onClick={() => setLoanModal({ bankId: b.id })} className="rounded-xl bg-sapphire-50 px-3 py-2 text-left hover:bg-sapphire-100">
                  <p className="text-sapphire-700/80">Còn được vay</p>
                  <Money value={b.available} className="text-sm font-bold text-sapphire-700" />
                </button>
                <button type="button" onClick={() => quick.open('deposits')} className="rounded-xl bg-lagoon-50 px-3 py-2 text-left hover:bg-lagoon-100">
                  <p className="text-lagoon-700/80">Tiền gửi tài khoản</p>
                  <Money value={b.deposit} className="text-sm font-bold text-lagoon-700" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {banks.length > 0 && (
        <Card>
          <div className="flex flex-col gap-3 p-4 border-b border-slate-100 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-ink-900">Các khoản vay (khế ước nhận nợ)</h3>
              <p className="text-xs text-slate-500">
                Lãi ước tính tháng này (theo ngày thực tế/365): <Money value={monthInterest} className="font-semibold text-orange-600" />
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Select value={bankFilter} onChange={(e) => setBankFilter(e.target.value)} className="w-auto min-w-[180px]">
                <option value="ALL">Tất cả ngân hàng</option>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
              <Segmented
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'ACTIVE', label: 'Đang vay' },
                  { value: 'SETTLED', label: 'Đã tất toán' },
                  { value: 'ALL', label: 'Tất cả' },
                ]}
              />
            </div>
          </div>

          {loanRows.length === 0 ? (
            <EmptyState title="Không có khế ước nào" description="Bấm “Thêm KUNN” để ghi nhận khoản giải ngân." />
          ) : (
            <>
              <TableWrap className="hidden md:block">
                <table className="w-full">
                  <thead className="bg-slate-50/80">
                    <tr>
                      <th className={th}>Số KUNN</th>
                      <th className={th}>Ngân hàng</th>
                      <th className={cx(th, 'text-right')}>Số tiền vay</th>
                      <th className={cx(th, 'text-right')}>Lãi suất</th>
                      <th className={th}>Giải ngân</th>
                      <th className={th}>Đáo hạn</th>
                      <th className={th}>Còn lại</th>
                      <th className={cx(th, 'text-right')}>Lãi/tháng (ước)</th>
                      <th className={th} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loanRows.map((l) => (
                      <tr key={l.id} className={cx('hover:bg-slate-50/70', l.status === 'SETTLED' && 'text-slate-400')}>
                        <td className={td}>
                          <p className="font-medium text-slate-800">{l.contractNo}</p>
                          {l.purpose && <p className="text-xs text-slate-500 max-w-[220px] truncate">{l.purpose}</p>}
                        </td>
                        <td className={cx(td, 'whitespace-nowrap')}>{bankName(l.bankId)}</td>
                        <td className={cx(td, 'text-right')}>
                          <Money value={l.amount} className="font-semibold" />
                        </td>
                        <td className={cx(td, 'text-right tabular-nums')}>{fmtPct(l.interestRate, 2)}</td>
                        <td className={cx(td, 'tabular-nums whitespace-nowrap')}>{fmtDate(l.disbursedDate)}</td>
                        <td className={cx(td, 'tabular-nums whitespace-nowrap')}>{fmtDate(l.maturityDate)}</td>
                        <td className={td}>
                          {l.status === 'ACTIVE' ? (
                            <Badge tone={daysTone(l.days)}>{describeDays(l.days)}</Badge>
                          ) : (
                            <Badge tone="green">Tất toán {fmtDate(l.settledDate)}</Badge>
                          )}
                        </td>
                        <td className={cx(td, 'text-right')}>{l.status === 'ACTIVE' && <Money value={l.interest} className="text-orange-600" />}</td>
                        <td className={cx(td, 'text-right whitespace-nowrap')}>
                          {l.status === 'ACTIVE' ? (
                            <Button size="xs" variant="success" icon={CircleCheck} onClick={() => setSettle(pickRaw(l, LOAN_KEYS))}>
                              Tất toán
                            </Button>
                          ) : (
                            <Button size="xs" variant="ghost" icon={RotateCcw} onClick={() => reopen(l)} title="Hủy tất toán" />
                          )}
                          <Button size="iconSm" variant="ghost" icon={Pencil} onClick={() => setLoanModal({ initial: pickRaw(l, LOAN_KEYS) })} title="Sửa" />
                          <Button size="iconSm" variant="ghost" icon={Trash2} onClick={() => removeLoan(l)} title="Xóa" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>

              <ul className="md:hidden divide-y divide-slate-100">
                {loanRows.map((l) => (
                  <li key={l.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800">{l.contractNo}</p>
                        <p className="text-xs text-slate-500">
                          {bankName(l.bankId)} · {fmtPct(l.interestRate, 2)}/năm
                        </p>
                        <p className="text-xs text-slate-500">
                          {fmtDate(l.disbursedDate)} → {fmtDate(l.maturityDate)}
                        </p>
                      </div>
                      <div className="text-right">
                        <Money value={l.amount} className="block text-sm font-semibold text-slate-900" />
                        {l.status === 'ACTIVE' ? (
                          <Badge tone={daysTone(l.days)} className="mt-1">{describeDays(l.days)}</Badge>
                        ) : (
                          <Badge tone="green" className="mt-1">Đã tất toán</Badge>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex justify-end gap-1">
                      {l.status === 'ACTIVE' && (
                        <Button size="xs" variant="success" icon={CircleCheck} onClick={() => setSettle(pickRaw(l, LOAN_KEYS))}>
                          Tất toán
                        </Button>
                      )}
                      <Button size="xs" variant="secondary" icon={Pencil} onClick={() => setLoanModal({ initial: pickRaw(l, LOAN_KEYS) })}>
                        Sửa
                      </Button>
                      <Button size="xs" variant="dangerGhost" icon={Trash2} onClick={() => removeLoan(l)}>
                        Xóa
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      <BankModal open={!!bankModal} onClose={() => setBankModal(null)} initial={bankModal?.initial} />
      <LoanModal
        open={!!loanModal}
        onClose={() => setLoanModal(null)}
        initial={loanModal?.initial}
        defaultBankId={loanModal?.bankId}
        banks={banks}
        bankRows={summary.rows}
      />
      <SettleModal open={!!settle} onClose={() => setSettle(null)} loan={settle} bankName={settle ? bankName(settle.bankId) : ''} />
    </div>
  );
}
