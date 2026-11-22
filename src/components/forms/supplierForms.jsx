import { useEffect, useState } from 'react';
import { Building2, Copy, Landmark, Phone } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { AuditedBatch, C, friendlyError } from '../../lib/db.js';
import { normalizeText } from '../../lib/format.js';
import { useToast } from '../feedback.jsx';
import { Button, Field, Input, Modal, Textarea, cx } from '../ui.jsx';

/* Danh bạ nhà cung cấp: tên, mã số thuế, tài khoản ngân hàng nhận tiền */
export const SUPPLIER_FIELDS = ['name', 'taxCode', 'bankAccount', 'bankName', 'bankBranch', 'accountHolder', 'contactName', 'phone', 'address', 'note'];
export const SUPPLIER_KEYS = ['id', ...SUPPLIER_FIELDS, 'kind', '_auditId'];
export const pickSupplier = (s) => Object.fromEntries(SUPPLIER_KEYS.filter((k) => s?.[k] !== undefined).map((k) => [k, s[k]]));

/** Tìm NCC của một khoản phải trả: theo supplierId, nếu chưa có thì theo tên */
export function findSupplier(suppliers = [], { supplierId, partnerName } = {}) {
  if (supplierId) {
    const byId = suppliers.find((s) => s.id === supplierId);
    if (byId) return byId;
  }
  const n = normalizeText(partnerName).trim();
  return n ? suppliers.find((s) => normalizeText(s.name).trim() === n) || null : null;
}

/** "0123456789 · Vietcombank – CN Bình Dương" */
export function payToText(s) {
  if (!s?.bankAccount) return '';
  return [s.bankAccount, [s.bankName, s.bankBranch].filter(Boolean).join(' – ')].filter(Boolean).join(' · ');
}

/** Mã số thuế VN: 10 số, hoặc 10 số + "-" + 3 số (chi nhánh) */
export function taxCodeWarning(v) {
  const t = String(v || '').trim();
  if (!t) return '';
  return /^\d{10}(-\d{3})?$/.test(t) ? '' : 'MST thường gồm 10 số (hoặc 10 số-3 số). Kiểm tra lại.';
}

export async function copyText(text, toast) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Đã sao chép: ${text}`);
  } catch {
    toast.info(`Không sao chép được tự động. Số cần chép: ${text}`);
  }
}

/** Khối hiển thị gọn thông tin thanh toán của NCC */
export function SupplierInfo({ supplier, compact = false, className = '' }) {
  if (!supplier) return null;
  const pay = payToText(supplier);
  if (!supplier.taxCode && !pay) return <p className={cx('text-xs text-amber-700 truncate', className)}>Chưa có MST / số tài khoản — bổ sung trong danh bạ</p>;
  if (compact) {
    // một dòng: số tài khoản + ngân hàng (dùng khi chuyển khoản)
    return (
      <p className={cx('text-xs text-slate-500 truncate', className)} title={[supplier.taxCode && `MST ${supplier.taxCode}`, pay].filter(Boolean).join(' · ')}>
        {supplier.bankAccount ? (
          <>
            <Landmark className="mr-1 inline h-3 w-3 align-[-1px]" />
            STK <span className="font-medium text-ink-800">{supplier.bankAccount}</span>
            {supplier.bankName && ` · ${supplier.bankName}`}
          </>
        ) : (
          <span className="text-amber-700">MST {supplier.taxCode} · chưa có số tài khoản</span>
        )}
      </p>
    );
  }
  return (
    <p className={cx('text-xs text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5', className)}>
      {supplier.taxCode && <span>MST {supplier.taxCode}</span>}
      {pay && (
        <span className="inline-flex items-center gap-1">
          <Landmark className="h-3 w-3 shrink-0" />
          {pay}
        </span>
      )}
    </p>
  );
}

/** Các ô thông tin thanh toán dùng chung (form NCC và form công nợ phải trả) */
export function SupplierPaymentFields({ f, set, columns = 'sm:grid-cols-2' }) {
  const warn = taxCodeWarning(f.taxCode);
  return (
    <div className={cx('grid grid-cols-1 gap-4', columns)}>
      <Field label="Mã số thuế" hint="VD: 0312345678" error={warn}>
        <Input value={f.taxCode} onChange={set('taxCode')} inputMode="numeric" placeholder="0312345678" />
      </Field>
      <Field label="Số tài khoản nhận tiền">
        <Input value={f.bankAccount} onChange={set('bankAccount')} inputMode="numeric" placeholder="VD: 0071001234567" />
      </Field>
      <Field label="Ngân hàng">
        <Input value={f.bankName} onChange={set('bankName')} placeholder="VD: Vietcombank" list="vn-banks" />
        <datalist id="vn-banks">
          {['Vietcombank', 'VietinBank', 'BIDV', 'Agribank', 'Techcombank', 'MB Bank', 'ACB', 'VPBank', 'Sacombank', 'TPBank', 'HDBank', 'SHB', 'VIB', 'OCB', 'SeABank', 'MSB', 'Eximbank', 'LPBank'].map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
      </Field>
      <Field label="Chi nhánh">
        <Input value={f.bankBranch} onChange={set('bankBranch')} placeholder="VD: CN Bình Dương" />
      </Field>
      <Field label="Chủ tài khoản" className={columns.includes('2') ? 'sm:col-span-2' : ''}>
        <Input value={f.accountHolder} onChange={set('accountHolder')} placeholder="Tên đơn vị / người nhận trên tài khoản" />
      </Field>
    </div>
  );
}

export const emptySupplier = () => Object.fromEntries(SUPPLIER_FIELDS.map((k) => [k, '']));

export function cleanSupplier(f) {
  return Object.fromEntries(SUPPLIER_FIELDS.map((k) => [k, String(f[k] || '').trim()]));
}

/** Thêm / sửa nhà cung cấp */
export function SupplierModal({ open, onClose, initial, suppliers = [] }) {
  const { actor } = useAuth();
  const toast = useToast();
  const [f, setF] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErr('');
    setF({ ...emptySupplier(), ...Object.fromEntries(SUPPLIER_FIELDS.map((k) => [k, initial?.[k] || ''])) });
  }, [open, initial]);
  if (!open || !f) return null;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));

  const submit = async (e) => {
    e.preventDefault();
    const data = cleanSupplier(f);
    if (!data.name) return setErr('Nhập tên nhà cung cấp');
    const dup = suppliers.find((s) => s.id !== initial?.id && normalizeText(s.name).trim() === normalizeText(data.name).trim());
    if (dup) return setErr('Đã có nhà cung cấp trùng tên trong danh bạ');
    setBusy(true);
    try {
      const b = new AuditedBatch(actor);
      if (initial?.id) b.update(C.partners, initial.id, data, initial, `Cập nhật nhà cung cấp ${data.name}`);
      else b.create(C.partners, { ...data, kind: 'SUPPLIER' }, `Thêm nhà cung cấp ${data.name}`);
      await b.commit();
      toast.success('Đã lưu nhà cung cấp');
      onClose();
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial?.id ? 'Sửa thông tin nhà cung cấp' : 'Thêm nhà cung cấp'}
      subtitle="Thông tin dùng khi chuyển khoản thanh toán"
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Hủy</Button>
          <Button type="submit" form="supplier-form" variant="vermilion" loading={busy}>
            Lưu nhà cung cấp
          </Button>
        </>
      }
    >
      <form id="supplier-form" onSubmit={submit} className="space-y-4">
        <Field label="Tên nhà cung cấp" required error={err}>
          <Input value={f.name} onChange={set('name')} placeholder="VD: Công ty TNHH Dây cáp Đồng Việt" autoFocus />
        </Field>
        <SupplierPaymentFields f={f} set={set} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Người liên hệ">
            <Input value={f.contactName} onChange={set('contactName')} />
          </Field>
          <Field label="Điện thoại">
            <Input value={f.phone} onChange={set('phone')} inputMode="tel" />
          </Field>
          <Field label="Địa chỉ" className="sm:col-span-2">
            <Input value={f.address} onChange={set('address')} />
          </Field>
          <Field label="Ghi chú" className="sm:col-span-2">
            <Textarea value={f.note} onChange={set('note')} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

/** Thẻ NCC trong danh bạ */
export function SupplierCard({ s, outstanding, onEdit, onDelete, toast, children }) {
  const pay = payToText(s);
  return (
    <div className="relative rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,30,58,0.05)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-vermilion-50 text-vermilion-600">
            <Building2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="font-display font-semibold text-ink-900 truncate">{s.name}</p>
            <p className="text-xs text-slate-500">{s.taxCode ? `MST ${s.taxCode}` : 'Chưa có mã số thuế'}</p>
          </div>
        </div>
        {children}
      </div>
      <div className="mt-3 rounded-xl bg-paper px-3 py-2.5">
        {pay ? (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-mono text-[15px] font-semibold tracking-wide text-ink-900">{s.bankAccount}</p>
              <p className="text-xs text-slate-500 truncate">
                {[s.bankName, s.bankBranch].filter(Boolean).join(' – ')}
                {s.accountHolder && ` · ${s.accountHolder}`}
              </p>
            </div>
            <Button size="xs" icon={Copy} onClick={() => copyText(s.bankAccount, toast)}>
              Chép STK
            </Button>
          </div>
        ) : (
          <p className="text-xs text-amber-700">Chưa có số tài khoản nhận tiền</p>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
        <span className="text-slate-500 inline-flex items-center gap-1 truncate">
          {s.phone && (
            <>
              <Phone className="h-3 w-3" /> {s.contactName ? `${s.contactName} · ` : ''}
              {s.phone}
            </>
          )}
        </span>
        <span className="text-slate-500 whitespace-nowrap">
          Còn phải trả <b className="money text-vermilion-600">{outstanding}</b>
        </span>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="xs" onClick={onEdit}>
          Sửa
        </Button>
        {onDelete && (
          <Button size="xs" variant="dangerGhost" onClick={onDelete}>
            Xóa
          </Button>
        )}
      </div>
    </div>
  );
}
