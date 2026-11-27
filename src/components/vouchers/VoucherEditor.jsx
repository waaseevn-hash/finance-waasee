import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CircleCheck, FileText, ImagePlus, Paperclip, Plus, Save, Send, Trash2, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { C, friendlyError, newId } from '../../lib/db.js';
import { can } from '../../lib/roles.js';
import { todayISO, fmtDate } from '../../lib/dates.js';
import { fmtVND } from '../../lib/format.js';
import { useCompany } from '../../lib/brand.js';
import { VTYPE, advanceRemaining, itemAmount, openAdvances, settlement, validateVoucher } from '../../lib/vouchers.js';
import { loadAttachments, normalizeForm, removeAttachment, saveVoucher, uploadAttachment } from '../../lib/voucherService.js';
import { useToast } from '../feedback.jsx';
import { Money, MoneyInput } from '../Money.jsx';
import { Button, Field, Input, Modal, Segmented, Select, Spinner, Textarea, cx } from '../ui.jsx';
import { AccountSelect, AmountWords, TYPE_STYLE, VTypeChip } from './common.jsx';

const emptyItem = () => ({ name: '', unit: '', qty: 1, price: 0 });

function initialForm({ type, existing, prefill, me, company }) {
  if (existing) {
    return {
      ...existing,
      items: existing.items?.length ? existing.items.map((it) => ({ ...it })) : [emptyItem()],
      advanceMode: existing.advanceId ? 'link' : Number(existing.advanceAmount) > 0 ? 'manual' : 'none',
      attachments: existing.attachments || [],
    };
  }
  return {
    type,
    date: todayISO(),
    person: type === 'TU' || type === 'TT' ? me?.name || '' : '',
    position: '',
    address: '',
    reason: '',
    amount: 0,
    items: [emptyItem()],
    advanceMode: 'none',
    advanceId: '',
    advanceNo: '',
    advanceAmount: 0,
    expenseAccount: '642',
    debit: '642',
    credit: '141',
    attachedDocs: '',
    bookNo: company.bookNo || '',
    dueDate: '',
    attachments: [],
    payMethod: 'CASH',
    payeeName: '',
    payeeAccount: '',
    payeeBank: '',
    payeeBranch: '',
    payeeTaxCode: '',
    transferNote: '',
    ...(prefill || {}),
  };
}

/**
 * Danh bạ người nhận để tự điền: nhà cung cấp (có tài khoản ngân hàng) và người đã có trong chứng từ trước.
 * Trả về Map tên (thường) -> { name, place, account, bank, branch, holder, taxCode }
 */
function usePayeeBook(vouchers, suppliers) {
  return useMemo(() => {
    const m = new Map();
    const put = (name, info) => {
      const k = String(name || '').trim().toLowerCase();
      if (!k) return;
      const cur = m.get(k) || { name: String(name).trim() };
      for (const [key, val] of Object.entries(info)) if (val && !cur[key]) cur[key] = val;
      m.set(k, cur);
    };
    // chứng từ mới nhất trước
    const list = [...(vouchers || [])].filter((v) => !v.auto).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    for (const v of list) {
      put(v.person, {
        place: v.position || v.address || '',
        account: v.payeeAccount || '',
        bank: v.payeeBank || '',
        branch: v.payeeBranch || '',
        holder: v.payeeName || '',
        taxCode: v.payeeTaxCode || '',
      });
    }
    for (const sp of suppliers || []) {
      put(sp.name, { place: sp.address || '', account: sp.bankAccount || '', bank: sp.bankName || '', branch: sp.bankBranch || '', holder: sp.accountHolder || sp.name, taxCode: sp.taxCode || '' });
    }
    return m;
  }, [vouchers, suppliers]);
}

const LABELS = {
  TU: { person: 'Họ tên người đề nghị tạm ứng', place: 'Bộ phận (hoặc địa chỉ)', reason: 'Lý do tạm ứng', amount: 'Số tiền đề nghị tạm ứng' },
  TT: { person: 'Họ tên người đề nghị thanh toán', place: 'Bộ phận (hoặc địa chỉ)', reason: 'Nội dung thanh toán', amount: '' },
  PT: { person: 'Họ tên người nộp tiền', place: 'Địa chỉ', reason: 'Lý do nộp', amount: 'Số tiền' },
  PC: { person: 'Họ tên người nhận tiền', place: 'Địa chỉ', reason: 'Lý do chi', amount: 'Số tiền' },
};

/**
 * Biểu mẫu lập / sửa chứng từ.
 * @param type      loại chứng từ khi lập mới
 * @param existing  chứng từ đang sửa
 * @param prefill   dữ liệu điền sẵn (vd GĐNTT hoàn ứng từ một giấy tạm ứng)
 */
export function VoucherEditor({ type: newType, existing = null, prefill = null, onClose, onSaved }) {
  const { actor, role, me } = useAuth();
  const data = useData();
  const toast = useToast();
  const company = useCompany();
  const manager = can(role, 'approveVouchers');
  const [vid] = useState(() => existing?.id || newId(C.vouchers));
  const [form, setForm] = useState(() => initialForm({ type: newType, existing, prefill, me, company }));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  const [uploading, setUploading] = useState(0);
  const [thumbs, setThumbs] = useState({});
  const added = useRef(new Set());
  const removed = useRef(new Set());
  const fileInput = useRef(null);
  const cameraInput = useRef(null);
  const type = form.type;
  const L = LABELS[type];
  const style = TYPE_STYLE[type];
  const book = usePayeeBook(data.vouchers, data.suppliers);
  const bank = form.payMethod === 'BANK';

  // Chọn / gõ đúng tên đã có: tự điền bộ phận / địa chỉ và tài khoản ngân hàng (chỉ điền ô còn trống)
  const pickPerson = (name) => {
    const hit = book.get(String(name || '').trim().toLowerCase());
    const patch = { person: name };
    if (hit) {
      const placeKey = type === 'PT' || type === 'PC' ? 'address' : 'position';
      if (!form[placeKey] && hit.place) patch[placeKey] = hit.place;
      if (!form.payeeAccount && hit.account) {
        Object.assign(patch, { payeeAccount: hit.account, payeeBank: form.payeeBank || hit.bank || '', payeeBranch: form.payeeBranch || hit.branch || '', payeeName: form.payeeName || hit.holder || '', payeeTaxCode: form.payeeTaxCode || hit.taxCode || '' });
      }
    }
    set(patch);
  };

  // Ảnh đã lưu của chứng từ đang sửa: tải để xem thu nhỏ
  useEffect(() => {
    let alive = true;
    if (existing?.attachments?.length) {
      loadAttachments(existing.attachments).then((list) => {
        if (alive) setThumbs((t) => ({ ...t, ...Object.fromEntries(list.map((f) => [f.id, f.dataUrl])) }));
      });
    }
    return () => {
      alive = false;
    };
  }, [existing]);

  const set = (patch) => {
    setError('');
    setForm((f) => ({ ...f, ...patch }));
  };
  const setItem = (i, patch) => set({ items: form.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });

  const advances = useMemo(() => {
    const list = openAdvances(data.vouchers);
    // giữ lại giấy tạm ứng đang liên kết (kể cả khi đã quyết toán hết bởi chính chứng từ này)
    if (form.advanceId && !list.some((a) => a.id === form.advanceId)) {
      const cur = (data.vouchers || []).find((v) => v.id === form.advanceId);
      if (cur) list.push(cur);
    }
    return list;
  }, [data.vouchers, form.advanceId]);

  // Biểu mẫu đã làm sạch phần tạm ứng theo lựa chọn (không / theo giấy / nhập tay)
  const cleanForm = useMemo(() => {
    const f = { ...form };
    if (f.type === 'TT' && f.advanceMode === 'none') Object.assign(f, { advanceId: '', advanceNo: '', advanceAmount: 0 });
    if (f.type === 'TT' && f.advanceMode === 'manual') Object.assign(f, { advanceId: '', advanceNo: '' });
    return f;
  }, [form]);
  const normalized = useMemo(() => normalizeForm(cleanForm), [cleanForm]);

  const s = type === 'TT' ? settlement(normalized) : null;
  const amount = normalized.amount;

  const pickAdvance = (id) => {
    const a = advances.find((x) => x.id === id);
    if (!a) return set({ advanceId: '', advanceNo: '', advanceAmount: 0 });
    set({
      advanceId: a.id,
      advanceNo: a.no,
      advanceAmount: advanceRemaining(a) || Number(form.advanceAmount) || 0,
      person: form.person || a.person,
      position: form.position || a.position || '',
    });
  };

  /* ---------- đính kèm ---------- */
  const onFiles = async (fileList) => {
    const files = [...(fileList || [])];
    if (!files.length) return;
    const room = 12 - form.attachments.length;
    if (room <= 0) return toast.error('Tối đa 12 file đính kèm cho một chứng từ');
    setUploading((n) => n + Math.min(room, files.length));
    for (const file of files.slice(0, room)) {
      try {
        const att = await uploadAttachment({ actor, voucherId: vid, requestedBy: existing?.requestedBy || actor.email, file });
        added.current.add(att.id);
        const reader = new FileReader();
        reader.onload = () => setThumbs((t) => ({ ...t, [att.id]: String(reader.result) }));
        if (file.type.startsWith('image/')) reader.readAsDataURL(file);
        setForm((f) => ({ ...f, attachments: [...f.attachments, att] }));
      } catch (ex) {
        toast.error(friendlyError(ex));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };
  const dropAttachment = (a) => {
    if (added.current.has(a.id)) {
      added.current.delete(a.id);
      removeAttachment(a.id).catch(() => {});
    } else removed.current.add(a.id);
    setForm((f) => ({ ...f, attachments: f.attachments.filter((x) => x.id !== a.id) }));
  };

  const cancel = () => {
    // Hủy: dọn các file vừa tải lên nhưng chưa lưu vào chứng từ
    for (const id of added.current) removeAttachment(id).catch(() => {});
    onClose();
  };

  /* ---------- lưu ---------- */
  const save = async (mode) => {
    if (mode === 'draft') {
      if (!normalized.person || !/^\d{4}-\d{2}-\d{2}$/.test(normalized.date || '')) return setError('Nhập ít nhất ngày và họ tên để lưu nháp');
    } else {
      const msg = validateVoucher(normalized, { advances });
      if (msg) return setError(msg);
    }
    if (uploading) return setError('Đợi tải xong ảnh đính kèm rồi lưu');
    setSaving(mode);
    try {
      // Bản nháp được phép thiếu nội dung: điền tạm để hợp lệ khi lưu
      const formToSave = mode === 'draft' ? { ...cleanForm, reason: String(cleanForm.reason || '').trim() || '(nháp)' } : cleanForm;
      const id = await saveVoucher({ actor, id: vid, existing, form: formToSave, mode });
      for (const fid of removed.current) removeAttachment(fid).catch(() => {});
      added.current.clear();
      toast.success(mode === 'draft' ? 'Đã lưu nháp' : mode === 'submit' ? 'Đã gửi duyệt' : 'Đã lưu & duyệt — chứng từ đã được cấp số');
      onSaved?.(id);
      onClose();
    } catch (ex) {
      setError(friendlyError(ex));
    } finally {
      setSaving('');
    }
  };

  return (
    <Modal
      open
      onClose={cancel}
      size="xl"
      title={
        <span className="flex flex-wrap items-center gap-2">
          {existing ? 'Sửa' : 'Lập'} {VTYPE[type].label.toLowerCase()}
          <VTypeChip type={type} />
        </span>
      }
      subtitle={`${VTYPE[type].form} · ${company.regulation}${existing?.no ? ` · Số ${existing.no}` : ''}`}
      footer={
        <>
          <Button onClick={cancel}>Hủy</Button>
          <Button icon={Save} loading={saving === 'draft'} disabled={!!saving} onClick={() => save('draft')}>
            Lưu nháp
          </Button>
          <Button variant="amber" icon={Send} loading={saving === 'submit'} disabled={!!saving} onClick={() => save('submit')}>
            Gửi duyệt
          </Button>
          {manager && (
            <Button variant="primary" icon={CircleCheck} loading={saving === 'approve'} disabled={!!saving} onClick={() => save('approve')}>
              Lưu & duyệt
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        {existing?.status === 'REJECTED' && existing.rejectReason && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            <b>Bị từ chối:</b> {existing.rejectReason}. Sửa lại rồi bấm “Gửi duyệt”.
          </div>
        )}

        <div className={cx('h-1 w-16 rounded-full', style.bar)} />

        <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
          <Field label="Ngày chứng từ" required className="sm:col-span-2">
            <Input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />
          </Field>
          <Field label={L.person} required className="sm:col-span-4">
            <Input value={form.person} onChange={(e) => pickPerson(e.target.value)} placeholder="Nguyễn Văn A" autoComplete="off" list="voucher-people" />
            <datalist id="voucher-people">
              {[...book.values()].slice(0, 300).map((p) => (
                <option key={p.name} value={p.name}>
                  {p.account ? `${p.bank || ''} ${p.account}`.trim() : p.place || ''}
                </option>
              ))}
            </datalist>
          </Field>
          <Field label={L.place} className="sm:col-span-6">
            <Input
              value={type === 'PT' || type === 'PC' ? form.address : form.position}
              onChange={(e) => set(type === 'PT' || type === 'PC' ? { address: e.target.value } : { position: e.target.value })}
              placeholder={type === 'PT' || type === 'PC' ? 'Phòng Kinh doanh / địa chỉ người nộp, nhận' : 'Phòng Kinh doanh'}
            />
          </Field>
          <Field label={L.reason} required className="sm:col-span-6">
            <Textarea value={form.reason} onChange={(e) => set({ reason: e.target.value })} rows={2} placeholder={type === 'TU' ? 'Tạm ứng đi công tác Đà Nẵng 3 ngày' : type === 'TT' ? 'Thanh toán chi phí tiếp khách tháng 11' : ''} />
          </Field>
        </div>

        {/* ---------- số tiền / bảng kê ---------- */}
        {type !== 'TT' ? (
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
            <Field label={L.amount} required className="sm:col-span-3">
              <MoneyInput value={form.amount} onChange={(v) => set({ amount: v })} />
            </Field>
            {type === 'TU' && (
              <Field label="Thời hạn thanh toán (hoàn ứng)" className="sm:col-span-3">
                <Input type="date" value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
              </Field>
            )}
            {type === 'PT' && (
              <Field label={`Tài khoản ghi Có (Nợ ${bank ? '1121' : '1111'})`} className="sm:col-span-3">
                <AccountSelect set="ptCredit" value={form.credit} onChange={(v) => set({ credit: v })} />
              </Field>
            )}
            {type === 'PC' && (
              <Field label={`Tài khoản ghi Nợ (Có ${bank ? '1121' : '1111'})`} className="sm:col-span-3">
                <AccountSelect set="pcDebit" value={form.debit} onChange={(v) => set({ debit: v })} />
              </Field>
            )}
            <div className="sm:col-span-6 -mt-1">
              <AmountWords value={amount} />
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-ink-900">Bảng kê chi phí</p>
              <Button size="xs" variant="ghost" icon={Plus} onClick={() => set({ items: [...form.items, emptyItem()] })}>
                Thêm dòng
              </Button>
            </div>
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="hidden sm:grid grid-cols-[32px_minmax(0,1fr)_80px_80px_130px_130px_36px] gap-2 bg-slate-50 px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <span className="text-center">TT</span>
                <span>Tên chi phí</span>
                <span>ĐVT</span>
                <span className="text-right">SL</span>
                <span className="text-right">Đơn giá</span>
                <span className="text-right">Thành tiền</span>
                <span />
              </div>
              <ul className="divide-y divide-slate-100">
                {form.items.map((it, i) => {
                  const del = (
                    <button
                      type="button"
                      onClick={() => set({ items: form.items.length > 1 ? form.items.filter((_, j) => j !== i) : [emptyItem()] })}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      aria-label={`Xóa dòng ${i + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  );
                  const name = <Input value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} placeholder="Vé máy bay, khách sạn…" className="!h-9" aria-label={`Tên chi phí dòng ${i + 1}`} />;
                  const unit = <Input value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value })} placeholder="ĐVT" className="!h-9" aria-label="Đơn vị tính" />;
                  const qty = (
                    <Input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={it.qty}
                      onChange={(e) => setItem(i, { qty: e.target.value === '' ? '' : Number(e.target.value) })}
                      className="!h-9 text-right"
                      aria-label="Số lượng"
                    />
                  );
                  const price = <MoneyInput value={it.price} onChange={(v) => setItem(i, { price: v })} showHint={false} className="!h-9" aria-label="Đơn giá" />;
                  return (
                    <li key={i} className="px-2 py-2">
                      {/* Máy tính: một hàng 6 cột */}
                      <div className="hidden sm:grid grid-cols-[32px_minmax(0,1fr)_80px_80px_130px_130px_36px] gap-2 items-center">
                        <span className="text-center text-sm text-slate-500">{i + 1}</span>
                        {name}
                        {unit}
                        {qty}
                        {price}
                        <span className="text-right text-sm font-semibold tabular-nums text-ink-900">{fmtVND(itemAmount(it))}</span>
                        {del}
                      </div>
                      {/* Điện thoại: thẻ xếp dọc */}
                      <div className="sm:hidden space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="w-6 text-center text-sm text-slate-500">{i + 1}</span>
                          <div className="flex-1 min-w-0">{name}</div>
                          {del}
                        </div>
                        <div className="grid grid-cols-[1fr_1fr_2fr] gap-2 pl-8">
                          {unit}
                          {qty}
                          {price}
                        </div>
                        <p className="pl-8 text-right text-sm font-semibold tabular-nums text-ink-900">= {fmtVND(itemAmount(it))}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-center justify-between gap-3 bg-orchid-50/60 px-3 py-2.5 border-t border-orchid-100">
                <span className="text-sm font-semibold text-ink-900">Tổng cộng (A)</span>
                <Money value={s.A} className="text-base font-bold text-ink-900" />
              </div>
            </div>
            <AmountWords value={s.A} className="mt-1.5" />

            {/* ---------- quyết toán tạm ứng ---------- */}
            <div className="mt-4 rounded-xl border border-slate-200 p-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-ink-900">Tạm ứng đã nhận (B)</p>
                <Segmented
                  value={form.advanceMode}
                  onChange={(v) => set({ advanceMode: v })}
                  options={[
                    { value: 'none', label: 'Không tạm ứng' },
                    { value: 'link', label: 'Theo giấy tạm ứng' },
                    { value: 'manual', label: 'Nhập tay' },
                  ]}
                />
              </div>
              {form.advanceMode === 'link' && (
                <Field label="Giấy đề nghị tạm ứng đã chi (còn phải quyết toán)">
                  <Select value={form.advanceId} onChange={(e) => pickAdvance(e.target.value)}>
                    <option value="">— Chọn giấy tạm ứng —</option>
                    {advances.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.no} · {a.person} · {fmtDate(a.date)} · còn {fmtVND(advanceRemaining(a))}
                      </option>
                    ))}
                  </Select>
                  {!advances.length && <span className="mt-1 block text-xs text-slate-500">Chưa có giấy tạm ứng nào đã kết chuyển còn dư nợ. Dùng “Nhập tay” nếu tạm ứng ngoài phần mềm.</span>}
                </Field>
              )}
              {form.advanceMode !== 'none' && (
                <Field label="Số tiền đã tạm ứng (B)">
                  <MoneyInput value={form.advanceAmount} onChange={(v) => set({ advanceAmount: v })} />
                </Field>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Tài khoản chi phí (ghi Nợ)">
                  <AccountSelect set="expense" value={form.expenseAccount} onChange={(v) => set({ expenseAccount: v })} />
                </Field>
                <SettlementNote s={s} account={form.expenseAccount} />
              </div>
            </div>
          </div>
        )}

        {/* ---------- hình thức thanh toán ---------- */}
        <div className="rounded-xl border border-slate-200 p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink-900">{type === 'PT' ? 'Hình thức nhận tiền' : 'Hình thức thanh toán'}</p>
            <Segmented
              value={form.payMethod || 'CASH'}
              onChange={(m) => {
                const patch = { payMethod: m };
                if (m === 'BANK' && type !== 'PT') {
                  const hit = book.get(String(form.person || '').trim().toLowerCase());
                  if (hit && !form.payeeAccount && hit.account) Object.assign(patch, { payeeAccount: hit.account, payeeBank: hit.bank || '', payeeBranch: hit.branch || '', payeeName: hit.holder || '', payeeTaxCode: hit.taxCode || '' });
                }
                set(patch);
              }}
              options={[
                { value: 'CASH', label: 'Tiền mặt (111)' },
                { value: 'BANK', label: 'Chuyển khoản (112)' },
              ]}
            />
          </div>
          {bank && type === 'PT' && <p className="text-xs text-slate-500">Tiền vào tài khoản ngân hàng của công ty (Nợ 1121). Chọn tài khoản nhận khi kết chuyển.</p>}
          {bank && type !== 'PT' && (
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
              <Field label="Tên chủ tài khoản nhận" className="sm:col-span-3">
                <Input value={form.payeeName} onChange={(e) => set({ payeeName: e.target.value })} placeholder={form.person || 'Tên đơn vị / người nhận'} />
              </Field>
              <Field label="Số tài khoản" required className="sm:col-span-3">
                <Input value={form.payeeAccount} onChange={(e) => set({ payeeAccount: e.target.value })} inputMode="numeric" placeholder="VD: 0071001234567" />
              </Field>
              <Field label="Ngân hàng" required className="sm:col-span-3">
                <Input value={form.payeeBank} onChange={(e) => set({ payeeBank: e.target.value })} placeholder="VD: Vietcombank" list="voucher-banks" />
              </Field>
              <Field label="Chi nhánh" className="sm:col-span-3">
                <Input value={form.payeeBranch} onChange={(e) => set({ payeeBranch: e.target.value })} placeholder="VD: CN Bình Dương" />
              </Field>
              <Field label="Mã số thuế (nếu là đơn vị)" className="sm:col-span-2">
                <Input value={form.payeeTaxCode} onChange={(e) => set({ payeeTaxCode: e.target.value })} inputMode="numeric" />
              </Field>
              <Field label="Nội dung chuyển khoản" hint="Để trống: tự lấy số chứng từ + lý do, không dấu" className="sm:col-span-4">
                <Input value={form.transferNote} onChange={(e) => set({ transferNote: e.target.value })} maxLength={140} />
              </Field>
              <datalist id="voucher-banks">
                {['Vietcombank', 'VietinBank', 'BIDV', 'Agribank', 'Techcombank', 'MB Bank', 'ACB', 'VPBank', 'Sacombank', 'TPBank', 'SHB', 'HDBank', 'VIB', 'OCB', 'SeABank', 'MSB', 'Eximbank', 'LPBank', 'Nam A Bank', 'Bac A Bank'].map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
          <Field label="Kèm theo (số chứng từ gốc)" className={type === 'PT' || type === 'PC' ? 'sm:col-span-4' : 'sm:col-span-6'}>
            <Input value={form.attachedDocs} onChange={(e) => set({ attachedDocs: e.target.value })} placeholder="02 hóa đơn GTGT" />
          </Field>
          {(type === 'PT' || type === 'PC') && (
            <Field label="Quyển số" className="sm:col-span-2">
              <Input value={form.bookNo} onChange={(e) => set({ bookNo: e.target.value })} placeholder={company.bookNo} />
            </Field>
          )}
        </div>

        {/* ---------- ảnh chứng từ gốc ---------- */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p className="text-sm font-semibold text-ink-900 flex items-center gap-2">
              <Paperclip className="h-4 w-4 text-slate-500" /> Ảnh hóa đơn / chứng từ gốc
              <span className="font-normal text-xs text-slate-500">({form.attachments.length}/12)</span>
            </p>
            <div className="flex gap-2">
              <Button size="sm" icon={Camera} onClick={() => cameraInput.current?.click()} className="sm:hidden">
                Chụp ảnh
              </Button>
              <Button size="sm" icon={ImagePlus} onClick={() => fileInput.current?.click()}>
                Chọn ảnh / PDF
              </Button>
            </div>
            <input ref={fileInput} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
            <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
          </div>
          {form.attachments.length === 0 && !uploading ? (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="w-full rounded-xl border border-dashed border-slate-300 px-4 py-5 text-center text-xs text-slate-500 hover:border-slate-400 hover:bg-slate-50"
            >
              Ảnh được nén tự động trước khi lưu. Hỗ trợ JPG, PNG, HEIC và PDF dưới 700KB.
            </button>
          ) : (
            <ul className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {form.attachments.map((a) => (
                <li key={a.id} className="relative aspect-square rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
                  {String(a.type).startsWith('image/') && thumbs[a.id] ? (
                    <img src={thumbs[a.id]} alt={a.name} className="h-full w-full object-cover" />
                  ) : (
                    <span className="grid h-full w-full place-items-center p-1 text-center text-[10px] text-slate-500">
                      <FileText className="h-6 w-6 text-slate-400" />
                      <span className="line-clamp-2">{a.name}</span>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => dropAttachment(a)}
                    className="absolute top-1 right-1 grid h-6 w-6 place-items-center rounded-full bg-ink-950/70 text-white hover:bg-rose-600"
                    aria-label={`Bỏ ${a.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
              {uploading > 0 && (
                <li className="aspect-square rounded-lg border border-dashed border-slate-300 grid place-items-center">
                  <Spinner />
                </li>
              )}
            </ul>
          )}
        </div>

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        {!manager && <p className="text-xs text-slate-500">Sau khi gửi duyệt, Chủ doanh nghiệp / Đồng quản trị sẽ duyệt và cấp số chứng từ. Bạn xem được trạng thái trong danh sách “Chứng từ của tôi”.</p>}
      </div>
    </Modal>
  );
}

function SettlementNote({ s, account }) {
  if (!s) return null;
  let tone = 'bg-slate-50 border-slate-200 text-slate-700';
  let title = 'Thanh toán trực tiếp';
  let body = `Khi kết chuyển: lập Phiếu chi ${fmtVND(s.A)} (Nợ ${account} / Có 1111).`;
  if (s.B > 0 && s.refund > 0) {
    tone = 'bg-jade-50 border-jade-100 text-jade-800';
    title = `Số tạm ứng chi không hết: ${fmtVND(s.refund)}`;
    body = `Nợ ${account} / Có 141: ${fmtVND(s.cleared)}. Người đề nghị nộp lại quỹ ${fmtVND(s.refund)} — tự lập Phiếu thu (Nợ 1111 / Có 141).`;
  } else if (s.B > 0 && s.extra > 0) {
    tone = 'bg-vermilion-50 border-vermilion-100 text-vermilion-800';
    title = `Chi quá số tạm ứng: ${fmtVND(s.extra)}`;
    body = `Nợ ${account} / Có 141: ${fmtVND(s.cleared)}. Công ty chi bổ sung ${fmtVND(s.extra)} — tự lập Phiếu chi (Nợ ${account} / Có 1111).`;
  } else if (s.B > 0) {
    tone = 'bg-sapphire-50 border-sapphire-100 text-sapphire-800';
    title = 'Quyết toán vừa đủ tạm ứng';
    body = `Nợ ${account} / Có 141: ${fmtVND(s.cleared)}. Không phát sinh thu / chi tiền mặt.`;
  }
  return (
    <div className={cx('rounded-lg border px-3 py-2 text-xs leading-relaxed self-end', tone)}>
      <p className="font-semibold text-sm">{title}</p>
      <p>{body}</p>
    </div>
  );
}
