import { useState } from 'react';
import { DatabaseZap, Download } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { COLLECTION_LABEL, friendlyError } from '../lib/db.js';
import { exportBackup } from '../lib/backup.js';
import { useToast } from './feedback.jsx';
import { Button, Card, CardHeader } from './ui.jsx';

const EXTRA_LABEL = {
  members: 'Thành viên',
  settings: 'Cài đặt',
  plans: 'Bản nháp kế hoạch',
  internal_vouchers: 'Chứng từ nội bộ',
  voucher_files: 'Ảnh chứng từ',
  posting_batches: 'Đợt kết chuyển',
  counters: 'Bộ đếm số phiếu',
  audit_logs: 'Nhật ký',
  audit_archive: 'Nhật ký cũ (claude.ai)',
};

/** Tải toàn bộ dữ liệu về máy dưới dạng file .json (chỉ Chủ doanh nghiệp) */
export function BackupPanel() {
  const { role } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  if (role !== 'OWNER') return null;

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await exportBackup(setProgress);
      setResult(r);
      toast.success('Đã tải bản sao lưu về máy');
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const rows = result ? Object.entries(result.counts).filter(([, n]) => n > 0) : [];
  return (
    <Card className="mt-4">
      <CardHeader
        title="Sao lưu toàn bộ dữ liệu"
        subtitle="Tải một file .json về máy: tiền mặt, ngân hàng, công nợ, thanh toán, chứng từ, kế hoạch, thành viên, nhật ký"
        icon={DatabaseZap}
        iconClass="bg-ink-900 text-white"
      />
      <div className="px-4 sm:px-5 pb-5 space-y-3">
        <Button variant="primary" icon={Download} loading={busy} onClick={run}>
          {busy && progress ? `Đang đọc ${progress.done + 1}/${progress.total}…` : 'Tải bản sao lưu'}
        </Button>
        {result && (
          <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
            <p className="font-semibold text-ink-900">File đã tải về ({(result.bytes / 1024).toFixed(0)} KB) gồm:</p>
            <p className="mt-1 leading-relaxed">
              {rows.map(([k, n]) => `${COLLECTION_LABEL[k] || EXTRA_LABEL[k] || k}: ${n}`).join(' · ')}
            </p>
          </div>
        )}
        <p className="text-xs text-slate-500">Giữ file ở nơi an toàn. Có thể nhập lại phần số liệu chính bằng mục “Chuyển dữ liệu” bên dưới.</p>
      </div>
    </Card>
  );
}
