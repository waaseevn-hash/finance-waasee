import { useMemo, useState } from 'react';
import {
  BadgeCheck,
  ChartColumnBig,
  CircleArrowDown,
  CircleArrowUp,
  Gauge,
  HandCoins,
  Landmark,
  PiggyBank,
  Radar,
  ReceiptText,
  Siren,
  Vault, Stamp, Wallet, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { apSummary, arSummary, bankSummary, buildRadar, cashBalance, cashMonthStats } from '../lib/calc.js';
import { currentMonth, fmtDate, shiftMonth, todayISO } from '../lib/dates.js';
import { fmtPct } from '../lib/format.js';
import { can } from '../lib/roles.js';
import { openPayOrders } from '../lib/approvals.js';
import { Money } from '../components/Money.jsx';
import { useQuick } from '../components/QuickPanels.jsx';
import { BankUsageBars, CashFlowChart } from '../components/Charts.jsx';
import { Card, CardHeader, Drawer, EmptyState, PageHeader, Spinner, StatTile, cx } from '../components/ui.jsx';
import { QuickApprovalList, useMoneyNow, usePendingApprovals } from '../components/NotificationCenter.jsx';
import { MAIN_HOLDER, holderBalances } from '../lib/calc.js';
import { PayOrderButton } from '../components/PayOrderPrint.jsx';
import { useCashHolders } from '../lib/holders.js';

const KIND_ICON = { LOAN: Landmark, AR: CircleArrowDown, AP: CircleArrowUp };
const KIND_LABEL = { LOAN: 'Đáo hạn vay', AR: 'Phải thu', AP: 'Phải trả P1' };

export default function Dashboard() {
  const { role, me } = useAuth();
  const data = useData();
  const quick = useQuick();
  const treasury = can(role, 'viewTreasury');
  const today = todayISO();
  const thisMonth = currentMonth();
  const orders = useMemo(() => openPayOrders(data.approvals, data.ap, data.suppliers), [data.approvals, data.ap, data.suppliers]);
  const [moneyOpen, setMoneyOpen] = useState(false);
  const pending = usePendingApprovals();
  const money = useMoneyNow();
  const approver = can(role, 'approveVouchers');

  const m = useMemo(() => {
    const cash = cashBalance(data.cash);
    const month = cashMonthStats(data.cash, thisMonth);
    const bank = bankSummary(data.banks, data.loans, today);
    const ar = arSummary(data.ar, today);
    const ap = apSummary(data.ap, today);
    const radar = buildRadar({ loans: data.loans, banks: data.banks, ar: data.ar, ap: data.ap, today, includeTreasury: treasury });
    const liquidity = cash + bank.totals.deposit + bank.totals.available;
    const flow = Array.from({ length: 6 }, (_, i) => {
      const ym = shiftMonth(thisMonth, i - 5);
      const st = cashMonthStats(data.cash, ym);
      const [y, mm] = ym.split('-');
      return { month: ym, label: `T${Number(mm)}`, title: `Tháng ${Number(mm)}/${y}`, inSum: st.inSum, outSum: st.outSum };
    });
    return { cash, month, bank, ar, ap, radar, liquidity, flow };
  }, [data.cash, data.banks, data.loans, data.ar, data.ap, today, treasury, thisMonth]);

  if (!data.ready) {
    return (
      <div className="grid place-items-center py-24 text-slate-500 text-sm gap-3">
        <Spinner className="h-6 w-6" /> Đang đồng bộ dữ liệu…
      </div>
    );
  }

  const redCount = m.radar.filter((a) => a.level === 'red').length;
  // Chủ DN xem 1 con số tiền đang có; bấm vào mới tách tiền mặt / tiền gửi
  const parts = [
    { key: 'money', label: 'Tổng tiền đang có (khả dụng chi)', value: m.cash + m.bank.totals.deposit, color: '#34d399', icon: Wallet, open: () => setMoneyOpen(true), hint: 'Bấm để xem chi tiết' },
    { key: 'credit', label: 'Còn được vay ngân hàng', value: m.bank.totals.available, color: '#93c5fd', icon: Landmark, open: () => quick.open('credit'), hint: 'Bấm để vay / tất toán' },
  ];
  const partsTotal = parts.reduce((s, p) => s + Math.max(0, p.value), 0) || 1;
  const arTotal = m.ar.total || 1;

  const openAlert = (a) => {
    if (a.kind === 'LOAN') quick.open('credit');
    else if (a.kind === 'AR') quick.open('ar', { filter: 'overdue' });
    else quick.open('ap', { filter: 'p1' });
  };

  return (
    <div>
      <PageHeader
        icon={Gauge}
        tone="lagoon"
        title="Sức khỏe dòng tiền"
        subtitle={`${me?.name ? `Chào ${me.name} · ` : ''}số liệu cập nhật tức thời · ${fmtDate(today)}`}
      />

      {orders.length > 0 && (
        <a
          href="#partners-chi"
          className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-vermilion-200 bg-vermilion-50 px-4 py-3 text-sm text-vermilion-800 hover:bg-vermilion-100"
        >
          <Stamp className="h-5 w-5 shrink-0" />
          <span className="flex-1">
            Có <b>{orders.length} lệnh chi đã duyệt</b> chờ chuyển tiền cho nhà cung cấp, tổng <Money value={orders.reduce((s, o) => s + o.payAmount, 0)} className="font-bold" />
          </span>
          <span className="font-semibold underline">Xem danh sách đi lệnh</span>
        </a>
      )}
      {approver && orders.length > 0 && (
        <div className="-mt-3 mb-5 flex justify-end">
          <PayOrderButton size="sm" label="In lệnh chi bàn giao kế toán" />
        </div>
      )}

      {treasury && (
        <section className="relative mb-5 overflow-hidden rounded-3xl bg-gradient-to-br from-ink-800 via-ink-900 to-ink-950 text-white shadow-xl">
          <div className="absolute inset-0 guilloche opacity-90" />
          <div className="relative grid gap-6 p-5 sm:p-7 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] xl:items-center">
            <div>
              <p className="text-sm text-white/70">Tổng sức mạnh thanh khoản khả dụng</p>
              <p className="mt-1 font-display text-4xl sm:text-5xl font-bold tracking-tight">
                <Money value={m.liquidity} />
              </p>
              <p className="mt-2 text-sm text-white/60">Tổng tiền đang có + số tiền còn được vay ngân hàng</p>
            </div>
            <div>
              <div className="flex h-4 w-full gap-[3px] overflow-hidden rounded-full bg-white/10">
                {parts.map((p) =>
                  p.value > 0 ? (
                    <button
                      type="button"
                      key={p.key}
                      title={p.label}
                      onClick={p.open}
                      className="h-full first:rounded-l-full last:rounded-r-full hover:brightness-110"
                      style={{ width: `${(Math.max(0, p.value) / partsTotal) * 100}%`, background: p.color }}
                    />
                  ) : null,
                )}
              </div>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {parts.map((p) => (
                  <button
                    type="button"
                    key={p.key}
                    onClick={p.open}
                    className="group flex items-start gap-2.5 rounded-2xl bg-white/[0.07] px-3 py-2.5 text-left ring-1 ring-inset ring-white/10 hover:bg-white/[0.12]"
                  >
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
                    <span className="min-w-0">
                      <span className="block text-xs text-white/65">{p.label}</span>
                      <Money value={p.value} className="block font-display text-[15px] font-semibold" />
                      <span className="text-[11px] text-white/45 group-hover:text-white/80">{p.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      <div className={cx('grid gap-4 grid-cols-1 sm:grid-cols-2', treasury && 'xl:grid-cols-4')}>
        {treasury && (
          <StatTile
            variant="solid"
            tone="sapphire"
            icon={Landmark}
            label="Dư nợ vay ngân hàng"
            value={<Money value={m.bank.totals.outstanding} />}
            sub={
              <>
                <span className="mb-1.5 mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-white/20">
                  <span className="block h-full rounded-full bg-white" style={{ width: `${m.bank.totals.usedPct}%` }} />
                </span>
                Còn được vay <Money value={m.bank.totals.available} className="font-semibold" /> · đã dùng {fmtPct(m.bank.totals.usedPct, 0)}
              </>
            }
            action="Vay / tất toán"
            onClick={() => quick.open('credit')}
          />
        )}
        {treasury && (
          <StatTile
            variant="solid"
            tone="jade"
            icon={Wallet}
            label="Tổng tiền đang có (Khả dụng chi)"
            value={<Money value={m.cash + m.bank.totals.deposit} />}
            sub={
              money.committed.out > 0 ? (
                <>
                  Đã duyệt chờ chi <Money value={money.committed.out} className="font-semibold" /> · còn tự do <Money value={money.free} className="font-semibold" />
                </>
              ) : (
                'Tiền mặt và tiền gửi ngân hàng'
              )
            }
            action="Xem chi tiết"
            onClick={() => setMoneyOpen(true)}
          />
        )}
        <StatTile
          variant="solid"
          tone="lagoon"
          icon={HandCoins}
          label="Công nợ phải thu"
          value={<Money value={m.ar.total} />}
          sub={
            <>
              Trong hạn <Money value={m.ar.inTerm} className="font-semibold" /> · quá hạn <Money value={m.ar.overdue} className="font-semibold" />
            </>
          }
          action="Thu tiền / thêm khoản"
          onClick={() => quick.open('ar')}
        />
        <StatTile
          variant="solid"
          tone="vermilion"
          icon={ReceiptText}
          label="Phải trả trong tháng này"
          value={<Money value={m.ap.dueThisMonth} />}
          sub={
            <>
              Quá hạn <Money value={m.ap.overdue} className="font-semibold" /> · P1 <Money value={m.ap.p1Due} className="font-semibold" />
            </>
          }
          action={can(role, 'approvePayments') ? 'Duyệt chi / thêm khoản' : 'Xem / thêm khoản'}
          onClick={() => quick.open('ap', { filter: 'month' })}
        />
      </div>

      {approver && (
        <Card className="mt-4">
          <CardHeader
            title="Khoản chờ duyệt ngay"
            subtitle={
              pending.length ? (
                <>
                  {pending.length} khoản · chờ duyệt <Money value={pending.reduce((t, it) => t + it.out - it.inn, 0)} className="font-semibold" /> so với tiền đang có{' '}
                  <Money value={money.free} className="font-semibold" />
                </>
              ) : (
                'Không có khoản nào chờ duyệt'
              )
            }
            icon={Stamp}
            iconClass="bg-vermilion-50 text-vermilion-700"
          />
          {pending.length > 0 && (
            <div className="px-4 pb-4 sm:px-5 sm:pb-5">
              <QuickApprovalList limit={4} compact onMore={() => (window.location.hash = 'approve')} />
            </div>
          )}
        </Card>
      )}

      {treasury && (
        <div className="mt-4 grid gap-4 grid-cols-1 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Thu – chi tiền mặt 6 tháng gần nhất" subtitle="Bấm vào một tháng để xem và sửa các phiếu" icon={ChartColumnBig} iconClass="bg-jade-50 text-jade-700" />
            <div className="px-4 sm:px-5 pb-5">
              <CashFlowChart data={m.flow} onSelect={(d) => quick.open('cash', { month: d.month })} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Vay theo ngân hàng" subtitle="Dư nợ và số tiền còn được vay" icon={Landmark} iconClass="bg-sapphire-50 text-sapphire-700" />
            <div className="px-4 sm:px-5 pb-5">
              <BankUsageBars rows={m.bank.rows} onSelect={() => quick.open('credit')} />
            </div>
          </Card>
        </div>
      )}

      <div className="mt-4 grid gap-4 grid-cols-1 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Cảnh báo hành động"
            subtitle={treasury ? 'Khoản vay đáo hạn trong 30 ngày, phải thu quá hạn, phải trả P1 sắp đến hạn' : 'Phải thu quá hạn, phải trả P1 sắp đến hạn'}
            icon={Radar}
            iconClass={redCount ? 'bg-rose-50 text-rose-600' : 'bg-jade-50 text-jade-600'}
            actions={
              m.radar.length > 0 && (
                <span className="flex gap-1.5 text-xs font-semibold">
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">{redCount} gấp</span>
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">{m.radar.length - redCount} cần theo dõi</span>
                </span>
              )
            }
          />
          {m.radar.length === 0 ? (
            <EmptyState icon={BadgeCheck} title="Không có việc gấp" description="Các khoản vay và công nợ đều đang trong hạn." />
          ) : (
            <ul className="divide-y divide-slate-100 border-t border-slate-100 max-h-[460px] overflow-y-auto thin-scroll">
              {m.radar.map((a) => {
                const Icon = KIND_ICON[a.kind] || Siren;
                const red = a.level === 'red';
                return (
                  <li key={a.id}>
                    <button type="button" onClick={() => openAlert(a)} className="flex w-full items-center gap-3 px-4 sm:px-5 py-3 text-left hover:bg-slate-50">
                      <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-xl', red ? 'bg-rose-600 text-white' : 'bg-amber-400 text-ink-900')}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-ink-900 truncate">{a.title}</span>
                        <span className="block text-xs text-slate-500 truncate">
                          {KIND_LABEL[a.kind]} · {a.sub} · {fmtDate(a.date)}
                        </span>
                      </span>
                      <Money value={a.amount} className={cx('text-sm font-bold', red ? 'text-rose-600' : 'text-amber-700')} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Tuổi nợ phải thu" subtitle="Bấm để xem và thu tiền" icon={HandCoins} iconClass="bg-lagoon-50 text-lagoon-700" />
          <div className="px-4 sm:px-5 pb-5 space-y-3">
            {[
              ['Trong hạn', m.ar.aging.current, 'bg-jade-500', 'inTerm'],
              ['Quá hạn 1–30 ngày', m.ar.aging.d1_30, 'bg-amber-400', 'overdue'],
              ['Quá hạn 31–60 ngày', m.ar.aging.d31_60, 'bg-vermilion-500', 'overdue'],
              ['Quá hạn 61–90 ngày', m.ar.aging.d61_90, 'bg-rose-500', 'overdue'],
              ['Quá hạn trên 90 ngày', m.ar.aging.d90, 'bg-rose-700', 'overdue'],
            ].map(([label, v, color, filter]) => (
              <button type="button" key={label} onClick={() => quick.open('ar', { filter })} className="block w-full text-left">
                <span className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600">{label}</span>
                  <Money value={v} className="font-semibold text-ink-900" />
                </span>
                <span className="block h-2.5 rounded-full bg-slate-100 overflow-hidden">
                  <span className={cx('block h-full rounded-full', color)} style={{ width: `${(v / arTotal) * 100}%` }} />
                </span>
              </button>
            ))}
            {m.ar.doubtful > 0 && (
              <button type="button" onClick={() => quick.open('ar', { filter: 'doubtful' })} className="w-full rounded-xl bg-rose-50 px-3 py-2 text-left text-xs text-rose-700">
                Nợ khó đòi đang theo dõi: <Money value={m.ar.doubtful} className="font-semibold" />
              </button>
            )}
          </div>
        </Card>
      </div>
      {treasury && <MoneyDrawer open={moneyOpen} onClose={() => setMoneyOpen(false)} quick={quick} />}
    </div>
  );
}

/** Chi tiết "Tổng tiền đang có": tiền mặt (két + từng người giữ) và tiền gửi từng ngân hàng */
function MoneyDrawer({ open, onClose, quick }) {
  const data = useData();
  const holders = useCashHolders(open);
  const money = useMoneyNow();
  const bal = useMemo(() => holderBalances(data.cash || []), [data.cash]);
  const rows = holders.all.filter((h) => h.active || (bal[h.id] || 0) !== 0);
  const go = (fn) => {
    onClose();
    fn();
  };
  const Line = ({ icon: Icon, label, value, sub, onClick }) => (
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink-900">{label}</span>
          {sub && <span className="block truncate text-xs text-slate-500">{sub}</span>}
        </span>
        <Money value={value} className={cx('shrink-0 text-sm font-semibold', value < 0 ? 'text-rose-600' : 'text-ink-900')} />
      </button>
    </li>
  );
  return (
    <Drawer
      open={open}
      onClose={onClose}
      tone="jade"
      icon={Wallet}
      title="Tổng tiền đang có"
      subtitle="Tiền mặt và tiền gửi ngân hàng — số dùng được để chi"
      hero={
        <div>
          <Money value={money.total} className="block font-display text-3xl font-bold" />
          {money.committed.out > 0 && (
            <p className="mt-1 text-sm text-white/80">
              Đã duyệt chờ chi <Money value={money.committed.out} className="font-semibold" /> → còn tự do <Money value={money.free} className="font-semibold" />
            </p>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between bg-slate-50 px-4 py-2.5">
            <p className="text-sm font-semibold text-ink-900">Tiền mặt</p>
            <Money value={money.cash} className="text-sm font-bold text-jade-700" />
          </div>
          <ul className="divide-y divide-slate-100">
            {rows.map((h) => (
              <Line key={h.id} icon={h.id === MAIN_HOLDER ? Vault : UserRound} label={h.id === MAIN_HOLDER ? h.name : `${h.name} đang giữ`} value={bal[h.id] || 0} onClick={() => go(() => (window.location.hash = 'cash'))} />
            ))}
          </ul>
        </section>
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between bg-slate-50 px-4 py-2.5">
            <p className="text-sm font-semibold text-ink-900">Tiền gửi ngân hàng</p>
            <Money value={money.deposits} className="text-sm font-bold text-lagoon-700" />
          </div>
          {(data.banks || []).length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">Chưa có tài khoản ngân hàng.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {(data.banks || []).map((b) => (
                <Line key={b.id} icon={PiggyBank} label={b.name} sub={b.accountNo ? `TK ${b.accountNo}` : ''} value={Number(b.depositBalance) || 0} onClick={() => go(() => quick.open('deposits'))} />
              ))}
            </ul>
          )}
        </section>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => go(() => quick.open('cash'))} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Thu / chi tiền mặt
          </button>
          <button type="button" onClick={() => go(() => quick.open('deposits'))} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Cập nhật số dư tiền gửi
          </button>
        </div>
      </div>
    </Drawer>
  );
}
