import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileSpreadsheet, PenLine, Printer, Save, X } from 'lucide-react';
import { buildPrintHtml, hasBankPayments } from '../../lib/voucherPrint.js';
import { downloadBatchXlsx } from '../../lib/voucherExcel.js';
import { exportPagesPdf } from '../../lib/exportReport.js';
import { loadAttachments } from '../../lib/voucherService.js';
import { friendlyError } from '../../lib/db.js';
import { saveCompany, useCompany } from '../../lib/brand.js';
import { resolveNames } from '../../lib/runtime.js';
import { can } from '../../lib/roles.js';
import { VTYPE } from '../../lib/vouchers.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../feedback.jsx';
import { Button, Segmented, Spinner, cx } from '../ui.jsx';

const COMPANY_KEYS = [
  ['companyName', 'Đơn vị (tên công ty)'],
  ['address', 'Địa chỉ'],
  ['taxCode', 'Mã số thuế'],
  ['director', 'Giám đốc'],
  ['chiefAccountant', 'Kế toán trưởng'],
  ['cashier', 'Thủ quỹ'],
  ['addressee', 'Kính gửi (giấy đề nghị)'],
];
const PERSON_LABEL = { PT: 'Người nộp tiền', PC: 'Người nhận tiền', TU: 'Người đề nghị', TT: 'Người đề nghị' };
const PLACE_KEY = (d) => (d.type === 'PT' || d.type === 'PC' ? 'address' : 'position');

function TextField({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-ink-900 outline-none focus:border-sapphire-400 focus:ring-2 focus:ring-sapphire-100"
      />
    </label>
  );
}

/**
 * Xem trước bản in chứng từ (khung iframe) — In / Lưu PDF bằng hộp thoại in của trình duyệt,
 * tải file PDF trực tiếp, tải Excel bảng kê (khi in theo đợt kết chuyển).
 * Bảng "Thông tin in": sửa tên đơn vị, người ký, người lập phiếu, người nộp / nhận / đề nghị trước khi in.
 */
export function PrintPreview({ open, onClose, title = 'Bản in chứng từ', fileBase = 'Chung-tu', batch = null, docs = [], poster = '', cash = null, defaultPaper = 'A4' }) {
  const company = useCompany();
  const { role } = useAuth();
  const toast = useToast();
  const frame = useRef(null);
  const [paper, setPaper] = useState(defaultPaper);
  const [only, setOnly] = useState('all');
  const [withFiles, setWithFiles] = useState(false);
  const [files, setFiles] = useState(null);
  const [busy, setBusy] = useState('');
  const [names, setNames] = useState({});
  const [info, setInfo] = useState(null);
  const [preparer, setPreparer] = useState('');
  const [signer, setSigner] = useState('');
  const [edits, setEdits] = useState({});
  const [showInfo, setShowInfo] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024);
  const manager = can(role, 'approveVouchers');

  useEffect(() => {
    if (!open) return;
    setPaper(defaultPaper);
    setOnly('all');
    setEdits({});
    setPreparer('');
    setSigner(poster || '');
    setInfo(Object.fromEntries(COMPANY_KEYS.map(([k]) => [k, company[k] || ''])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultPaper]);

  // Tên hiển thị của người lập / người kết chuyển (thay cho email)
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    resolveNames(docs.flatMap((d) => [d.createdBy, d.postedBy]).filter(Boolean))
      .then((m) => alive && setNames(m))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, docs]);

  const attachmentList = useMemo(() => docs.flatMap((d) => (d.attachments || []).map((a) => ({ ...a, voucherNo: d.no }))), [docs]);

  useEffect(() => {
    if (!open || !withFiles || files) return;
    let alive = true;
    loadAttachments(attachmentList).then((list) => {
      if (!alive) return;
      const byId = Object.fromEntries(attachmentList.map((a) => [a.id, a.voucherNo]));
      setFiles(list.map((f) => ({ ...f, voucherNo: byId[f.id] || '' })));
    });
    return () => {
      alive = false;
    };
  }, [open, withFiles, files, attachmentList]);

  const printCompany = useMemo(() => ({ ...company, ...(info || {}) }), [company, info]);
  const printDocs = useMemo(
    () =>
      docs.map((d) => {
        const e = edits[d.id];
        if (!e) return d;
        const out = { ...d };
        if (e.person !== undefined) out.person = e.person;
        if (e.place !== undefined) out[PLACE_KEY(d)] = e.place;
        return out;
      }),
    [docs, edits],
  );
  const bankAvailable = useMemo(() => !!batch && hasBankPayments(docs), [batch, docs]);

  const html = useMemo(
    () =>
      open
        ? buildPrintHtml({
            batch,
            docs: printDocs,
            company: printCompany,
            paper,
            poster: signer || poster,
            names,
            preparer,
            cash,
            files: withFiles ? files || [] : [],
            title,
            only: bankAvailable ? only : 'all',
          })
        : '',
    [open, batch, printDocs, printCompany, paper, poster, signer, names, preparer, cash, withFiles, files, title, only, bankAvailable],
  );

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
      await exportPagesPdf(frame.current.contentDocument, `${fileBase}${only === 'bank' ? '_chuyen-khoan' : paper === 'A5' ? '_A5' : ''}`);
      toast.success('Đã tải file PDF');
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy('');
    }
  };
  const doXlsx = async () => {
    setBusy('xlsx');
    try {
      await downloadBatchXlsx({ batch, docs: printDocs, company: printCompany, poster: signer || poster });
      toast.success('Đã tải file Excel bảng kê');
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
  const setEdit = (d, key, val) => setEdits((m) => ({ ...m, [d.id]: { ...(m[d.id] || {}), [key]: val } }));
  const missing = info ? ['director', 'chiefAccountant', 'cashier'].filter((k) => !String(info[k] || '').trim()).length : 0;
  const defaultPreparer = [...new Set(docs.map((d) => (d.auto ? names[d.postedBy] || poster : names[d.createdBy] || d.createdByName || '')).filter(Boolean))].join(', ');

  return createPortal(
    <div data-modal-open="" className="fixed inset-0 z-[60] flex flex-col bg-ink-950/80 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-2 px-3 sm:px-5 py-3 bg-white border-b border-slate-200">
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-bold text-ink-900 truncate">{title}</p>
          <p className="text-[11px] text-slate-500">
            {docs.length} chứng từ{batch ? ` · đợt ${batch.code}` : ''} · {only === 'bank' ? 'bảng kê lệnh chuyển khoản' : paper === 'A4' ? 'mỗi chứng từ một trang A4' : '2 liên A5 trên một tờ A4 (cắt theo đường ✂)'}
          </p>
        </div>
        {bankAvailable && (
          <Segmented
            value={only}
            onChange={setOnly}
            options={[
              { value: 'all', label: 'Toàn bộ' },
              { value: 'bank', label: 'Lệnh chuyển khoản' },
            ]}
          />
        )}
        {only !== 'bank' && (
          <Segmented
            value={paper}
            onChange={setPaper}
            options={[
              { value: 'A4', label: 'A4' },
              { value: 'A5', label: '2 × A5' },
            ]}
          />
        )}
        {attachmentList.length > 0 && only !== 'bank' && (
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600 px-1">
            <input type="checkbox" className="h-4 w-4 accent-ink-900" checked={withFiles} onChange={(e) => setWithFiles(e.target.checked)} />
            Kèm ảnh chứng từ gốc ({attachmentList.length})
            {withFiles && !files && <Spinner className="h-4 w-4" />}
          </label>
        )}
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
          {batch && (
            <Button icon={FileSpreadsheet} loading={busy === 'xlsx'} onClick={doXlsx}>
              Tải Excel
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Đóng bản in">
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {showInfo && info && (
          <aside className="order-first max-h-[46vh] shrink-0 overflow-y-auto border-b border-slate-200 bg-slate-50 p-4 lg:order-last lg:max-h-none lg:w-[340px] lg:border-b-0 lg:border-l">
            <p className="text-sm font-semibold text-ink-900">Thông tin in trên phiếu</p>
            <p className="mb-3 text-[11px] text-slate-500">Sửa xong bản in cập nhật ngay. Chỉ áp dụng cho lần in này, trừ khi bấm “Lưu cho lần sau”.</p>
            <div className="space-y-2.5">
              {COMPANY_KEYS.map(([k, label]) => (
                <TextField
                  key={k}
                  label={label}
                  value={info[k] || ''}
                  onChange={(val) => setInfo((x) => ({ ...x, [k]: val }))}
                  placeholder={['director', 'chiefAccountant', 'cashier'].includes(k) ? 'Để trống: ký tay' : ''}
                />
              ))}
              {manager && (
                <Button size="sm" icon={Save} loading={busy === 'save'} onClick={saveDefaults} className="w-full">
                  Lưu thông tin đơn vị cho lần sau
                </Button>
              )}
            </div>
            <div className="mt-4 space-y-2.5 border-t border-slate-200 pt-3">
              <TextField label="Người lập phiếu (áp cho mọi phiếu)" value={preparer} onChange={setPreparer} placeholder={defaultPreparer ? `Tự điền: ${defaultPreparer}` : 'Tự điền theo người lập'} />
              {batch && <TextField label="Người lập bảng kê / chốt sổ" value={signer} onChange={setSigner} placeholder={poster} />}
            </div>
            {docs.length > 0 && only !== 'bank' && (
              <div className="mt-4 border-t border-slate-200 pt-3">
                <p className="mb-2 text-xs font-semibold text-slate-600">Từng chứng từ</p>
                <ul className="space-y-3">
                  {docs.map((d) => {
                    const e = edits[d.id] || {};
                    return (
                      <li key={d.id} className="rounded-lg bg-white p-2.5 ring-1 ring-slate-200">
                        <p className="mb-1.5 text-[11px] font-semibold text-slate-600">
                          {d.no || '(chưa cấp số)'} · {VTYPE[d.type]?.short}
                          {d.auto ? ' (tự động)' : ''}
                        </p>
                        <div className="space-y-2">
                          <TextField label={PERSON_LABEL[d.type]} value={e.person ?? d.person ?? ''} onChange={(val) => setEdit(d, 'person', val)} />
                          <TextField label={d.type === 'PT' || d.type === 'PC' ? 'Địa chỉ' : 'Bộ phận'} value={e.place ?? d[PLACE_KEY(d)] ?? ''} onChange={(val) => setEdit(d, 'place', val)} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </aside>
        )}
        <iframe ref={frame} title={title} srcDoc={html} className="min-h-0 w-full flex-1 bg-slate-200" />
      </div>
    </div>,
    document.body,
  );
}
