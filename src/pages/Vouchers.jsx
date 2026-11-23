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
import { daysBetween, fmtDate, todayISO } from '../lib/dates.js';
import { fmtVND, matchSearch } from '../lib/format.js';
import { cashBalance } from '../lib/calc.js';
import { useCompany } from '../lib/brand.js';
import { VSTATUS, VTYPE, advanceRemaining, cashEffect, ledgerLines, openAdvances, voucherAmount } from '../lib/vouchers.js';
import { approveVouchers, postVouchers } from '../lib/voucherService.js';
import { downloadBatchXlsx } from '../lib/voucherExcel.js';
import { useToast } from '../components/feedback.jsx';
import { Money } from '../components/Money.jsx';
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, PageHeader, Segmented, Select, Tabs, cx } from '../components/ui.jsx';
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

/** Tổng hợp nhanh một tập chứng từ khi kết chuyển */
function previewTotals(list) {
  let rc = 0;
  let rt = 0;
  let pc = 0;
  let pt = 0;
  for (const v of list) {
    const e = cashEffect(v);
    if (e.in > 0) {
      rc += 1;
      rt += e.in;
    }
    if (e.out > 0) {
      pc += 1;
      pt += e.out;
    }
  }
  return { receiptsCount: rc, receiptsTotal: rt, paymentsCount: pc, paymentsTotal: pt, net: rt - pt };
}

/** Tổng hợp lại từ chứng từ hiện còn hiệu lực của một đợt (dùng khi in lại) */
function batchFromDocs(batch, docs) {
  const lines = ledgerLines(docs).filter((l) => !l.info);
  const receipts = docs.filter((d) => d.type === 'PT');
  const payments = docs.filter((d) => d.type === 'PC');
  const rt = lines.filter((l) => l.debit === '1111').reduce((s, l) => s + l.amount, 0);
  const pt = lines.filter((l) => l.credit === '1111').reduce((s, l) => s + l.amount, 0);
  return { ...batch, receiptsCount: receipts.length, receiptsTotal: rt, paymentsCount: payments.length, paymentsTotal: pt, net: rt - pt };
}

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
          </span>
          <span className="mt-0.5 block text-xs text-slate-500 truncate">
            {fmtDate(v.date)} · {v.reason}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <Money value={amt} className={cx('block text-sm font-semibold', sign === 'in' ? 'text-jade-700' : 'text-ink-900')} />
          <span className="mt-1 inline-block">
            <VStatusBadge status={v.status} />
          </span>
        </span>
      </button>
    </li>
  );
}

export default function Vouchers({ params }) {
  const { actor, role, me } = useAuth();
  const data = useData();
  const toast = useToast();
  const company = useCompany();
  const manager = can(role, 'approveVouchers');
  const poster = can(role, 'postVouchers');

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
      const nums = await approveVouchers({ actor, ids: [...sel] });
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
      const res = await postVouchers({ actor, ids: selectedForPost.map((v) => v.id), postDate });
      toast.success(`Đã kết chuyển đợt ${res.batch.code}: ${res.batch.voucherIds.length} chứng từ gốc${res.batch.generatedIds.length ? ` + ${res.batch.generatedIds.length} phiếu tự động` : ''} đã ghi sổ quỹ và khóa`);
      setConfirmPost(false);
      setPostSel(new Set());
      setPrint({ docs: res.docs, batch: res.batch, title: `Kết xuất in phiếu — đợt ${res.batch.code}`, fileBase: `Ket-chuyen_${res.batch.code}`, poster: actor.name, cash: { before }, paper });
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy('');
    }
  };

  const batchDocs = (b) => {
    const byId = new Map(all.map((v) => [v.id, v]));
    const out = [];
    for (const id of b.voucherIds || []) {
      const v = byId.get(id);
      if (!v || v.status !== 'POSTED' || v.postingBatchId !== b.id) continue;
      out.push(v);
      for (const g of v.generatedIds || []) {
        const gv = byId.get(g);
        if (gv && gv.status === 'POSTED') out.push(gv);
      }
    }
    return out;
  };
  const reprint = (b) => {
    const docs = batchDocs(b);
    if (!docs.length) return toast.info('Tất cả chứng từ của đợt này đã được hủy kết chuyển.');
    setPrint({ docs, batch: batchFromDocs(b, docs), title: `In lại đợt ${b.code}`, fileBase: `Ket-chuyen_${b.code}`, poster: b.posterName || '', cash: null, paper: 'A4' });
  };
  const excel = async (b) => {
    const docs = batchDocs(b);
    if (!docs.length) return toast.info('Tất cả chứng từ của đợt này đã được hủy kết chuyển.');
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
        { value: 'all', label: 'Tất cả chứng từ', icon: FileStack },
        { value: 'pending', label: 'Chờ duyệt', icon: Inbox, count: pending.length },
        { value: 'post', label: 'Kết xuất & kết chuyển', icon: Stamp, count: approved.length },
        { value: 'batches', label: 'Đợt kết chuyển', icon: Layers, count: batches.length || null },
        { value: 'advances', label: 'Tạm ứng nhân viên', icon: UserRoundCheck, count: advances.length || null },
      ]
    : [
        { value: 'all', label: 'Chứng từ của tôi', icon: FileStack },
        { value: 'advances', label: 'Tạm ứng của tôi', icon: UserRoundCheck, count: advances.length || null },
      ];
  const activeTab = tabs.some((t) => t.value === tab) ? tab : 'all';

  return (
    <div>
      <PageHeader
        icon={ReceiptText}
        tone="amber"
        title="Chứng từ thu chi nội bộ"
        subtitle={manager ? 'Lập → Duyệt → Kết xuất in phiếu & kết chuyển sổ quỹ · mẫu Thông tư 200' : 'Lập giấy đề nghị, phiếu thu / chi và theo dõi trạng thái duyệt'}
      />

      {data.voucherError && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Chưa tải được chứng từ: {data.voucherError} Nếu vừa cập nhật phiên bản, Chủ doanh nghiệp cần đăng luật bảo mật mới (Firestore Rules).
        </div>
      )}

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
        <div className="px-2 sm:px-3 pt-1">
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
                <EmptyState icon={Stamp} title="Không có chứng từ chờ kết xuất" description="Chứng từ sau khi được duyệt sẽ nằm ở đây để in phiếu và ghi sổ quỹ." />
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
                <p className="font-display text-base font-bold text-ink-900">Đợt kết chuyển mới</p>
                <p className="text-xs text-slate-500">Một thao tác: cấp số đợt · in phiếu · ghi sổ quỹ · khóa chứng từ</p>
              </div>
              <dl className="rounded-xl border border-slate-200 divide-y divide-slate-100 text-sm">
                <div className="flex justify-between px-3 py-2">
                  <dt className="text-slate-600">Chứng từ đã chọn</dt>
                  <dd className="font-semibold">{selectedForPost.length}</dd>
                </div>
                <div className="flex justify-between px-3 py-2">
                  <dt className="text-slate-600 flex items-center gap-1.5">
                    <ArrowDownLeft className="h-4 w-4 text-jade-600" /> Thu ({totals.receiptsCount} phiếu)
                  </dt>
                  <dd>
                    <Money value={totals.receiptsTotal} className="font-semibold text-jade-700" />
                  </dd>
                </div>
                <div className="flex justify-between px-3 py-2">
                  <dt className="text-slate-600 flex items-center gap-1.5">
                    <ArrowUpRight className="h-4 w-4 text-vermilion-600" /> Chi ({totals.paymentsCount} phiếu)
                  </dt>
                  <dd>
                    <Money value={totals.paymentsTotal} className="font-semibold text-vermilion-700" />
                  </dd>
                </div>
                <div className="flex justify-between px-3 py-2 bg-slate-50">
                  <dt className="font-semibold text-ink-900">Chênh lệch thu − chi</dt>
                  <dd>
                    <Money value={totals.net} sign className={cx('font-bold', totals.net < 0 ? 'text-rose-700' : 'text-jade-700')} />
                  </dd>
                </div>
              </dl>
              {manager && can(role, 'viewTreasury') && (
                <p className="text-xs text-slate-500">
                  Tồn quỹ két hiện tại <Money value={cashBalance(data.cash)} className="font-semibold text-slate-700" /> → sau kết chuyển{' '}
                  <Money value={cashBalance(data.cash) + totals.net} className={cx('font-semibold', cashBalance(data.cash) + totals.net < 0 ? 'text-rose-700' : 'text-slate-700')} />
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Ngày kết chuyển">
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
                Kết xuất in phiếu & kết chuyển
              </Button>
              <p className="text-[11px] leading-relaxed text-slate-500">
                Sau khi kết chuyển, chứng từ bị khóa và bút toán đi vào Sổ quỹ tiền mặt kèm số phiếu. Muốn sửa phải dùng “Hủy kết chuyển” (chỉ Chủ doanh nghiệp), hệ thống ghi bút toán đảo chứ không xóa.
              </p>
            </aside>
          </div>
        )}

        {/* ======================= ĐỢT KẾT CHUYỂN ======================= */}
        {activeTab === 'batches' && manager && (
          batches.length === 0 ? (
            <EmptyState icon={Layers} title="Chưa có đợt kết chuyển nào" description="Mỗi lần “Kết xuất in phiếu & kết chuyển” tạo một đợt KC-YYYYMMDD-NN." />
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
                        {b.status === 'REVERSED' ? <Badge tone="red">Đã hủy toàn bộ</Badge> : b.status === 'PARTIAL' ? <Badge tone="amber">Hủy {b.reversedCount} chứng từ</Badge> : <Badge tone="green">Đã kết chuyển</Badge>}
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
            <EmptyState icon={UserRoundCheck} title="Không có khoản tạm ứng nào còn phải quyết toán" description="Giấy đề nghị tạm ứng sau khi kết chuyển (đã chi tiền) sẽ hiện ở đây cho tới khi được thanh toán hết." />
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
          Bạn đang xem chứng từ do chính bạn lập ({me?.email}). Duyệt, kết chuyển và in phiếu chính thức do Chủ doanh nghiệp / Đồng quản trị thực hiện.
        </p>
      )}

      {/* ---------- hộp xác nhận kết chuyển ---------- */}
      <Modal
        open={confirmPost}
        onClose={() => busy !== 'post' && setConfirmPost(false)}
        title="Kết xuất in phiếu & kết chuyển"
        subtitle={`${selectedForPost.length} chứng từ · ngày kết chuyển ${fmtDate(postDate)}`}
        size="md"
        footer={
          <>
            <Button onClick={() => setConfirmPost(false)} disabled={busy === 'post'}>
              Quay lại
            </Button>
            <Button variant="amber" icon={Stamp} loading={busy === 'post'} onClick={doPost}>
              Kết chuyển & mở bản in
            </Button>
          </>
        }
      >
        <ol className="space-y-2 text-sm text-slate-700 list-decimal pl-5">
          <li>Tạo đợt kết chuyển mới, cấp số phiếu thu / phiếu chi cho phần hoàn ứng, chi bổ sung, chi tạm ứng.</li>
          <li>
            Ghi Sổ quỹ tiền mặt: thu <b className="text-jade-700">{fmtVND(totals.receiptsTotal)}</b>, chi <b className="text-vermilion-700">{fmtVND(totals.paymentsTotal)}</b>.
          </li>
          <li>Khóa các chứng từ (trạng thái “Đã kết chuyển”), cập nhật “Chi nội bộ” trong Điều phối tháng.</li>
          <li>Mở bản in ({paper === 'A4' ? 'A4' : '2 liên A5'}) kèm bảng kê đợt; tải được PDF và Excel.</li>
        </ol>
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          An toàn khi bấm nhiều lần hoặc hai người cùng bấm: chứng từ nào đã được kết chuyển sẽ bị từ chối, không ghi trùng sổ quỹ.
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
          onPosted={(res) =>
            setPrint({ docs: res.docs, batch: res.batch, title: `Kết xuất in phiếu — đợt ${res.batch.code}`, fileBase: `Ket-chuyen_${res.batch.code}`, poster: actor.name, cash: res.cash, paper: 'A4' })
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

