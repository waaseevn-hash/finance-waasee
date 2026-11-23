import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileSpreadsheet, Printer, X } from 'lucide-react';
import { buildPrintHtml } from '../../lib/voucherPrint.js';
import { downloadBatchXlsx } from '../../lib/voucherExcel.js';
import { exportPagesPdf } from '../../lib/exportReport.js';
import { loadAttachments } from '../../lib/voucherService.js';
import { friendlyError } from '../../lib/db.js';
import { useCompany } from '../../lib/brand.js';
import { useToast } from '../feedback.jsx';
import { Button, Segmented, Spinner, cx } from '../ui.jsx';

/**
 * Xem trước bản in chứng từ (khung iframe) — In / Lưu PDF bằng hộp thoại in của trình duyệt,
 * tải file PDF trực tiếp, tải Excel bảng kê (khi in theo đợt kết chuyển).
 */
export function PrintPreview({ open, onClose, title = 'Bản in chứng từ', fileBase = 'Chung-tu', batch = null, docs = [], poster = '', cash = null, defaultPaper = 'A4' }) {
  const company = useCompany();
  const toast = useToast();
  const frame = useRef(null);
  const [paper, setPaper] = useState(defaultPaper);
  const [withFiles, setWithFiles] = useState(false);
  const [files, setFiles] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (open) setPaper(defaultPaper);
  }, [open, defaultPaper]);

  const attachmentList = useMemo(
    () => docs.flatMap((d) => (d.attachments || []).map((a) => ({ ...a, voucherNo: d.no }))),
    [docs],
  );

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

  const html = useMemo(
    () =>
      open
        ? buildPrintHtml({ batch, docs, company, paper, poster, cash, files: withFiles ? files || [] : [], title })
        : '',
    [open, batch, docs, company, paper, poster, cash, withFiles, files, title],
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
      await exportPagesPdf(frame.current.contentDocument, `${fileBase}${paper === 'A5' ? '_A5' : ''}`);
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
      await downloadBatchXlsx({ batch, docs, company, poster });
      toast.success('Đã tải file Excel bảng kê');
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy('');
    }
  };

  return createPortal(
    <div data-modal-open="" className="fixed inset-0 z-[60] flex flex-col bg-ink-950/80 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-2 px-3 sm:px-5 py-3 bg-white border-b border-slate-200">
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-bold text-ink-900 truncate">{title}</p>
          <p className="text-[11px] text-slate-500">
            {docs.length} chứng từ{batch ? ` · đợt ${batch.code}` : ''} · {paper === 'A4' ? 'mỗi chứng từ một trang A4' : '2 liên A5 trên một tờ A4 (cắt theo đường ✂)'}
          </p>
        </div>
        <Segmented
          value={paper}
          onChange={setPaper}
          options={[
            { value: 'A4', label: 'A4' },
            { value: 'A5', label: '2 × A5' },
          ]}
        />
        {attachmentList.length > 0 && (
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600 px-1">
            <input type="checkbox" className="h-4 w-4 accent-ink-900" checked={withFiles} onChange={(e) => setWithFiles(e.target.checked)} />
            In kèm ảnh chứng từ gốc ({attachmentList.length})
            {withFiles && !files && <Spinner className="h-4 w-4" />}
          </label>
        )}
        <div className="flex flex-wrap gap-2">
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
      <iframe ref={frame} title={title} srcDoc={html} className={cx('flex-1 w-full bg-slate-200')} />
    </div>,
    document.body,
  );
}
