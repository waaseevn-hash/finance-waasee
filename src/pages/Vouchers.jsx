import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  CircleCheck,
  ClipboardCheck,
  FileClock,
  FileSpreadsheet,
  FileStack,
  FileText,
  Inbox,
  Layers,
  Printer,
  ReceiptText,
  Search,
  Stamp,
  UserRoundCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { can } from '../lib/roles.js';
import { friendlyError } from '../lib/db.js';
import { currentMonth, daysBetween, fmtDate, todayISO } from '../lib/dates.js';
import { fmtVND, matchSearch } from '../lib/format.js';
import { cashBalance, holderBalances } from '../lib/calc.js';
import { useCashHolders, usePayAccounts } from '../lib/holders.js';
import { useCompany } from '../lib/brand.js';
import { VSTATUS, VTYPE, advanceRemaining, bankFlow, batchFromDocs, cashEffect, docsOfBatch, isBank, isPartial, openAdvances, requestedAmount, voucherAmount, voucherStats } from '../lib/vouchers.js';
import { approveVouchers, postVouchers } from '../lib/voucherService.js';
import { downloadBatchXlsx } from '../lib/voucherExcel.js';
import { useToast } from '../components/feedback.jsx';
import { Money } from '../components/Money.jsx';
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, PageHeader, Segmented, Select, Tabs, cx } from '../components/ui.jsx';
import { Figure, MiniStat } from '../components/Figure.jsx';
import { Who } from '../components/Who.jsx';
import { TYPE_ICON, TYPE_STYLE, VStatusBadge, VTypeChip } from '../components/vouchers/common.jsx';
import { VoucherEditor } from '../components/vouchers/VoucherEditor.jsx';
import { VoucherDrawer } from '../components/vouchers/VoucherDrawer.jsx';
import { PrintPreview } from '../components/vouchers/PrintPreview.jsx';

const PADS = [
  { type: 'TU', title: 'Đề nghị tạm ứng', note: 'Ứng tiền trước để đi công tác, mua hàng' },
  { type: 'TT', title: 'Đề nghị thanh toán', note: 'Bảng kê chi phí, hoàn ứng / chi bổ sung' },
  { type: 'PT', title: 'Phiếu thu', note: 'Tiền mặt nộp vào két' },
  { type: 'PC', title: 'Phiếu chi', note: 'Tiền mặt chi ra từ két' },
];

/** Tổng hợp nhanh một tập chứng từ khi chốt sổ */
function previewTotals(list) {
  let rc = 0;
  let rt = 0;
  let pc = 0;
  let pt = 0;
  let bic = 0;
  let bit = 0;
  let boc = 0;
  let bot = 0;
  for (const v of list) {
    const e = cashEffect(v);
    const b = bankFlow(v);
    if (e.in > 0) {
      rc += 1;
      rt += e.in;
    }
    if (e.out > 0) {
      pc += 1;
      pt += e.out;
    }
    if (b.in > 0) {
      bic += 1;
      bit += b.in;
    }
    if (b.out > 0) {
      boc += 1;
      bot += b.out;
    }
  }
  return { receiptsCount: rc, receiptsTotal: rt, paymentsCount: pc, paymentsTotal: pt, net: rt - pt, bankInCount: bic, bankInTotal: bit, bankCount: boc, bankTotal: bot, bankNet: bit - bot };
}

/** Tài khoản ngân hàng mặc định để chi / nhận chuyển khoản: ưu tiên tài khoản đã khai số tài khoản */
const defaultPayBank = (banks = []) => banks.find((b) => b.accountNo) || banks[0] || null;


function VoucherRow({ v, selectable, selected, onSelect, onOpen }) {
  const Icon = TYPE_ICON[v.type];
  const amt = voucherAmount(v);
  const eff = cashEffect(v);
  const sign = v.type === 'PT' ? 'in' : v.type === 'PC' || v.type === 'TU' ? 'out' : eff.in > 0 ? 'in' : 'out';
  return (
    <li className={cx('flex items-start sm:items-center gap-3 px-4 sm:px-5 py-3 hover:bg-slate-50/80 transition-colors', selected && 'bg-amber-50/60')}>
      {selectable && (
        <div className="pt-2 sm:pt-0">
          <Checkbox checked={selected} onChange={onSelect} title="Chọn" />
        </div>
      )}
      <button type="button" onClick={() => onOpen(v.id)} className="flex flex-1 min-w-0 items-start sm:items-center gap-3 text-left">
        <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', TYPE_STYLE[v.type].icon)}>
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-ink-900 truncate">{v.person}</span>
            <VTypeChip type={v.type} auto={v.auto} />
            {v.no && <span className="font-mono text-[11px] text-slate-500">{v.no}</span>}
            {isBank(v) && <span className="rounded bg-sapphire-50 px-1.5 py-px text-[10px] font-semibold text-sapphire-700 ring-1 ring-inset ring-sapphire-200">CK</span>}
            {v.status === 'APPROVED' && v.paidAt && (
              <span className="rounded bg-jade-50 px-1.5 py-px text-[10px] font-semibold text-jade-700 ring-1 ring-inset ring-jade-200" title={`Kế toán báo đã chi ${fmtDate(v.paidAt)}`}>
                Đã chi
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-xs text-slate-500 truncate">
            {fmtDate(v.date)} · {v.reason}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <Money value={amt} className={cx('block text-sm font-semibold', sign === 'in' ? 'text-jade-700' : 'text-ink-900')} />
          {isPartial(v) && (
            <span className="block text-[11px] text-slate-400" title="Duyệt một phần">
              duyệt 1 phần / <Money value={requestedAmount(v)} />
            </span>
          )}
          <span className="mt-1 inline-block">
            <VStatusBadge status={v.status} />
          </span>
        </span>
      </button>
    </li>
  );
}

/** Số liệu tháng: tổng thu, tổng chi, chênh lệch + các việc đang chờ */
/** Thanh so sánh: tiền đang có và số cần chi (đã duyệt + chờ duyệt) trên cùng một thang */
function CoverBars({ cash, approvedOut, pendingOut }) {
  const scale = Math.max(cash, approvedOut + pendingOut, 1);
  const pct = (v) => `${Math.max(0, (v / scale) * 100)}%`;
  return (
    <div className="space-y-1.5" aria-hidden="true">
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-[11px] text-slate-500">Đang có</span>
        <span className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
          <span className="h-full rounded-full bg-jade-500" style={{ width: pct(cash) }} />
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-[11px] text-slate-500">Cần chi</span>
        <span className="flex h-2.5 flex-1 gap-[2px] overflow-hidden rounded-full bg-slate-100">
          {approvedOut > 0 && <span className="h-full rounded-full bg-sapphire-500" style={{ width: pct(approvedOut) }} title="Đã duyệt, chờ chốt sổ" />}
          {pendingOut > 0 && <span className="h-full rounded-full bg-amber-400" style={{ width: pct(pendingOut) }} title="Chờ duyệt" />}
        </span>
      </div>
    </div>
  );
}

function VoucherSummary({ stats, cash, deposits, treasury, manager, ready, onGo, holdersLine }) {
  const s = stats;
  const avail = cash + deposits;
  const needCash = s.pendingOut + s.approvedOut;
  const needBank = s.pendingBank + s.approvedBank;
  const need = needCash + needBank;
  // Ưu tiên: chốt sổ các khoản đã duyệt trước, sau đó mới tới các khoản đang chờ duyệt (tính cả tiền mặt và tiền gửi)
  const afterApproved = avail - s.approvedOut - s.approvedBank + s.approvedIn + s.approvedBankIn;
  const afterAll = afterApproved - s.pendingOut - s.pendingBank + s.pendingIn + s.pendingBankIn;
  const cashAfterAll = cash - needCash + s.approvedIn + s.pendingIn;
  const Left = ({ v }) => (
    <b className={v < 0 ? 'text-rose-600' : 'text-ink-900'}>
      {v < 0 ? 'thiếu ' : 'còn '}
      <Money value={Math.abs(v)} />
    </b>
  );
  return (
    <Card className="mb-5">
      <div className="px-4 sm:px-5 pt-4">
        <p className="font-display text-base font-bold text-ink-900">{treasury ? 'Dòng tiền và các khoản cần chi' : 'Các khoản cần chi'}</p>
        <p className="text-xs text-slate-500">
          {treasury ? 'Tiền mặt + tiền gửi ngân hàng đối chiếu với khoản chờ duyệt và khoản đã duyệt chưa chi' : 'Khoản chờ duyệt và khoản Sếp đã duyệt chưa chốt sổ'}
        </p>
      </div>
      <div className={cx('grid gap-3 sm:gap-6 px-4 sm:px-5 pt-4 pb-3', treasury ? 'grid-cols-2' : 'grid-cols-1')}>
        {treasury && (
          <Figure
            label="Số tiền khả dụng"
            value={avail}
            tone="text-jade-700"
            sub={
              <>
                tiền mặt <Money value={cash} /> · tiền gửi <Money value={deposits} />
              </>
            }
          />
        )}
        <Figure
          label="Số tiền cần phải chi"
          value={ready ? need : 0}
          tone={need > 0 ? 'text-vermilion-600' : 'text-slate-400'}
          align={treasury ? 'right' : 'left'}
          sub={
            need > 0 ? (
              <>
                tiền mặt <Money value={needCash} /> · chuyển khoản <Money value={needBank} />
              </>
            ) : (
              'không có khoản nào'
            )
          }
        />
      </div>
      {treasury && ready && need > 0 && (
        <div className="px-4 sm:px-5 pb-4">
          <CoverBars cash={avail} approvedOut={s.approvedOut + s.approvedBank} pendingOut={s.pendingOut + s.pendingBank} />
          <div className="mt-2.5 grid gap-1 text-xs text-slate-600 sm:grid-cols-2 sm:gap-4">
            {s.approvedCount > 0 && (
              <p className="flex items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full bg-sapphire-500" />
                <span>
                  Chi xong {s.approvedCount} khoản đã duyệt: <Left v={afterApproved} />
                </span>
              </p>
            )}
            {s.pendingCount > 0 && (
              <p className="flex items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />
                <span>
                  Duyệt thêm {s.pendingCount} chứng từ chờ duyệt: <Left v={afterAll} />
                </span>
              </p>
            )}
          </div>
          {cashAfterAll < 0 && afterAll >= 0 && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
              Riêng tiền mặt thiếu <Money value={-cashAfterAll} className="font-semibold" /> — rút thêm tiền gửi về két hoặc chuyển một số khoản sang chuyển khoản.
            </p>
          )}
        </div>
      )}
      {holdersLine && treasury && <p className="-mt-2 px-4 pb-3 text-[11px] text-slate-500 sm:px-5">Tiền mặt theo người giữ: {holdersLine}</p>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-100 border-t border-slate-100">
        <MiniStat
          label="Chờ duyệt"
          value={`${s.pendingCount} chứng từ`}
          sub={s.pendingCount ? <Money value={s.pendingAmount} /> : 'không có'}
          tone={s.pendingCount ? 'text-amber-700' : 'text-slate-400'}
          onClick={s.pendingCount ? () => onGo(manager ? 'pending' : 'all') : undefined}
        />
        <MiniStat
          label="Đã duyệt, chờ chi / chốt sổ"
          value={`${s.approvedCount} chứng từ`}
          sub={
            s.approvedCount ? (
              <>
                chi <Money value={s.approvedOut + s.approvedBank} />
                {s.approvedIn + s.approvedBankIn > 0 && (
                  <>
                    {' '}
                    · thu <Money value={s.approvedIn + s.approvedBankIn} />
                  </>
                )}
              </>
            ) : (
              'không có'
            )
          }
          tone={s.approvedCount ? 'text-sapphire-700' : 'text-slate-400'}
          onClick={s.approvedCount && manager ? () => onGo('post') : undefined}
        />
        <MiniStat
          label="Tạm ứng chưa quyết toán"
          value={<Money value={s.advanceOpen} />}
          sub={s.advanceCount ? `${s.advanceCount} giấy · ${s.advancePeople} người` : 'không có'}
          tone={s.advanceOpen ? 'text-amber-700' : 'text-slate-400'}
          onClick={s.advanceCount ? () => onGo('advances') : undefined}
        />
        <MiniStat label="Chi phí ghi nhận tháng này" value={<Money value={s.expense} />} sub={treasury ? 'theo loại chi phí đã chốt sổ' : 'theo TK chi phí (15x, 6xx, 8xx)'} />
      </div>
    </Card>
  );
}

export default function Vouchers({ params }) {
  const { actor, role, me } = useAuth();
  const data = useData();
  const toast = useToast();
  const company = useCompany();
  const manager = can(role, 'approveVouchers');
  const poster = can(role, 'postVouchers');
  const acct = can(role, 'accountingView');

  const [tab, setTab] = useState(params?.tab || 'all');
  useEffect(() => {
    if (params?.tab) setTab(params.tab);
  }, [params?.tab]);

  const [editor, setEditor] = useState(null); // { type } | { existing } | { type, prefill }
  const [openId, setOpenId] = useState(null);
  const [print, setPrint] = useState(null); // { docs, batch, title, fileBase, cash, paper }
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [month, setMonth] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(() => new Set());
  const [postSel, setPostSel] = useState(() => new Set());
  const [postDate, setPostDate] = useState(todayISO());
  const [paper, setPaper] = useState('A4');
  const [confirmPost, setConfirmPost] = useState(false);
  const [busy, setBusy] = useState('');
  const [payBankId, setPayBankId] = useState('');
  // Quản lý: danh sách ngân hàng đầy đủ (có số dư). Kế toán: danh sách tài khoản thanh toán (không có số dư)
  const payAccounts = usePayAccounts(!can(role, 'viewTreasury'));
  const bankChoices = can(role, 'viewTreasury') ? data.banks || [] : payAccounts;
  const payBank = bankChoices.find((b) => b.id === payBankId) || defaultPayBank(bankChoices);

  // Việc cần làm → "Chốt sổ & in phiếu": chọn sẵn các khoản đã chi
  useEffect(() => {
    if (tab !== 'post') return;
    try {
      const raw = sessionStorage.getItem('postSel');
      if (!raw) return;
      sessionStorage.removeItem('postSel');
      const ids = JSON.parse(raw);
      if (Array.isArray(ids) && ids.length) setPostSel(new Set(ids));
    } catch {
      /* bỏ qua */
    }
  }, [tab]);

  // Mở chứng từ từ màn hình khác (vd Sổ quỹ bấm vào số phiếu)
  useEffect(() => {
    const take = () => {
      const id = sessionStorage.getItem('openVoucher');
      if (id) {
        sessionStorage.removeItem('openVoucher');
        setTab('all');
        setOpenId(id);
      }
    };
    take();
    window.addEventListener('open-voucher', take);
    return () => window.removeEventListener('open-voucher', take);
  }, []);

  const all = useMemo(() => [...(data.vouchers || [])].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.no || '').localeCompare(a.no || '')), [data.vouchers]);
  const pending = all.filter((v) => v.status === 'PENDING');
  const approved = useMemo(() => all.filter((v) => v.status === 'APPROVED' && !v.auto).sort((a, b) => (a.date || '').localeCompare(b.date || '')), [all]);
  const advances = useMemo(() => openAdvances(all), [all]);
  const batches = useMemo(() => [...(data.batches || [])].sort((a, b) => (b.code || '').localeCompare(a.code || '')), [data.batches]);
  const stats = useMemo(() => voucherStats(all, currentMonth()), [all]);
  const treasury = can(role, 'viewTreasury');
  const holders = useCashHolders(treasury);
  const cashNow = useMemo(() => (treasury ? cashBalance(data.cash) : 0), [treasury, data.cash]);
  const depositsNow = useMemo(() => (treasury ? (data.banks || []).reduce((t, b) => t + (Number(b.depositBalance) || 0), 0) : 0), [treasury, data.banks]);
  const holdersLine = useMemo(() => {
    if (!treasury) return '';
    const bal = holderBalances(data.cash);
    const parts = holders.active.filter((h) => (bal[h.id] || 0) !== 0);
    if (parts.length < 2) return '';
    return parts.map((h) => `${h.name} ${fmtVND(bal[h.id] || 0)}`).join(' · ');
  }, [treasury, data.cash, holders]);
  const goTab = (t) => {
    setTab(t);
    if (t === 'all') setStatusFilter('PENDING');
    document.getElementById('voucher-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const filtered = useMemo(
    () =>
      all.filter((v) => {
        if (typeFilter !== 'ALL' && v.type !== typeFilter) return false;
        if (statusFilter === 'ACTIVE' && v.status === 'CANCELLED') return false;
        if (statusFilter !== 'ACTIVE' && statusFilter !== 'ALL' && v.status !== statusFilter) return false;
        if (month && (v.date || '').slice(0, 7) !== month) return false;
        if (q && !matchSearch(`${v.no} ${v.person} ${v.reason} ${v.position} ${v.address}`, q)) return false;
        return true;
      }),
    [all, typeFilter, statusFilter, month, q],
  );

  // Bỏ các lựa chọn không còn hợp lệ khi dữ liệu thay đổi
  useEffect(() => {
    setSel((s) => new Set([...s].filter((id) => pending.some((v) => v.id === id))));
    setPostSel((s) => new Set([...s].filter((id) => approved.some((v) => v.id === id))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.vouchers]);

  const toggleIn = (setter) => (id, on) =>
    setter((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  const selectedForPost = approved.filter((v) => postSel.has(v.id));
  const totals = previewTotals(selectedForPost);

  const approveSelected = async () => {
    setBusy('approve');
    try {
      const nums = await approveVouchers({ actor, ids: [...sel], list: data.vouchers || [] });
      toast.success(`Đã duyệt ${Object.keys(nums).length} chứng từ`);
      setSel(new Set());
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy('');
    }
  };

  const doPost = async () => {
    setBusy('post');
    const before = cashBalance(data.cash);
    try {
      const res = await postVouchers({ actor, ids: selectedForPost.map((v) => v.id), postDate, payBank: totals.bankTotal || totals.bankInTotal ? payBank : null, canReadBanks: treasury });
      toast.success(`Đã chốt sổ đợt ${res.batch.code}: ${res.batch.voucherIds.length} chứng từ gốc${res.batch.generatedIds.length ? ` + ${res.batch.generatedIds.length} phiếu tự động` : ''} đã ghi sổ quỹ và khóa`);
      setConfirmPost(false);
      setPostSel(new Set());
      setPrint({ docs: res.docs, batch: res.batch, title: `Chốt sổ — đợt ${res.batch.code}`, fileBase: `Chot-so_${res.batch.code}`, poster: actor.name, cash: { before }, paper });
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy('');
    }
  };

  const batchDocs = (b) => docsOfBatch(b, all);
  const reprint = (b) => {
    const docs = batchDocs(b);
    if (!docs.length) return toast.info('Tất cả chứng từ của đợt này đã được hủy chốt sổ.');
    setPrint({ docs, batch: batchFromDocs(b, docs), title: `In lại đợt ${b.code}`, fileBase: `Chot-so_${b.code}`, poster: b.posterName || '', cash: null, paper: 'A4' });
  };
  const excel = async (b) => {
    const docs = batchDocs(b);
    if (!docs.length) return toast.info('Tất cả chứng từ của đợt này đã được hủy chốt sổ.');
    try {
      await downloadBatchXlsx({ batch: batchFromDocs(b, docs), docs, company, poster: b.posterName || '' });
    } catch (ex) {
      toast.error(friendlyError(ex));
    }
  };

  const settleAdvance = (a) =>
    setEditor({
      type: 'TT',
      prefill: {
        person: a.person,
        position: a.position || '',
        reason: `Thanh toán tạm ứng ${a.no}: ${a.reason}`.slice(0, 300),
        advanceMode: 'link',
        advanceId: a.id,
        advanceNo: a.no,
        advanceAmount: advanceRemaining(a),
      },
    });

  const tabs = manager
    ? [
        { value: 'all', label: 'Tất cả đề xuất', icon: FileStack },
        { value: 'pending', label: 'Chờ Sếp duyệt', icon: Inbox, count: pending.length },
        { value: 'post', label: 'Chuyển kế toán chi & Chốt sổ', icon: Stamp, count: approved.length },
        { value: 'batches', label: 'Các lần chốt sổ', icon: Layers, count: batches.length || null },
        { value: 'advances', label: 'Tạm ứng nhân viên', icon: UserRoundCheck, count: advances.length || null },
      ]
    : [
        { value: 'all', label: 'Tất cả chứng từ', icon: FileStack },
        ...(poster ? [{ value: 'post', label: 'Chốt sổ & in phiếu', icon: Stamp, count: approved.length }] : []),
        ...(poster ? [{ value: 'batches', label: 'Sổ đã chốt — lưu chứng từ', icon: Layers, count: batches.length || null }] : []),
        { value: 'advances', label: 'Tạm ứng', icon: UserRoundCheck, count: advances.length || null },
      ];
  const activeTab = tabs.some((t) => t.value === tab) ? tab : 'all';

  return (
    <div>
      <PageHeader
        icon={ReceiptText}
        tone="amber"
        title={manager ? 'Đề xuất & Duyệt chi' : 'Đề xuất chi & Chứng từ'}
        subtitle={manager ? 'Nhân viên đề xuất → Sếp duyệt → Kế toán chi tiền & chốt sổ' : 'Lập đề xuất · chi khoản Sếp đã duyệt · chốt sổ & in chứng từ Thông tư 200'}
      />

      {data.voucherError && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Chưa tải được chứng từ: {data.voucherError} Nếu vừa cập nhật phiên bản, Chủ doanh nghiệp cần đăng luật bảo mật mới (Firestore Rules).
        </div>
      )}

      <VoucherSummary stats={stats} cash={cashNow} deposits={depositsNow} treasury={treasury} holdersLine={holdersLine} manager={manager} ready={!!data.vouchersReady} onGo={goTab} />

      {/* Bốn cuốn chứng từ để lập nhanh */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {PADS.map((p) => {
          const Icon = TYPE_ICON[p.type];
          return (
            <button
              key={p.type}
              type="button"
              onClick={() => setEditor({ type: p.type })}
              className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-left shadow-[0_1px_2px_rgba(15,30,58,0.05)] hover:border-slate-300 hover:shadow-md transition-shadow"
            >
              <span className={cx('absolute inset-y-0 left-0 w-1.5', TYPE_STYLE[p.type].bar)} />
              <span className="flex items-start justify-between gap-2">
                <span className={cx('grid h-9 w-9 place-items-center rounded-xl', TYPE_STYLE[p.type].icon)}>
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="font-mono text-[10px] text-slate-400">{VTYPE[p.type].form.replace('Mẫu số ', '')}</span>
              </span>
              <span className="mt-2 block font-display text-[15px] font-bold text-ink-900">+ {p.title}</span>
              <span className="block text-xs text-slate-500 leading-snug">{p.note}</span>
            </button>
          );
        })}
      </div>

      <Card>
        <div id="voucher-tabs" className="px-2 sm:px-3 pt-1 scroll-mt-24">
          <Tabs value={activeTab} onChange={setTab} tabs={tabs.map((t) => ({ ...t, activeClass: 'border-amber-600 text-ink-900', iconClass: activeTab === t.value ? 'text-amber-600' : '' }))} />
        </div>

        {/* ======================= TẤT CẢ ======================= */}
        {activeTab === 'all' && (
          <>
            <div className="flex flex-col lg:flex-row lg:items-center gap-2 px-4 sm:px-5 py-3 border-b border-slate-100">
              <div className="overflow-x-auto thin-scroll -mx-1 px-1">
                <Segmented
                  value={typeFilter}
                  onChange={setTypeFilter}
                  options={[
                    { value: 'ALL', label: 'Tất cả' },
                    { value: 'TU', label: 'Tạm ứng' },
                    { value: 'TT', label: 'Thanh toán' },
                    { value: 'PT', label: 'Phiếu thu' },
                    { value: 'PC', label: 'Phiếu chi' },
                  ]}
                />
              </div>
              <div className="flex flex-wrap gap-2 lg:ml-auto">
                <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!w-auto" aria-label="Lọc trạng thái">
                  <option value="ACTIVE">Mọi trạng thái (trừ đã hủy)</option>
                  {Object.entries(VSTATUS).map(([k, s]) => (
                    <option key={k} value={k}>
                      {s.label}
                    </option>
                  ))}
                  <option value="ALL">Tất cả, kể cả đã hủy</option>
                </Select>
                <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="!w-40" aria-label="Lọc theo tháng" />
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Số phiếu, người, nội dung…" className="!w-56 pl-9" />
                </div>
              </div>
            </div>
            {!data.vouchersReady ? (
              <EmptyState title="Đang tải chứng từ…" />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={ReceiptText}
                title={all.length ? 'Không có chứng từ khớp bộ lọc' : 'Chưa có chứng từ nào'}
                description={all.length ? 'Đổi loại, trạng thái hoặc tháng để xem thêm.' : 'Bấm một trong bốn cuốn chứng từ phía trên để lập giấy đề nghị hoặc phiếu thu / chi.'}
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {filtered.map((v) => (
                  <VoucherRow key={v.id} v={v} onOpen={setOpenId} />
                ))}
              </ul>
            )}
          </>
        )}

        {/* ======================= CHỜ DUYỆT ======================= */}
        {activeTab === 'pending' && manager && (
          <>
            <div className="flex flex-wrap items-center gap-2 px-4 sm:px-5 py-3 border-b border-slate-100">
              <Checkbox
                checked={pending.length > 0 && sel.size === pending.length}
                onChange={(on) => setSel(on ? new Set(pending.map((v) => v.id)) : new Set())}
                label={`Chọn tất cả (${pending.length})`}
              />
              <Button className="ml-auto" variant="primary" icon={CircleCheck} disabled={!sel.size} loading={busy === 'approve'} onClick={approveSelected}>
                Duyệt {sel.size || ''} chứng từ đã chọn
              </Button>
              <p className="w-full text-[11px] text-slate-500">Duyệt hàng loạt là duyệt toàn bộ số đề nghị. Muốn duyệt một phần, bấm vào từng chứng từ rồi chọn “Duyệt” → “Duyệt một phần”.</p>
            </div>
            {pending.length === 0 ? (
              <EmptyState icon={ClipboardCheck} title="Không có chứng từ chờ duyệt" description="Chứng từ nhân viên gửi duyệt sẽ hiện ở đây." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {pending.map((v) => (
                  <VoucherRow key={v.id} v={v} selectable selected={sel.has(v.id)} onSelect={(on) => toggleIn(setSel)(v.id, on)} onOpen={setOpenId} />
                ))}
              </ul>
            )}
          </>
        )}

        {/* ======================= KẾT XUẤT & KẾT CHUYỂN ======================= */}
        {activeTab === 'post' && poster && (
          <div className="grid grid-cols-1 xl:grid-cols-12">
            <div className="xl:col-span-8 border-b xl:border-b-0 xl:border-r border-slate-100">
              <div className="flex flex-wrap items-center gap-2 px-4 sm:px-5 py-3 border-b border-slate-100">
                <Checkbox
                  checked={approved.length > 0 && postSel.size === approved.length}
                  onChange={(on) => setPostSel(on ? new Set(approved.map((v) => v.id)) : new Set())}
                  label={`Chọn tất cả chứng từ đã duyệt (${approved.length})`}
                />
              </div>
              {approved.length === 0 ? (
                <EmptyState icon={Stamp} title="Không có khoản chờ chốt sổ" description="Khoản Sếp đã duyệt nằm ở đây; kế toán chi tiền, bấm “Đã chi”, rồi chốt sổ và in phiếu." />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {approved.map((v) => (
                    <VoucherRow key={v.id} v={v} selectable selected={postSel.has(v.id)} onSelect={(on) => toggleIn(setPostSel)(v.id, on)} onOpen={setOpenId} />
                  ))}
                </ul>
              )}
            </div>
            <aside className="xl:col-span-4 p-4 sm:p-5 space-y-4 xl:sticky xl:top-20 self-start">
              <div>
                <p className="font-display text-base font-bold text-ink-900">Chốt sổ đợt mới</p>
                <p className="text-xs text-slate-500">Một thao tác: cấp số phiếu · ghi sổ quỹ tiền mặt{acct ? ' (111)' : ''} / tiền gửi{acct ? ' (112)' : ''} · khóa chứng từ · in phiếu</p>
              </div>
              <dl className="rounded-xl border border-slate-200 divide-y divide-slate-100 text-sm">
                <div className="flex justify-between px-3 py-2">
                  <dt className="text-slate-600">Chứng từ đã chọn</dt>
                  <dd className="font-semibold">{selectedForPost.length}</dd>
                </div>
                <div className="flex justify-between px-3 py-2">
                  <dt className="text-slate-600 flex items-center gap-1.5">
                    <ArrowDownLeft className="h-4 w-4 text-jade-600" /> Thu tiền mặt ({totals.receiptsCount})
                  </dt>
                  <dd>
                    <Money value={totals.receiptsTotal} className="font-semibold text-jade-700" />
                  </dd>
                </div>
                <div className="flex justify-between px-3 py-2">
                  <dt className="text-slate-600 flex items-center gap-1.5">
                    <ArrowUpRight className="h-4 w-4 text-vermilion-600" /> Chi tiền mặt ({totals.paymentsCount})
                  </dt>
                  <dd>
                    <Money value={totals.paymentsTotal} className="font-semibold text-vermilion-700" />
                  </dd>
                </div>
                {(totals.bankInTotal > 0 || totals.bankTotal > 0) && (
                  <>
                    <div className="flex justify-between px-3 py-2">
                      <dt className="text-slate-600 flex items-center gap-1.5">
                        <ArrowDownLeft className="h-4 w-4 text-sapphire-600" /> Nhận chuyển khoản ({totals.bankInCount})
                      </dt>
                      <dd>
                        <Money value={totals.bankInTotal} className="font-semibold text-sapphire-700" />
                      </dd>
                    </div>
                    <div className="flex justify-between px-3 py-2">
                      <dt className="text-slate-600 flex items-center gap-1.5">
                        <ArrowUpRight className="h-4 w-4 text-sapphire-600" /> Chi chuyển khoản ({totals.bankCount})
                      </dt>
                      <dd>
                        <Money value={totals.bankTotal} className="font-semibold text-sapphire-700" />
                      </dd>
                    </div>
                  </>
                )}
                <div className="flex justify-between px-3 py-2 bg-slate-50">
                  <dt className="font-semibold text-ink-900">Dòng tiền thuần (thu − chi)</dt>
                  <dd>
                    <Money value={totals.net + totals.bankNet} sign className={cx('font-bold', totals.net + totals.bankNet < 0 ? 'text-rose-700' : 'text-jade-700')} />
                  </dd>
                </div>
              </dl>
              {(totals.bankInTotal > 0 || totals.bankTotal > 0) && (
                <Field label="Tài khoản ngân hàng của công ty (chi / nhận chuyển khoản)">
                  <Select value={payBank?.id || ''} onChange={(e) => setPayBankId(e.target.value)}>
                    {bankChoices.length === 0 && <option value="">Chưa có tài khoản — Sếp thêm ở Vay & Hạn mức NH</option>}
                    {bankChoices.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                        {b.accountNo ? ` · ${b.accountNo}` : ' · chưa có số TK'}
                        {treasury ? ` · dư ${fmtVND(b.depositBalance || 0)}` : ''}
                      </option>
                    ))}
                  </Select>
                  {!treasury && totals.bankTotal > totals.bankInTotal && (
                    <span className="mt-1 block text-xs text-slate-500">Nếu số dư tiền gửi trên app không đủ, hệ thống sẽ từ chối chốt sổ — báo Sếp cập nhật số dư theo sao kê ngân hàng.</span>
                  )}
                </Field>
              )}
              {manager && can(role, 'viewTreasury') && (
                <p className="text-xs text-slate-500">
                  Tồn quỹ tiền mặt <Money value={cashBalance(data.cash)} className="font-semibold text-slate-700" /> → sau chốt sổ{' '}
                  <Money value={cashBalance(data.cash) + totals.net} className={cx('font-semibold', cashBalance(data.cash) + totals.net < 0 ? 'text-rose-700' : 'text-slate-700')} />
                  {payBank && (totals.bankInTotal > 0 || totals.bankTotal > 0) && (
                    <>
                      <br />
                      Tiền gửi {payBank.name} <Money value={payBank.depositBalance || 0} className="font-semibold text-slate-700" /> → sau chốt sổ{' '}
                      <Money value={(Number(payBank.depositBalance) || 0) + totals.bankNet} className={cx('font-semibold', (Number(payBank.depositBalance) || 0) + totals.bankNet < 0 ? 'text-rose-700' : 'text-slate-700')} />
                    </>
                  )}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Ngày chốt sổ">
                  <Input type="date" value={postDate} max={todayISO()} onChange={(e) => setPostDate(e.target.value || todayISO())} />
                </Field>
                <Field label="Khổ in">
                  <Segmented
                    value={paper}
                    onChange={setPaper}
                    className="w-full"
                    options={[
                      { value: 'A4', label: 'A4' },
                      { value: 'A5', label: '2 × A5' },
                    ]}
                  />
                </Field>
              </div>
              <Button variant="amber" size="lg" icon={Printer} className="w-full" disabled={!selectedForPost.length} onClick={() => setConfirmPost(true)}>
                Chốt sổ & in phiếu
              </Button>
              <p className="text-[11px] leading-relaxed text-slate-500">
                Sau khi chốt sổ, chứng từ bị khóa và bút toán đi vào Sổ quỹ tiền mặt kèm số phiếu. Muốn sửa phải dùng “Hủy chốt sổ” (chỉ Chủ doanh nghiệp), hệ thống ghi bút toán đảo chứ không xóa.
              </p>
            </aside>
          </div>
        )}

        {/* ======================= ĐỢT KẾT CHUYỂN ======================= */}
        {activeTab === 'batches' && poster && (
          batches.length === 0 ? (
            <EmptyState icon={Layers} title="Chưa có lần chốt sổ nào" description="Mỗi lần “Chốt sổ & in phiếu” tạo một đợt KC-YYYYMMDD-NN để in lại và lưu hồ sơ." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {batches.map((b) => (
                <li key={b.id} className="flex flex-col md:flex-row md:items-center gap-3 px-4 sm:px-5 py-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800">
                      <Layers className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-ink-900">{b.code}</span>
                        {b.status === 'REVERSED' ? <Badge tone="red">Đã hủy toàn bộ</Badge> : b.status === 'PARTIAL' ? <Badge tone="amber">Hủy {b.reversedCount} chứng từ</Badge> : <Badge tone="green">Đã chốt sổ</Badge>}
                      </p>
                      <p className="text-xs text-slate-500">
                        {fmtDate(b.postDate)} · <Who id={b.createdBy} /> · {(b.voucherIds || []).length} chứng từ gốc, {(b.generatedIds || []).length} phiếu tự động
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm md:justify-end">
                    <span>
                      Thu <Money value={b.receiptsTotal} className="font-semibold text-jade-700" />
                    </span>
                    <span>
                      Chi <Money value={b.paymentsTotal} className="font-semibold text-vermilion-700" />
                    </span>
                    <span className="flex gap-1.5">
                      <Button size="sm" icon={Printer} onClick={() => reprint(b)}>
                        In lại
                      </Button>
                      <Button size="sm" icon={FileSpreadsheet} onClick={() => excel(b)}>
                        Excel
                      </Button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )
        )}

        {/* ======================= TẠM ỨNG ======================= */}
        {activeTab === 'advances' && (
          advances.length === 0 ? (
            <EmptyState icon={UserRoundCheck} title="Không có khoản tạm ứng nào còn phải quyết toán" description="Giấy đề nghị tạm ứng sau khi chốt sổ (đã chi tiền) sẽ hiện ở đây cho tới khi được thanh toán hết." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {advances.map((a) => {
                const left = advanceRemaining(a);
                const late = a.dueDate && a.dueDate < todayISO();
                const days = a.dueDate ? daysBetween(todayISO(), a.dueDate) : null;
                return (
                  <li key={a.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 sm:px-5 py-3">
                    <button type="button" onClick={() => setOpenId(a.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800">
                        <FileClock className="h-5 w-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-ink-900">{a.person}</span>
                          <span className="font-mono text-[11px] text-slate-500">{a.no}</span>
                          {a.dueDate && (
                            <Badge tone={late ? 'red' : days <= 3 ? 'amber' : 'slate'} icon={CalendarClock}>
                              {late ? `Quá hạn ${-days} ngày` : `Hạn ${fmtDate(a.dueDate)}`}
                            </Badge>
                          )}
                        </span>
                        <span className="block text-xs text-slate-500 truncate">
                          {fmtDate(a.date)} · {a.reason}
                        </span>
                      </span>
                    </button>
                    <div className="flex items-center gap-4 sm:justify-end">
                      <span className="text-right text-xs text-slate-500">
                        Ứng <Money value={a.amount} className="font-medium text-slate-700" />
                        <br />
                        Còn <Money value={left} className="font-semibold text-amber-700" />
                      </span>
                      <Button size="sm" variant="amber" icon={FileText} onClick={() => settleAdvance(a)}>
                        Lập GĐNTT hoàn ứng
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        )}
      </Card>

      {!manager && (
        <p className="mt-3 text-xs text-slate-500">
          Bạn thấy chứng từ do chính bạn lập ({me?.email}) và mọi khoản Sếp đã duyệt / đã chốt sổ. Duyệt chi do Chủ doanh nghiệp / Đồng quản trị thực hiện; chi tiền, chốt sổ và in phiếu do kế toán thực hiện.
        </p>
      )}

      {/* ---------- hộp xác nhận chốt sổ ---------- */}
      <Modal
        open={confirmPost}
        onClose={() => busy !== 'post' && setConfirmPost(false)}
        title="Chốt sổ & in phiếu"
        subtitle={`${selectedForPost.length} chứng từ · ngày chốt sổ ${fmtDate(postDate)}`}
        size="md"
        footer={
          <>
            <Button onClick={() => setConfirmPost(false)} disabled={busy === 'post'}>
              Quay lại
            </Button>
            <Button variant="amber" icon={Stamp} loading={busy === 'post'} onClick={doPost}>
              Chốt sổ & mở bản in
            </Button>
          </>
        }
      >
        <ol className="space-y-2 text-sm text-slate-700 list-decimal pl-5">
          <li>Tạo đợt chốt sổ mới, cấp số phiếu thu / phiếu chi cho phần hoàn ứng, chi bổ sung, chi tạm ứng.</li>
          <li>
            Ghi Sổ quỹ tiền mặt{acct ? ' (TK 111)' : ''}: thu <b className="text-jade-700">{fmtVND(totals.receiptsTotal)}</b>, chi <b className="text-vermilion-700">{fmtVND(totals.paymentsTotal)}</b>.
          </li>
          {(totals.bankInTotal > 0 || totals.bankTotal > 0) && (
            <li>
              Tiền gửi ngân hàng{acct ? ' (TK 112)' : ''} — <b>{payBank ? `${payBank.name}${payBank.accountNo ? ` · ${payBank.accountNo}` : ''}` : 'chưa chọn tài khoản'}</b>: nhận{' '}
              <b className="text-sapphire-700">{fmtVND(totals.bankInTotal)}</b>, chi <b className="text-sapphire-700">{fmtVND(totals.bankTotal)}</b>; số dư tiền gửi trên app được cập nhật theo. Bản in có <b>bảng kê lệnh chuyển khoản</b> (đủ số tài khoản người nhận) để kế toán đi lệnh.
            </li>
          )}
          <li>Khóa các chứng từ (trạng thái “Đã chốt sổ”), cập nhật “Chi nội bộ” trong Điều phối tháng.</li>
          <li>Mở bản in ({paper === 'A4' ? 'A4' : '2 liên A5'}) kèm bảng kê đợt; tải được PDF và Excel.</li>
        </ol>
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          An toàn khi bấm nhiều lần hoặc hai người cùng bấm: chứng từ nào đã được chốt sổ sẽ bị từ chối, không ghi trùng sổ quỹ.
        </p>
      </Modal>

      {editor && (
        <VoucherEditor
          key={editor.existing?.id || editor.type}
          type={editor.type}
          existing={editor.existing || null}
          prefill={editor.prefill || null}
          onClose={() => setEditor(null)}
          onSaved={(id) => setOpenId(id)}
        />
      )}
      {openId && !editor && (
        <VoucherDrawer
          id={openId}
          onClose={() => setOpenId(null)}
          onOpen={setOpenId}
          onEdit={(v) => setEditor({ existing: v })}
          onPrint={(docs, name) => setPrint({ docs, batch: null, title: `Bản in ${name}`, fileBase: `Chung-tu_${name}`, poster: actor.name, cash: null, paper: 'A4' })}
          onPostBank={(v) => {
            setOpenId(null);
            setPostSel(new Set([v.id]));
            setTab('post');
            setConfirmPost(true);
          }}
          onPosted={(res) =>
            setPrint({ docs: res.docs, batch: res.batch, title: `Chốt sổ — đợt ${res.batch.code}`, fileBase: `Chot-so_${res.batch.code}`, poster: actor.name, cash: res.cash, paper: 'A4' })
          }
        />
      )}
      <PrintPreview
        open={!!print}
        onClose={() => setPrint(null)}
        title={print?.title}
        fileBase={print?.fileBase}
        batch={print?.batch || null}
        docs={print?.docs || []}
        poster={print?.poster || ''}
        cash={print?.cash || null}
        defaultPaper={print?.paper || 'A4'}
      />
    </div>
  );
}

