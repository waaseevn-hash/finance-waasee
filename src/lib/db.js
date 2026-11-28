/**
 * TẦNG DỮ LIỆU
 * ------------------------------------------------------------------
 * Mọi thao tác ghi dữ liệu tài chính đều đi qua AuditedBatch:
 *   - Mỗi lần thêm/sửa/xóa một bản ghi sẽ ghi KÈM một dòng nhật ký
 *     (audit_logs) trong CÙNG một lô ghi (atomic batch).
 *   - firestore.rules kiểm tra: bản ghi tài chính chỉ được ghi khi
 *     có dòng nhật ký tương ứng được tạo cùng lúc, đúng người, đúng
 *     hành động. => Không ai (kể cả gọi API trực tiếp) có thể sửa số
 *     liệu mà không để lại dấu vết. Nhật ký không thể sửa/xóa.
 */
import { collection, doc, increment, onSnapshot, query, runTransaction, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from './firebase.js';


export const C = {
  members: 'members',
  cash: 'cash_entries',
  banks: 'banks',
  loans: 'loans',
  ar: 'receivables',
  ap: 'payables',
  payments: 'payments',
  approvals: 'approvals',
  partners: 'partners',
  archive: 'audit_archive',
  plans: 'plans',
  snapshots: 'plan_snapshots',
  settings: 'settings',
  audit: 'audit_logs',
  vouchers: 'internal_vouchers',
  voucherFiles: 'voucher_files',
  batches: 'posting_batches',
  counters: 'counters',
};

export const COLLECTION_LABEL = {
  members: 'Thành viên',
  cash_entries: 'Sổ quỹ tiền mặt',
  banks: 'Ngân hàng',
  loans: 'Khế ước vay (KUNN)',
  receivables: 'Công nợ phải thu',
  payables: 'Công nợ phải trả',
  payments: 'Thanh toán công nợ',
  approvals: 'Duyệt chi nhà cung cấp',
  partners: 'Danh bạ nhà cung cấp',
  plans: 'Bản nháp kế hoạch tháng',
  plan_snapshots: 'Kế hoạch tháng đã chốt',
  internal_vouchers: 'Chứng từ thu chi nội bộ',
  posting_batches: 'Đợt chốt sổ chứng từ',
};


const META_KEYS = new Set(['id', 'balance', '_auditId', 'createdAt', 'updatedAt', 'updatedBy', 'createdBy', 'createdByName', 'lastAt']);

const isPlainObject = (v) => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

/** Bản sao "sạch" để lưu vào nhật ký (bỏ trường hệ thống, Timestamp, FieldValue) */
export function cleanForLog(obj) {
  if (!obj) return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (META_KEYS.has(k) || v === undefined) continue;
    if (v === null || typeof v !== 'object') out[k] = v;
    else if (Array.isArray(v)) out[k] = v.filter((x) => x === null || typeof x !== 'object' || isPlainObject(x));
    else if (isPlainObject(v)) out[k] = cleanForLog(v);
  }
  return out;
}

/** Danh sách trường thay đổi: [{ field, from, to }] */
export function diffForLog(before, after) {
  const a = cleanForLog(before) || {};
  const b = cleanForLog(after) || {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changes = [];
  for (const k of keys) {
    if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) {
      const simple = (v) => (v === undefined ? null : Array.isArray(v) || isPlainObject(v) ? JSON.stringify(v) : v);
      changes.push({ field: k, from: simple(a[k]), to: simple(b[k]) });
    }
  }
  return changes;
}

export class AuditedBatch {
  /** @param {{email: string, name?: string}} actor */
  constructor(actor) {
    if (!actor?.email) throw new Error('Chưa đăng nhập');
    this.batch = writeBatch(db);
    this.actor = actor;
  }

  _log(action, path, before, after, summary, auditRef) {
    this.batch.set(auditRef, {
      at: serverTimestamp(),
      actorEmail: this.actor.email,
      actorName: this.actor.name || this.actor.email,
      action,
      docPath: path,
      collection: path.split('/')[0],
      summary: summary || '',
      before: cleanForLog(before),
      after: cleanForLog(after),
      changes: action === 'UPDATE' ? diffForLog(before, after) : [],
    });
    return auditRef.id;
  }

  /** Thêm mới. Trả về id bản ghi. */
  create(coll, data, summary, { id, logData, times } = {}) {
    const ref = id ? doc(db, coll, id) : doc(collection(db, coll));
    const auditRef = doc(collection(db, C.audit));
    this.batch.set(ref, {
      ...data,
      createdBy: this.actor.email,
      createdByName: this.actor.name || this.actor.email,
      createdAt: times?.createdAt || serverTimestamp(),
      updatedBy: this.actor.email,
      updatedAt: times?.updatedAt || serverTimestamp(),
      _auditId: auditRef.id,
    });
    this._log('CREATE', `${coll}/${ref.id}`, null, logData ?? data, summary, auditRef);
    return ref.id;
  }

  /** Cập nhật một phần. `before` = dữ liệu hiện tại (để ghi giá trị cũ -> mới). */
  update(coll, id, patch, before, summary, { logAfter } = {}) {
    const auditRef = doc(collection(db, C.audit));
    this.batch.update(doc(db, coll, id), {
      ...patch,
      updatedBy: this.actor.email,
      updatedAt: serverTimestamp(),
      _auditId: auditRef.id,
    });
    this._log('UPDATE', `${coll}/${id}`, before, logAfter ?? { ...before, ...patch }, summary, auditRef);
  }

  /** Xóa. Mã nhật ký được tạo cố định từ phiên bản hiện tại (_auditId) để luật bảo mật đối chiếu. */
  remove(coll, id, before, summary) {
    const auditId = `DEL_${coll}_${id}_${before?._auditId || 'none'}`;
    this.batch.delete(doc(db, coll, id));
    this._log('DELETE', `${coll}/${id}`, before, null, summary, doc(db, C.audit, auditId));
  }

  commit() {
    return this.batch.commit();
  }
}

/**
 * Giao dịch có nhật ký gộp (dùng cho duyệt hàng loạt, kết chuyển, hủy kết chuyển).
 * Mọi tài liệu ghi trong giao dịch cùng trỏ tới MỘT dòng nhật ký hành động 'BATCH'
 * liệt kê toàn bộ đường dẫn (docPaths). Luật bảo mật chấp nhận ghi khi đường dẫn có trong danh sách.
 * Giao dịch Firestore: nếu một chứng từ đã bị người khác thay đổi giữa chừng, toàn bộ bị hủy và chạy lại.
 */
export class AuditedTx {
  constructor(tx, actor, { summary = '', logData = null, primaryPath = '' } = {}) {
    if (!actor?.email) throw new Error('Chưa đăng nhập');
    this.tx = tx;
    this.actor = actor;
    this.summary = summary;
    this.logData = logData;
    this.primaryPath = primaryPath;
    this.logRef = doc(collection(db, C.audit));
    this.paths = [];
    this.ops = [];
  }

  _meta() {
    return { updatedBy: this.actor.email, updatedAt: serverTimestamp(), _auditId: this.logRef.id };
  }

  create(coll, data, { id } = {}) {
    const ref = id ? doc(db, coll, id) : doc(collection(db, coll));
    this.tx.set(ref, {
      ...data,
      createdBy: this.actor.email,
      createdByName: this.actor.name || this.actor.email,
      createdAt: serverTimestamp(),
      ...this._meta(),
    });
    this.paths.push(`${coll}/${ref.id}`);
    this.ops.push({ op: 'CREATE', path: `${coll}/${ref.id}`, after: cleanForLog(data) });
    return ref.id;
  }

  update(coll, id, patch, before) {
    this.tx.update(doc(db, coll, id), { ...patch, ...this._meta() });
    this.paths.push(`${coll}/${id}`);
    this.ops.push({ op: 'UPDATE', path: `${coll}/${id}`, changes: diffForLog(before, { ...before, ...patch }) });
  }

  /** Cộng / trừ một trường số mà không cần đọc trước (vd số dư tiền gửi khi kế toán chốt sổ) */
  /** Cộng / trừ một trường số mà không cần đọc trước (người ghi không có quyền đọc tài liệu). extra: trường kèm theo */
  adjust(coll, id, field, delta, extra = {}) {
    this.tx.update(doc(db, coll, id), { [field]: increment(delta), ...extra, ...this._meta() });
    this.paths.push(`${coll}/${id}`);
    this.ops.push({ op: 'UPDATE', path: `${coll}/${id}`, changes: [{ field, from: null, to: `${delta >= 0 ? '+' : ''}${delta}` }] });
  }

  /** Ghi dòng nhật ký gộp — gọi cuối cùng trong hàm giao dịch */
  finish() {
    this.tx.set(this.logRef, {
      at: serverTimestamp(),
      actorEmail: this.actor.email,
      actorName: this.actor.name || this.actor.email,
      action: 'BATCH',
      docPath: this.primaryPath || this.paths[0] || '',
      docPaths: this.paths,
      collection: (this.primaryPath || this.paths[0] || '').split('/')[0],
      summary: this.summary,
      before: null,
      after: this.logData ? cleanForLog(this.logData) : null,
      changes: [],
      ops: this.ops.slice(0, 400),
    });
  }
}

/** Chạy một giao dịch có nhật ký gộp. fn(tx, audit) phải đọc trước rồi mới ghi. */
export function runAuditedTx(actor, meta, fn) {
  return runTransaction(db, async (tx) => {
    const audit = new AuditedTx(tx, actor, meta);
    const result = await fn(tx, audit);
    audit.finish();
    return result;
  });
}

/** Lắng nghe realtime theo điều kiện field == value */
export function subscribeWhere(coll, field, value, onData, onError) {
  return onSnapshot(
    query(collection(db, coll), where(field, '==', value)),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => onError?.(err),
  );
}

/** Lắng nghe realtime cả một bộ sưu tập */
export function subscribeCollection(coll, onData, onError) {
  return onSnapshot(
    collection(db, coll),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => onError?.(err),
  );
}

export function newId(coll = C.audit) {
  return doc(collection(db, coll)).id;
}

export function friendlyError(err) {
  const code = String(err?.code || '');
  if (code.includes('permission-denied'))
    return 'Không có quyền thực hiện thao tác này (hoặc dữ liệu không hợp lệ / quyền truy cập vừa bị thay đổi).';
  if (code.includes('unavailable') || code.includes('network-request-failed')) return 'Mất kết nối tới máy chủ. Kiểm tra mạng rồi thử lại.';
  if (code.includes('popup-closed-by-user') || code.includes('cancelled-popup-request')) return 'Bạn đã đóng cửa sổ đăng nhập Google.';
  if (code.includes('unauthorized-domain'))
    return 'Tên miền này chưa được cho phép. Vào Firebase > Authentication > Settings > Authorized domains để thêm.';
  if (code.includes('operation-not-allowed')) return 'Chưa bật đăng nhập Google trong Firebase > Authentication > Sign-in method.';
  if (code.includes('failed-precondition')) return 'Thao tác không hợp lệ ở trạng thái hiện tại. Tải lại trang rồi thử lại.';
  if (code.includes('resource-exhausted')) return 'Vượt hạn mức sử dụng miễn phí trong ngày của Firebase. Thử lại sau.';
  if (code === 'declined') return 'Bạn đã hủy tải file.';
  return err?.message || 'Đã có lỗi xảy ra. Vui lòng thử lại.';
}
