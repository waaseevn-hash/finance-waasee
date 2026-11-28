/**
 * Xem trước một mẫu in dạng bảng (Bảng đề xuất & duyệt chi, Lệnh chi / bàn giao thanh toán):
 * In / Lưu PDF, tải file PDF, sửa "Thông tin in" (đơn vị, người ký, người lập, ngày) trước khi in.
 * build(info) trả về HTML hoàn chỉnh; info = { company: {...}, preparer, date }.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, PenLine, Printer, Save, X } from 'lucide-react';
import { exportPagesPdf } from '../lib/exportReport.js';
import { friendlyError } from '../lib/db.js';
import { saveCompany, useCompany } from '../lib/brand.js';
import { can } from '../lib/roles.js';
import { todayISO } from '../lib/dates.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from './feedback.jsx';
import { Button, cx } from './ui.jsx';

const KEYS = [
  ['companyName', 'Đơn vị (tên công ty)'],
  ['address', 'Địa chỉ'],
  ['taxCode', 'Mã số thuế'],
  ['director', 'Giám đốc'],
  ['chiefAccountant', 'Kế toán trưởng'],
  ['cashier', 'Thủ quỹ'],
];

function TextField({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-ink-900 outline-none focus:border-sapphire-400 focus:ring-2 focus:ring-sapphire-100"
      />
    </label>
  );
}

export function SheetPreview({ open, onClose, title, subtitle = '', fileBase = 'Ban-in', build, signerKeys = ['director'] }) {
  const company = useCompany();
  const { role, me } = useAuth();
  const toast = useToast();
  const frame = useRef(null);
  const [info, setInfo] = useState(null);
  const [preparer, setPreparer] = useState('');
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState('');
  const [showInfo, setShowInfo] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024);
  const manager = can(role, 'approveVouchers');

  useEffect(() => {
    if (!open) return;
    setInfo(Object.fromEntries(KEYS.map(([k]) => [k, company[k] || ''])));
    setPreparer(me?.name && !String(me.name).includes('@') ? me.name : '');
    setDate(todayISO());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const html = useMemo(() => (open && info ? build({ company: { ...company, ...info }, preparer, date }) : ''), [open, info, company, preparer, date, build]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const doPrint = () => {
    const w = frame.current?.contentWindow;
    if (!w) return;
    w.focus();
    w.print();
  };
  const doPdf = async () => {
    setBusy('pdf');
    try {
      await exportPagesPdf(frame.current.contentDocument, fileBase);
      toast.success('Đã tải file PDF');
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy('');
    }
  };
  const saveDefaults = async () => {
    setBusy('save');
    try {
      await saveCompany(info);
      toast.success('Đã lưu thông tin đơn vị — các lần in sau tự điền');
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy('');
    }
  };
  const missing = info ? signerKeys.filter((k) => !String(info[k] || '').trim()).length : 0;

  return createPortal(
    <div data-modal-open="" className="fixed inset-0 z-[60] flex flex-col bg-ink-950/80 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-3 sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm font-bold text-ink-900">{title}</p>
          {subtitle && <p className="text-[11px] text-slate-500">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={PenLine} variant={showInfo ? 'secondary' : 'ghost'} onClick={() => setShowInfo((x) => !x)} className={cx(missing > 0 && !showInfo && 'ring-2 ring-amber-300')}>
            Thông tin in{missing > 0 ? ` (${missing} ô trống)` : ''}
          </Button>
          <Button variant="primary" icon={Printer} onClick={doPrint}>
            In / Lưu PDF
          </Button>
          <Button icon={Download} loading={busy === 'pdf'} onClick={doPdf}>
            Tải PDF
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Đóng bản in">
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {showInfo && info && (
          <aside className="order-first max-h-[46vh] shrink-0 overflow-y-auto border-b border-slate-200 bg-slate-50 p-4 lg:order-last lg:max-h-none lg:w-[340px] lg:border-b-0 lg:border-l">
            <p className="text-sm font-semibold text-ink-900">Thông tin in</p>
            <p className="mb-3 text-[11px] text-slate-500">Sửa xong bản in cập nhật ngay. Chỉ áp dụng cho lần in này, trừ khi bấm “Lưu cho lần sau”.</p>
            <div className="space-y-2.5">
              <TextField label="Ngày lập" type="date" value={date} onChange={setDate} />
              <TextField label="Người lập" value={preparer} onChange={setPreparer} placeholder="Để trống: ký tay" />
              {KEYS.map(([k, label]) => (
                <TextField key={k} label={label} value={info[k] || ''} onChange={(val) => setInfo((x) => ({ ...x, [k]: val }))} placeholder={['director', 'chiefAccountant', 'cashier'].includes(k) ? 'Để trống: ký tay' : ''} />
              ))}
              {manager && (
                <Button size="sm" icon={Save} loading={busy === 'save'} onClick={saveDefaults} className="w-full">
                  Lưu thông tin đơn vị cho lần sau
                </Button>
              )}
            </div>
          </aside>
        )}
        <iframe ref={frame} title={title} srcDoc={html} className="min-h-0 w-full flex-1 bg-slate-200" />
      </div>
    </div>,
    document.body,
  );
}
