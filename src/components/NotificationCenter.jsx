/**
 * CHUÔNG THÔNG BÁO + NGĂN DUYỆT NHANH
 *  - Chủ DN / Đồng quản trị: số đỏ = số khoản chờ duyệt (đề xuất chi nội bộ + công nợ phải trả đến hạn chưa duyệt).
 *    Bấm chuông → ngăn duyệt nhanh ngay trên màn hình đang xem: [Duyệt] [Sửa số duyệt] [Từ chối].
 *  - Kế toán: chuông báo khoản Sếp vừa duyệt (đi chi ngay) và khoản bị từ chối (kèm lý do).
 * Kèm thông báo của trình duyệt + số trên biểu tượng app (src/lib/notify.js).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, BellRing, CircleCheck, CircleSlash, FileImage, PenLine, Stamp, Wallet, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { friendlyError } from '../lib/db.js';
import { cashBalance } from '../lib/calc.js';
import { fmtDate, todayISO } from '../lib/dates.js';
import { fmtVND } from '../lib/format.js';
import { can, homeRoute } from '../lib/roles.js';
import { VTYPE } from '../lib/vouchers.js';
import { openPayOrders } from '../lib/approvals.js';
import { committedOut, pendingApprovals, toPayItems, withRunning } from '../lib/pending.js';
import { approveVouchers, loadAttachments, rejectVoucher } from '../lib/voucherService.js';
import { localPermission, localSupported, requestLocalPermission, setBadge, showLocal } from '../lib/notify.js';
import { holdPayable, saveApproval, useApprovalFlow } from './forms/approvalForms.jsx';
import { ApproveVoucherModal } from './vouchers/ApproveVoucherModal.jsx';
import { Money } from './Money.jsx';
import { useToast } from './feedback.jsx';
import { Badge, Button, Drawer, EmptyState, Field, Modal, Textarea, cx } from './ui.jsx';

/* ------------------------------------------------------------------ */
/*  Số liệu dùng chung                                                  */
/* ------------------------------------------------------------------ */

/** Tổng tiền đang có (tiền mặt + tiền gửi) và phần đã cam kết chi (đã duyệt, chưa chi xong) */
export function useMoneyNow() {
  const data = useData();
  return useMemo(() => {
    const cash = cashBalance(data.cash || []);
    const deposits = (data.banks || []).reduce((t, b) => t + (Number(b.depositBalance) || 0), 0);
    const committed = committedOut({ vouchers: data.vouchers || [], approvals: data.approvals || [], ap: data.ap || [] });
    const total = cash + deposits;
    return { cash, deposits, total, committed, free: total + committed.net };
  }, [data.cash, data.banks, data.vouchers, data.approvals, data.ap]);
}

export function usePendingApprovals() {
  const data = useData();
  const today = todayISO();
  return useMemo(() => pendingApprovals({ vouchers: data.vouchers || [], ap: data.ap || [], approvals: data.approvals || [], today }), [data.vouchers, data.ap, data.approvals, today]);
}

export function useToPay() {
  const data = useData();
  return useMemo(() => {
    const orders = openPayOrders(data.approvals || [], data.ap || [], data.suppliers || []);
    return toPayItems({ vouchers: data.vouchers || [], orders });
  }, [data.vouchers, data.approvals, data.ap, data.suppliers]);
}

/* ------------------------------------------------------------------ */
/*  Ảnh chứng từ: tải khi cần, bấm để phóng to                          */
/* ------------------------------------------------------------------ */
const fileCache = new Map();

function Thumbs({ attachments }) {
  const [files, setFiles] = useState(() => attachments.map((a) => fileCache.get(a.id)).filter(Boolean));
  const [zoom, setZoom] = useState(null);
  useEffect(() => {
    const need = attachments.filter((a) => !fileCache.has(a.id) && String(a.type || '').startsWith('image/'));
    if (!need.length) return undefined;
    let alive = true;
    loadAttachments(need).then((list) => {
      list.forEach((f) => fileCache.set(f.id, f));
      if (alive) setFiles(attachments.map((a) => fileCache.get(a.id)).filter(Boolean));
    });
    return () => {
      alive = false;
    };
  }, [attachments]);
  if (!attachments.length) return null;
  const imgs = files.filter((f) => String(f.type || '').startsWith('image/'));
  return (
    <>
      <div className="mt-2 flex gap-2 overflow-x-auto thin-scroll">
        {imgs.length === 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            <FileImage className="h-3.5 w-3.5" /> {attachments.length} ảnh chứng từ…
          </span>
        )}
        {imgs.map((f) => (
          <button key={f.id} type="button" onClick={() => setZoom(f)} className="h-16 w-16 shrink-0 overflow-hidden rounded-lg ring-1 ring-slate-200 hover:ring-sapphire-400" title={f.name}>
            <img src={f.dataUrl} alt={f.name} className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
      {zoom &&
        createPortal(
          <div data-modal-open="" className="fixed inset-0 z-[70] flex flex-col bg-ink-950/90" onClick={() => setZoom(null)}>
            <div className="flex items-center justify-between px-4 py-3 text-white">
              <p className="truncate text-sm">{zoom.name}</p>
              <button type="button" className="grid h-10 w-10 place-items-center rounded-xl bg-white/10" aria-label="Đóng ảnh">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center p-3">
              <img src={zoom.dataUrl} alt={zoom.name} className="max-h-full max-w-full object-contain" />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Hộp nhập lý do (từ chối / hoãn)                                    */
/* ------------------------------------------------------------------ */
function ReasonModal({ item, onClose, onSubmit }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (!item) return null;
  const isAp = item.kind === 'AP';
  const submit = async () => {
    if (!isAp && !text.trim()) return;
    setBusy(true);
    try {
      await onSubmit(text.trim());
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      z="z-[65]"
      size="sm"
      title={isAp ? `Hoãn chi: ${item.who}` : `Từ chối: ${item.who}`}
      subtitle={isAp ? 'Khoản nợ vẫn còn; ẩn khỏi danh sách chờ duyệt đến đầu tháng sau' : 'Người lập sẽ thấy lý do để sửa và gửi lại'}
      footer={
        <>
          <Button onClick={onClose}>Quay lại</Button>
          <Button variant={isAp ? 'primary' : 'danger'} icon={CircleSlash} loading={busy} disabled={!isAp && !text.trim()} onClick={submit}>
            {isAp ? 'Hoãn sang tháng sau' : 'Từ chối'}
          </Button>
        </>
      }
    >
      <Field label={isAp ? 'Lý do hoãn (không bắt buộc)' : 'Lý do từ chối'} required={!isAp}>
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder={isAp ? 'VD: Chờ đối chiếu hóa đơn, thương lượng lùi hạn' : 'VD: Thiếu hóa đơn, vượt định mức'} />
      </Field>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Một khoản chờ duyệt                                                  */
/* ------------------------------------------------------------------ */
function ApprovalCard({ it, busy, onApprove, onEdit, onReject, compact = false }) {
  const v = it.v;
  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm sm:p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {it.kind === 'V' ? <Badge tone="amber">{VTYPE[v.type]?.short || 'Đề xuất'}</Badge> : <Badge tone="red">Công nợ NCC{it.priority === 'P1' ? ' · P1' : ''}</Badge>}
            {it.bank && <Badge tone="blue">Chuyển khoản</Badge>}
          </div>
          <p className="mt-1 truncate text-[15px] font-semibold text-ink-900">{it.who}</p>
          <p className="line-clamp-2 text-sm text-slate-600">{it.what}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {it.kind === 'V' ? `Gửi ${fmtDate(it.date)}` : it.dueDate ? (it.overdue ? <span className="font-medium text-rose-600">Quá hạn {it.overdue} ngày</span> : `Hạn ${fmtDate(it.dueDate)}`) : 'Chưa có hạn'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <Money value={it.inn && !it.out ? it.inn : it.amount} className={cx('block font-display text-lg font-bold', it.inn && !it.out ? 'text-jade-700' : 'text-ink-900')} />
          {it.inn > 0 && !it.out && <span className="text-[11px] text-jade-700">tiền vào</span>}
        </div>
      </div>
      {!compact && it.kind === 'V' && <Thumbs attachments={it.attachments || []} />}
      <p className={cx('mt-2 rounded-lg px-2.5 py-1.5 text-xs', it.after < 0 ? 'bg-rose-50 font-semibold text-rose-700' : 'bg-slate-50 text-slate-600')}>
        Duyệt khoản này xong {it.after < 0 ? 'thiếu' : 'còn lại'}: <Money value={Math.abs(it.after)} className="font-semibold" />
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Button variant="primary" icon={CircleCheck} loading={busy === `ok:${it.key}`} disabled={!!busy} onClick={() => onApprove(it)} className="h-11 justify-center">
          Duyệt
        </Button>
        <Button icon={PenLine} disabled={!!busy} onClick={() => onEdit(it)} className="h-11 justify-center">
          <span className="sm:hidden">Sửa số</span>
          <span className="hidden sm:inline">Sửa số duyệt</span>
        </Button>
        <Button variant="dangerGhost" icon={CircleSlash} disabled={!!busy} onClick={() => onReject(it)} className="h-11 justify-center">
          {it.kind === 'AP' ? 'Hoãn' : 'Từ chối'}
        </Button>
      </div>
    </li>
  );
}

/**
 * Danh sách duyệt nhanh (dùng trong ngăn chuông và khối "Khoản chờ duyệt ngay" ở Tổng quan)
 * @param limit  chỉ hiện n khoản đầu (Tổng quan)
 */
export function QuickApprovalList({ limit = 0, compact = false, onMore }) {
  const { actor } = useAuth();
  const data = useData();
  const toast = useToast();
  const items = usePendingApprovals();
  const money = useMoneyNow();
  const [busy, setBusy] = useState('');
  const [editV, setEditV] = useState(null);
  const [reasonFor, setReasonFor] = useState(null);
  const flow = useApprovalFlow({ ap: data.ap || [], approvals: data.approvals || [], suppliers: data.suppliers || [] });
  const running = useMemo(() => withRunning(items, money.free), [items, money.free]);
  const shown = limit ? running.slice(0, limit) : running;

  const approve = async (it) => {
    setBusy(`ok:${it.key}`);
    try {
      if (it.kind === 'V') {
        const nums = await approveVouchers({ actor, ids: [it.id], list: [it.v] });
        toast.success(`Đã duyệt ${it.who} — ${fmtVND(it.amount)} (số ${nums[it.id]}). Kế toán sẽ thấy ngay trong “Cần chi ngay”.`);
      } else {
        await saveApproval({ actor, debt: it.debt, mode: 'FULL', suppliers: data.suppliers || [] });
        toast.success(`Đã duyệt chi ${fmtVND(it.amount)} cho ${it.who}`);
      }
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy('');
    }
  };
  const edit = (it) => (it.kind === 'V' ? setEditV(it.v) : flow.approve(it.debt, null));
  const reject = async (reason) => {
    const it = reasonFor;
    try {
      if (it.kind === 'V') {
        await rejectVoucher({ actor, v: it.v, reason });
        toast.success(`Đã từ chối đề xuất của ${it.who}`);
      } else {
        await holdPayable({ actor, debt: it.debt, reason });
        toast.success(`Đã hoãn khoản chi cho ${it.who} sang tháng sau`);
      }
    } catch (ex) {
      toast.error(friendlyError(ex));
      throw ex;
    }
  };

  if (!items.length) return <EmptyState icon={CircleCheck} title="Không có khoản nào chờ duyệt" description="Đề xuất chi mới và công nợ đến hạn sẽ hiện ở đây." />;
  return (
    <>
      <ul className={cx('grid gap-3', limit && 'lg:grid-cols-2')}>
        {shown.map((it) => (
          <ApprovalCard key={it.key} it={it} busy={busy} compact={compact} onApprove={approve} onEdit={edit} onReject={setReasonFor} />
        ))}
      </ul>
      {limit > 0 && items.length > limit && (
        <button type="button" onClick={onMore} className="mt-3 w-full rounded-xl border border-dashed border-slate-300 py-2.5 text-sm font-semibold text-slate-600 hover:border-sapphire-400 hover:text-sapphire-700">
          Xem tất cả {items.length} khoản chờ duyệt
        </button>
      )}
      {editV && <ApproveVoucherModal voucher={(data.vouchers || []).find((x) => x.id === editV.id) || editV} startMode="PART" onClose={() => setEditV(null)} />}
      <ReasonModal item={reasonFor} onClose={() => setReasonFor(null)} onSubmit={reject} />
      {flow.modals}
    </>
  );
}

/** Dải số liệu đầu ngăn duyệt: tiền đang có, chờ duyệt, còn lại */
export function ApprovalSummary() {
  const items = usePendingApprovals();
  const money = useMoneyNow();
  const waiting = items.reduce((t, it) => t + it.out - it.inn, 0);
  const left = money.free - waiting;
  return (
    <div className="grid grid-cols-3 gap-2 text-white">
      <div className="rounded-xl bg-white/10 px-3 py-2 ring-1 ring-inset ring-white/15">
        <p className="text-[11px] text-white/75">Tổng tiền đang có</p>
        <Money value={money.total} compact className="font-display text-base font-bold" />
      </div>
      <div className="rounded-xl bg-white/10 px-3 py-2 ring-1 ring-inset ring-white/15">
        <p className="text-[11px] text-white/75">Chờ duyệt ({items.length})</p>
        <Money value={waiting} compact className="font-display text-base font-bold" />
      </div>
      <div className={cx('rounded-xl px-3 py-2 ring-1 ring-inset', left < 0 ? 'bg-rose-500/30 ring-rose-200/40' : 'bg-white/10 ring-white/15')}>
        <p className="text-[11px] text-white/75">{left < 0 ? 'Thiếu nếu duyệt hết' : 'Còn lại nếu duyệt hết'}</p>
        <Money value={Math.abs(left)} compact className="font-display text-base font-bold" />
      </div>
    </div>
  );
}

function PermissionRow() {
  const [perm, setPerm] = useState(localPermission());
  if (!localSupported() || perm !== 'default') return null;
  return (
    <div className="mb-3 flex items-center gap-3 rounded-xl bg-sapphire-50 px-3 py-2.5 text-sm text-sapphire-900">
      <BellRing className="h-5 w-5 shrink-0" />
      <span className="flex-1">Bật thông báo trên máy này để biết ngay khi có khoản mới.</span>
      <Button size="sm" variant="primary" onClick={async () => setPerm(await requestLocalPermission())}>
        Bật
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Hộp thư của kế toán                                                  */
/* ------------------------------------------------------------------ */
function StaffInbox({ toPay, rejected, seen, onGo }) {
  return (
    <div className="space-y-4">
      <PermissionRow />
      <section>
        <h4 className="mb-2 text-sm font-semibold text-ink-900">Sếp đã duyệt — cần chi ngay ({toPay.length})</h4>
        {toPay.length === 0 ? (
          <p className="text-sm text-slate-500">Không có khoản nào đang chờ chi.</p>
        ) : (
          <ul className="space-y-2">
            {toPay.slice(0, 30).map((it) => (
              <li key={it.key} className={cx('flex items-center gap-3 rounded-xl border bg-white px-3 py-2.5', seen.has(it.key) ? 'border-slate-200' : 'border-sapphire-300 ring-1 ring-sapphire-200')}>
                <Wallet className="h-4 w-4 shrink-0 text-jade-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink-900">{it.who}</p>
                  <p className="truncate text-xs text-slate-500">
                    {it.kind === 'V' ? 'Đề xuất nội bộ' : 'Công nợ NCC'} · {it.bank ? 'chuyển khoản' : 'tiền mặt'} · duyệt {fmtDate(it.date)}
                  </p>
                </div>
                <Money value={it.amount} className="shrink-0 text-sm font-bold text-ink-900" />
              </li>
            ))}
          </ul>
        )}
        <Button variant="primary" className="mt-3 w-full" onClick={() => onGo('work-2')}>
          Mở danh sách cần chi
        </Button>
      </section>
      {rejected.length > 0 && (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-ink-900">Sếp từ chối ({rejected.length})</h4>
          <ul className="space-y-2">
            {rejected.slice(0, 20).map((v) => (
              <li key={v.id} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-rose-900">
                    {VTYPE[v.type]?.short} · {v.person}
                  </p>
                  <span className="text-xs text-rose-700">{fmtDate(v.rejectedOn)}</span>
                </div>
                <p className="text-xs text-rose-800">Lý do: {v.rejectReason || '—'}</p>
              </li>
            ))}
          </ul>
          <Button className="mt-3 w-full" onClick={() => onGo('work-1')}>
            Sửa và gửi lại
          </Button>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Chuông                                                              */
/* ------------------------------------------------------------------ */
const SEEN_MAX = 400;
const seenKey = (email) => `notif-seen:${email}`;
const loadSeen = (email) => {
  try {
    return new Set(JSON.parse(localStorage.getItem(seenKey(email)) || '[]'));
  } catch {
    return new Set();
  }
};
const saveSeen = (email, set) => {
  try {
    localStorage.setItem(seenKey(email), JSON.stringify([...set].slice(-SEEN_MAX)));
  } catch {
    /* bỏ qua */
  }
};

export function NotificationBell({ navigate }) {
  const { role, me } = useAuth();
  const data = useData();
  const manager = can(role, 'approveVouchers');
  const email = me?.email || '';
  const [open, setOpen] = useState(false);
  const pending = usePendingApprovals();
  const toPay = useToPay();
  const rejected = useMemo(
    () => (manager ? [] : (data.vouchers || []).filter((v) => v.status === 'REJECTED' && v.requestedBy === email).sort((a, b) => String(b.rejectedOn || '').localeCompare(String(a.rejectedOn || '')))),
    [manager, data.vouchers, email],
  );
  const [seen, setSeen] = useState(() => loadSeen(email));
  useEffect(() => setSeen(loadSeen(email)), [email]);

  const staffKeys = useMemo(() => [...toPay.map((it) => it.key), ...rejected.map((v) => `R:${v.id}:${v.rejectedOn || ''}`)], [toPay, rejected]);
  const count = manager ? pending.length : staffKeys.filter((k) => !seen.has(k)).length;
  const ready = !!data.vouchersReady && !!data.loaded?.ap && !!data.loaded?.approvals;

  // Số trên biểu tượng app
  useEffect(() => {
    if (ready) setBadge(count);
  }, [ready, count]);

  // Thông báo của trình duyệt khi có khoản mới (không báo lại những khoản đã có lúc mở app)
  const known = useRef(null);
  useEffect(() => {
    if (!ready) return;
    const list = manager ? pending.map((it) => ({ key: it.key, title: 'Có khoản chờ duyệt', body: `${it.who} — ${fmtVND(it.amount)}${it.what ? ` · ${it.what}` : ''}`, hash: 'approve' })) : [
      ...toPay.map((it) => ({ key: it.key, title: 'Sếp đã duyệt — chi ngay', body: `${it.who} — ${fmtVND(it.amount)}`, hash: 'work-2' })),
      ...rejected.map((v) => ({ key: `R:${v.id}:${v.rejectedOn || ''}`, title: 'Sếp từ chối đề xuất', body: `${v.person}: ${v.rejectReason || ''}`, hash: 'work-1' })),
    ];
    if (known.current === null) {
      known.current = new Set(list.map((x) => x.key));
      return;
    }
    const fresh = list.filter((x) => !known.current.has(x.key));
    list.forEach((x) => known.current.add(x.key));
    if (!fresh.length) return;
    if (document.visibilityState === 'visible' && document.hasFocus()) return;
    if (fresh.length === 1) showLocal(fresh[0].title, fresh[0].body, { tag: fresh[0].key, hash: fresh[0].hash });
    else showLocal(`${fresh.length} khoản mới`, fresh.map((x) => x.body).slice(0, 4).join('\n'), { tag: 'batch', hash: fresh[0].hash });
  }, [ready, manager, pending, toPay, rejected]);

  // Link #approve (từ tin nhắn Telegram / thông báo) mở thẳng ngăn duyệt nhanh
  useEffect(() => {
    const check = () => {
      if (window.location.hash.replace(/^#\/?/, '') === 'approve') {
        setOpen(true);
        window.history.replaceState(null, '', `#${homeRoute(role)}`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, [role]);

  const openBell = () => {
    setOpen(true);
    if (!manager) {
      const next = new Set(seen);
      staffKeys.forEach((k) => next.add(k));
      saveSeen(email, next);
      // giữ dấu "mới" trong lúc đang xem, cập nhật khi đóng
    }
  };
  const close = useCallback(() => {
    setOpen(false);
    if (!manager) setSeen(loadSeen(email));
  }, [manager, email]);
  const go = (to) => {
    close();
    navigate(to);
  };

  return (
    <>
      <button
        type="button"
        onClick={openBell}
        className="relative grid h-9 w-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100"
        aria-label={manager ? `Chờ duyệt: ${count} khoản` : `Thông báo: ${count} mới`}
        title={manager ? 'Khoản chờ duyệt' : 'Thông báo'}
      >
        {count > 0 ? <BellRing className="h-[19px] w-[19px] text-ink-900" /> : <Bell className="h-[19px] w-[19px]" />}
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      <Drawer
        open={open}
        onClose={close}
        tone={manager ? 'vermilion' : 'jade'}
        icon={manager ? Stamp : Bell}
        title={manager ? 'Duyệt nhanh' : 'Thông báo'}
        subtitle={manager ? 'Đề xuất chi và công nợ đến hạn đang chờ Sếp quyết' : 'Khoản Sếp vừa duyệt và khoản bị từ chối'}
        hero={manager ? <ApprovalSummary /> : null}
      >
        {manager ? (
          <>
            <PermissionRow />
            <QuickApprovalList />
          </>
        ) : (
          <StaffInbox toPay={toPay} rejected={rejected} seen={seen} onGo={go} />
        )}
      </Drawer>
    </>
  );
}
