/**
 * CHỨNG TỪ THU CHI NỘI BỘ — nghiệp vụ (hàm thuần, không phụ thuộc Firebase, có kiểm thử)
 * ==========================================================================================
 * Chuẩn chứng từ: Thông tư 200/2014/TT-BTC.
 *
 * Loại chứng từ
 *   TU  Giấy đề nghị tạm ứng (mẫu 03-TT)              -> khi kết chuyển sinh Phiếu chi tạm ứng
 *   TT  Giấy đề nghị thanh toán / hoàn ứng (mẫu 05-TT) -> quyết toán tạm ứng, sinh Phiếu thu/Phiếu chi chênh lệch
 *   PT  Phiếu thu (mẫu 01-TT)
 *   PC  Phiếu chi (mẫu 02-TT)
 *
 * Định khoản khi kết chuyển (chỉ các dòng có TK 1111 mới đi vào Sổ tiền mặt trong két)
 *   TU số tiền X           : Nợ 141 / Có 1111  X        (Phiếu chi tạm ứng, ghi nhận nhân viên nợ tạm ứng X)
 *   TT tổng chi A, đã ứng B:
 *       - phần chi bằng tiền tạm ứng : Nợ TK chi phí / Có 141      min(A, B)   (không qua quỹ)
 *       - A < B  (chi không hết)     : Nợ 1111 / Có 141           B − A       (Phiếu thu hoàn ứng)
 *       - A > B  (chi quá tạm ứng)   : Nợ TK chi phí / Có 1111    A − B       (Phiếu chi bổ sung)
 *       - B = 0  (không tạm ứng)     : Nợ TK chi phí / Có 1111    A           (Phiếu chi thanh toán)
 *     Nếu liên kết với một Giấy tạm ứng đã kết chuyển: số đã quyết toán của giấy đó tăng thêm B.
 *   PT : Nợ 1111 / Có TK đối ứng (mặc định 141)
 *   PC : Nợ TK đối ứng (mặc định 642) / Có 1111
 *
 * Chống hạch toán trùng (idempotency)
 *   - Chỉ chứng từ ở trạng thái "Đã duyệt" mới kết chuyển được. Việc kết chuyển chạy trong một
 *     giao dịch Firestore: đọc lại trạng thái từng phiếu, nếu đã bị người khác kết chuyển thì hủy cả đợt.
 *   - Luật bảo mật chỉ cho đổi trạng thái APPROVED -> POSTED một lần; bút toán sổ quỹ có mã cố định
 *     theo phiếu (V_<mã phiếu>_<n>) nên chạy lại không thể sinh bút toán thứ hai.
 *   - Hủy kết chuyển (chỉ Chủ DN) không xóa gì: ghi bút toán đảo ngược, phiếu sinh tự động chuyển "Đã hủy",
 *     chứng từ gốc quay về "Đã duyệt (chờ kết xuất)" và giữ nguyên số phiếu.
 */

export const VTYPE = {
  TU: { code: 'TU', label: 'Giấy đề nghị tạm ứng', short: 'Đề nghị tạm ứng', form: 'Mẫu số 03 - TT', tone: 'amber' },
  TT: { code: 'TT', label: 'Giấy đề nghị thanh toán', short: 'Đề nghị thanh toán / hoàn ứng', form: 'Mẫu số 05 - TT', tone: 'orchid' },
  PT: { code: 'PT', label: 'Phiếu thu', short: 'Phiếu thu', form: 'Mẫu số 01 - TT', tone: 'green' },
  PC: { code: 'PC', label: 'Phiếu chi', short: 'Phiếu chi', form: 'Mẫu số 02 - TT', tone: 'orange' },
};

export const VSTATUS = {
  DRAFT: { label: 'Nháp', tone: 'slate' },
  PENDING: { label: 'Chờ duyệt', tone: 'amber' },
  APPROVED: { label: 'Đã duyệt · chờ kết xuất', tone: 'blue' },
  POSTED: { label: 'Đã kết chuyển', tone: 'green' },
  REJECTED: { label: 'Từ chối', tone: 'red' },
  CANCELLED: { label: 'Đã hủy', tone: 'slate' },
};

/** Danh mục tài khoản thường dùng (Thông tư 200) */
export const ACCOUNTS = [
  ['1111', 'Tiền mặt Việt Nam đồng'],
  ['1121', 'Tiền gửi ngân hàng VNĐ'],
  ['131', 'Phải thu của khách hàng'],
  ['138', 'Phải thu khác'],
  ['141', 'Tạm ứng'],
  ['152', 'Nguyên liệu, vật liệu'],
  ['153', 'Công cụ, dụng cụ'],
  ['156', 'Hàng hóa'],
  ['331', 'Phải trả cho người bán'],
  ['334', 'Phải trả người lao động'],
  ['3388', 'Phải trả, phải nộp khác'],
  ['511', 'Doanh thu bán hàng và cung cấp dịch vụ'],
  ['627', 'Chi phí sản xuất chung'],
  ['641', 'Chi phí bán hàng'],
  ['642', 'Chi phí quản lý doanh nghiệp'],
  ['711', 'Thu nhập khác'],
  ['811', 'Chi phí khác'],
  ['8111', 'Chi phí khác (chi tiết)'],
];
export const accountName = (code) => ACCOUNTS.find(([c]) => c === String(code))?.[1] || '';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round = (v) => Math.round(num(v));
const pad3 = (n) => String(n).padStart(3, '0');
const pad2 = (n) => String(n).padStart(2, '0');

/** Thành tiền từng dòng bảng kê và tổng cộng */
export function itemAmount(it) {
  return round(num(it?.qty) * num(it?.price));
}
export function itemsTotal(items) {
  return (items || []).reduce((s, it) => s + itemAmount(it), 0);
}

/** Số tiền chính của chứng từ (TT = Tổng cộng A) */
export function voucherAmount(v) {
  if (!v) return 0;
  return v.type === 'TT' ? itemsTotal(v.items) : round(v.amount);
}

/** Quyết toán GĐNTT: A tổng chi, B đã tạm ứng */
export function settlement(v) {
  const A = v?.type === 'TT' ? itemsTotal(v.items) : 0;
  const B = Math.max(0, round(v?.advanceAmount));
  return { A, B, cleared: Math.min(A, B), refund: Math.max(0, B - A), extra: Math.max(0, A - B) };
}

/** Ảnh hưởng tới quỹ tiền mặt khi kết chuyển: { in, out } */
export function cashEffect(v) {
  switch (v?.type) {
    case 'PT':
      return { in: round(v.amount), out: 0 };
    case 'PC':
    case 'TU':
      return { in: 0, out: round(v.amount) };
    case 'TT': {
      const s = settlement(v);
      return s.B > 0 ? { in: s.refund, out: s.extra } : { in: 0, out: s.A };
    }
    default:
      return { in: 0, out: 0 };
  }
}

/** Kiểm tra dữ liệu trước khi gửi duyệt. Trả về chuỗi lỗi hoặc '' */
export function validateVoucher(v, { advances = [] } = {}) {
  if (!VTYPE[v?.type]) return 'Loại chứng từ không hợp lệ';
  if (!String(v.person || '').trim()) return v.type === 'PT' ? 'Nhập họ tên người nộp tiền' : v.type === 'PC' ? 'Nhập họ tên người nhận tiền' : 'Nhập họ tên người đề nghị';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date || '')) return 'Chọn ngày lập chứng từ';
  if (!String(v.reason || '').trim()) return v.type === 'TT' ? 'Nhập diễn giải thanh toán' : v.type === 'TU' ? 'Nhập lý do tạm ứng' : v.type === 'PT' ? 'Nhập lý do thu' : 'Nhập lý do chi';
  if (v.type === 'TT') {
    const items = v.items || [];
    if (!items.length) return 'Thêm ít nhất một dòng chi phí vào bảng kê';
    for (const [i, it] of items.entries()) {
      if (!String(it.name || '').trim()) return `Dòng ${i + 1}: nhập tên chi phí`;
      if (num(it.qty) <= 0) return `Dòng ${i + 1}: số lượng phải lớn hơn 0`;
      if (num(it.price) < 0) return `Dòng ${i + 1}: đơn giá không được âm`;
    }
    if (itemsTotal(items) <= 0) return 'Tổng cộng phải lớn hơn 0';
    if (num(v.advanceAmount) < 0) return 'Số đã tạm ứng không được âm';
    if (!String(v.expenseAccount || '').trim()) return 'Chọn tài khoản chi phí (Nợ)';
    if (v.advanceId) {
      const adv = advances.find((a) => a.id === v.advanceId);
      if (adv && round(v.advanceAmount) > advanceRemaining(adv) + 0) return `Số đã tạm ứng vượt số còn phải quyết toán của ${adv.no || 'giấy tạm ứng'} (${advanceRemaining(adv).toLocaleString('vi-VN')} đ)`;
    }
  } else if (round(v.amount) <= 0) return 'Số tiền phải lớn hơn 0';
  if (v.type === 'PT' && !String(v.credit || '').trim()) return 'Chọn tài khoản ghi Có';
  if (v.type === 'PC' && !String(v.debit || '').trim()) return 'Chọn tài khoản ghi Nợ';
  return '';
}

/** Số tạm ứng còn phải quyết toán của một giấy tạm ứng đã kết chuyển */
export function advanceRemaining(tu) {
  if (!tu || tu.type !== 'TU' || tu.status !== 'POSTED') return 0;
  return Math.max(0, round(tu.amount) - round(tu.settledAmount));
}

/** Các giấy tạm ứng còn dư nợ, nhóm theo người */
export function openAdvances(vouchers) {
  return (vouchers || [])
    .filter((v) => v.type === 'TU' && v.status === 'POSTED' && advanceRemaining(v) > 0)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

const ymOf = (date) => String(date || '').slice(0, 7);
const compact = (date) => String(date || '').replace(/-/g, '');

/** Khóa bộ đếm số phiếu theo tháng của ngày chứng từ: PC-202611 */
export const counterKey = (prefix, date) => `${prefix}-${compact(ymOf(date))}`;
export const formatNo = (prefix, date, n) => `${prefix}-${compact(ymOf(date))}-${pad3(n)}`;
export const batchCounterKey = (date) => `KC-${compact(date)}`;
export const formatBatchCode = (date, n) => `KC-${compact(date)}-${pad2(n)}`;

/** Các bộ đếm cần đọc trước khi kết chuyển */
export function countersNeeded(vouchers, postDate) {
  const keys = new Set([batchCounterKey(postDate)]);
  for (const v of vouchers) {
    if (!v.no) keys.add(counterKey(v.type, v.date));
    if (v.type === 'TU') keys.add(counterKey('PC', postDate));
    if (v.type === 'TT') {
      const s = settlement(v);
      if (s.B === 0 || s.extra > 0) keys.add(counterKey('PC', postDate));
      if (s.refund > 0) keys.add(counterKey('PT', postDate));
    }
  }
  return [...keys];
}

/**
 * Lập kế hoạch ghi cho một đợt kết chuyển (hàm thuần).
 * @param vouchers   chứng từ đã duyệt (đã đọc lại trong giao dịch)
 * @param advances   { [id]: giấy tạm ứng } cho các GĐNTT có liên kết
 * @param counters   { [key]: số lớn nhất đã cấp } — đọc từ bộ đếm
 * @param postDate   ngày kết chuyển YYYY-MM-DD
 * @param newId      () => mã tài liệu mới
 * @returns { batch, voucherUpdates, generated, cashEntries, advanceUpdates, counters }
 */
export function buildPostingPlan({ vouchers, advances = {}, counters = {}, postDate, newId, batchId, actorEmail = '', bookNo = '' }) {
  const next = { ...counters };
  const take = (key) => {
    next[key] = (next[key] || 0) + 1;
    return next[key];
  };
  const order = [...vouchers].sort((a, b) => (a.date || '').localeCompare(b.date || '') || String(a.id).localeCompare(String(b.id)));
  const batchCode = formatBatchCode(postDate, take(batchCounterKey(postDate)));

  const voucherUpdates = [];
  const generated = [];
  const cashEntries = [];
  const advanceUpdates = {};
  const docs = []; // phục vụ in: các chứng từ theo thứ tự in

  // Mã bút toán cố định theo (chứng từ, đợt): chạy lại cùng đợt không thể sinh bút toán thứ hai;
  // chứng từ đã hủy kết chuyển rồi kết chuyển lại ở đợt mới sẽ có mã mới.
  const cashFor = (vId, seq, type, data) => {
    const cid = `V_${vId}_${batchId}_${seq}`;
    cashEntries.push({
      id: cid,
      data: {
        type,
        amount: data.amount,
        date: data.date,
        description: data.description.slice(0, 500),
        counterparty: String(data.counterparty || '').slice(0, 300),
        note: `Kết chuyển ${batchCode}`,
        voucherId: data.voucherId,
        voucherNo: data.voucherNo,
        sourceVoucherId: data.sourceVoucherId || data.voucherId,
        postingBatchId: batchId,
      },
    });
    return cid;
  };

  const makeGenerated = (src, type, amount, debit, credit, reason, attached) => {
    const id = newId();
    const no = formatNo(type, postDate, take(counterKey(type, postDate)));
    const g = {
      id,
      data: {
        type,
        auto: true,
        sourceId: src.id,
        sourceNo: src.no || '',
        status: 'POSTED',
        no,
        bookNo: src.bookNo || bookNo || '',
        date: postDate,
        person: src.person || '',
        position: src.position || '',
        address: src.address || src.position || '',
        reason,
        amount,
        debit,
        credit,
        attachedDocs: attached,
        entries: [{ debit, credit, amount }],
        postingBatchId: batchId,
        postedOn: postDate,
        postedBy: actorEmail,
        approvedBy: src.approvedBy || '',
        period: ymOf(postDate),
      },
    };
    generated.push(g);
    return g;
  };

  let receiptsCount = 0;
  let receiptsTotal = 0;
  let paymentsCount = 0;
  let paymentsTotal = 0;

  for (const v of order) {
    const no = v.no || formatNo(v.type, v.date, take(counterKey(v.type, v.date)));
    const patch = { status: 'POSTED', no, postingBatchId: batchId, postedOn: postDate, postedBy: actorEmail, period: ymOf(v.date) };
    const printSet = [];
    let seq = 1;
    const cashIds = [];
    const genIds = [];

    if (v.type === 'PT') {
      const amount = round(v.amount);
      patch.entries = [{ debit: '1111', credit: v.credit || '141', amount }];
      cashIds.push(cashFor(v.id, seq++, 'IN', { amount, date: v.date, description: `${no} — ${v.reason}`, counterparty: v.person, voucherId: v.id, voucherNo: no }));
      receiptsCount += 1;
      receiptsTotal += amount;
    } else if (v.type === 'PC') {
      const amount = round(v.amount);
      patch.entries = [{ debit: v.debit || '642', credit: '1111', amount }];
      cashIds.push(cashFor(v.id, seq++, 'OUT', { amount, date: v.date, description: `${no} — ${v.reason}`, counterparty: v.person, voucherId: v.id, voucherNo: no }));
      paymentsCount += 1;
      paymentsTotal += amount;
    } else if (v.type === 'TU') {
      const amount = round(v.amount);
      const g = makeGenerated({ ...v, no }, 'PC', amount, '141', '1111', `Chi tạm ứng: ${v.reason}`, `01 Giấy đề nghị tạm ứng số ${no}`);
      genIds.push(g.id);
      printSet.push({ id: g.id, ...g.data });
      patch.entries = [{ debit: '141', credit: '1111', amount }];
      patch.settledAmount = round(v.settledAmount);
      cashIds.push(cashFor(v.id, seq++, 'OUT', { amount, date: postDate, description: `${g.data.no} — Chi tạm ứng cho ${v.person}: ${v.reason}`, counterparty: v.person, voucherId: g.id, voucherNo: g.data.no, sourceVoucherId: v.id }));
      paymentsCount += 1;
      paymentsTotal += amount;
    } else if (v.type === 'TT') {
      const s = settlement(v);
      const exp = v.expenseAccount || '642';
      const entries = [];
      if (s.B > 0) {
        if (s.cleared > 0) entries.push({ debit: exp, credit: '141', amount: s.cleared });
        if (s.refund > 0) {
          const g = makeGenerated({ ...v, no }, 'PT', s.refund, '1111', '141', `Thu hoàn ứng chi không hết theo ${no}: ${v.reason}`, `01 Giấy đề nghị thanh toán số ${no}`);
          genIds.push(g.id);
          printSet.push({ id: g.id, ...g.data });
          entries.push({ debit: '1111', credit: '141', amount: s.refund });
          cashIds.push(cashFor(v.id, seq++, 'IN', { amount: s.refund, date: postDate, description: `${g.data.no} — Thu hoàn ứng của ${v.person}: ${v.reason}`, counterparty: v.person, voucherId: g.id, voucherNo: g.data.no, sourceVoucherId: v.id }));
          receiptsCount += 1;
          receiptsTotal += s.refund;
        }
        if (s.extra > 0) {
          const g = makeGenerated({ ...v, no }, 'PC', s.extra, exp, '1111', `Chi bổ sung phần chi quá tạm ứng theo ${no}: ${v.reason}`, `01 Giấy đề nghị thanh toán số ${no}`);
          genIds.push(g.id);
          printSet.push({ id: g.id, ...g.data });
          entries.push({ debit: exp, credit: '1111', amount: s.extra });
          cashIds.push(cashFor(v.id, seq++, 'OUT', { amount: s.extra, date: postDate, description: `${g.data.no} — Chi bổ sung cho ${v.person}: ${v.reason}`, counterparty: v.person, voucherId: g.id, voucherNo: g.data.no, sourceVoucherId: v.id }));
          paymentsCount += 1;
          paymentsTotal += s.extra;
        }
        if (v.advanceId) {
          const adv = advances[v.advanceId];
          if (!adv) throw new Error(`Không tìm thấy giấy tạm ứng liên kết với ${no}`);
          if (adv.status !== 'POSTED') throw new Error(`Giấy tạm ứng ${adv.no || ''} liên kết với ${no} chưa được kết chuyển`);
          const prev = advanceUpdates[v.advanceId]?.settledAmount ?? round(adv.settledAmount);
          if (prev + s.B > round(adv.amount)) throw new Error(`Số quyết toán vượt số tạm ứng còn lại của ${adv.no}`);
          advanceUpdates[v.advanceId] = { settledAmount: prev + s.B, before: adv };
        }
      } else {
        const g = makeGenerated({ ...v, no }, 'PC', s.A, exp, '1111', `Chi thanh toán theo ${no}: ${v.reason}`, `01 Giấy đề nghị thanh toán số ${no}`);
        genIds.push(g.id);
        printSet.push({ id: g.id, ...g.data });
        entries.push({ debit: exp, credit: '1111', amount: s.A });
        cashIds.push(cashFor(v.id, seq++, 'OUT', { amount: s.A, date: postDate, description: `${g.data.no} — Chi thanh toán cho ${v.person}: ${v.reason}`, counterparty: v.person, voucherId: g.id, voucherNo: g.data.no, sourceVoucherId: v.id }));
        paymentsCount += 1;
        paymentsTotal += s.A;
      }
      patch.entries = entries;
      patch.total = s.A;
    }
    patch.cashEntryIds = cashIds;
    patch.generatedIds = genIds;
    voucherUpdates.push({ id: v.id, patch, before: v });
    // chứng từ gốc (đủ số, định khoản) in trước, các phiếu sinh tự động in ngay sau
    docs.push({ ...v, ...patch }, ...printSet);
  }

  const batch = {
    code: batchCode,
    postDate,
    period: ymOf(postDate),
    voucherIds: order.map((v) => v.id),
    generatedIds: generated.map((g) => g.id),
    docNos: docs.map((d) => d.no),
    receiptsCount,
    receiptsTotal,
    paymentsCount,
    paymentsTotal,
    net: receiptsTotal - paymentsTotal,
    reversedIds: [],
    status: 'POSTED',
  };
  return { batch, batchCode, voucherUpdates, generated, cashEntries, advanceUpdates, counters: next, docs };
}

/**
 * Kế hoạch hủy kết chuyển một chứng từ (bút toán đảo ngược).
 * @param v        chứng từ đã kết chuyển
 * @param gens     các phiếu sinh tự động của chứng từ
 * @param cash     các bút toán sổ quỹ đã ghi
 * @param advance  giấy tạm ứng liên kết (nếu là GĐNTT)
 */
export function buildReversalPlan({ v, gens = [], cash = [], advance = null, reverseDate, reason, batchId }) {
  if (!v || v.status !== 'POSTED') throw new Error('Chứng từ chưa ở trạng thái đã kết chuyển');
  if (v.auto) throw new Error('Phiếu sinh tự động: hãy hủy kết chuyển chứng từ gốc');
  if (v.type === 'TU' && round(v.settledAmount) > 0)
    throw new Error('Giấy tạm ứng này đã được quyết toán một phần. Hủy kết chuyển các giấy thanh toán liên quan trước.');
  const reversals = cash.map((c, i) => ({
    id: `R_${c.id}`,
    data: {
      type: c.type === 'IN' ? 'OUT' : 'IN',
      amount: round(c.amount),
      date: reverseDate,
      description: `Đảo bút toán ${c.voucherNo || v.no}: ${reason || 'hủy kết chuyển'}`.slice(0, 500),
      counterparty: c.counterparty || '',
      note: `Hủy kết chuyển ${v.no}`,
      voucherId: c.voucherId,
      voucherNo: c.voucherNo || v.no,
      sourceVoucherId: v.id,
      reversalOf: c.id,
      postingBatchId: batchId || c.postingBatchId || '',
      seq: i + 1,
    },
  }));
  const s = settlement(v);
  const advanceUpdate =
    v.type === 'TT' && v.advanceId && advance && s.B > 0 ? { id: advance.id, settledAmount: Math.max(0, round(advance.settledAmount) - s.B), before: advance } : null;
  return {
    voucherPatch: {
      status: 'APPROVED',
      postingBatchId: '',
      postedOn: '',
      cashEntryIds: [],
      generatedIds: [],
      entries: [],
      reversedCount: round(v.reversedCount) + 1,
      lastReversal: { date: reverseDate, reason: reason || '', batchId: v.postingBatchId || '' },
    },
    cancelGenerated: gens.map((g) => ({ id: g.id, patch: { status: 'CANCELLED' }, before: g })),
    reversals,
    advanceUpdate,
  };
}

/** Khoản "Chi tiêu nội bộ" cho Bảng điều phối tháng */
export function internalForPlan(vouchers, month) {
  const end = `${month}-31`;
  const pending = (vouchers || []).filter((v) => v.status === 'APPROVED' && !v.auto && (v.date || '') <= end);
  const posted = (vouchers || []).filter((v) => v.status === 'POSTED' && !v.auto && (v.postedOn || v.date || '').slice(0, 7) === month);
  const pendingOut = pending.reduce((s, v) => s + cashEffect(v).out, 0);
  const pendingIn = pending.reduce((s, v) => s + cashEffect(v).in, 0);
  const postedOut = posted.reduce((s, v) => s + cashEffect(v).out, 0);
  const postedIn = posted.reduce((s, v) => s + cashEffect(v).in, 0);
  return { pending, posted, pendingOut, pendingIn, postedOut, postedIn };
}

/** Cấp số chứng từ khi duyệt (theo loại + tháng của ngày chứng từ) */
export function buildApprovalNumbers({ vouchers, counters = {} }) {
  const next = { ...counters };
  const order = [...vouchers].sort((a, b) => (a.date || '').localeCompare(b.date || '') || String(a.id).localeCompare(String(b.id)));
  const numbers = {};
  for (const v of order) {
    if (v.no) {
      numbers[v.id] = v.no;
      continue;
    }
    const key = counterKey(v.type, v.date);
    next[key] = (next[key] || 0) + 1;
    numbers[v.id] = formatNo(v.type, v.date, next[key]);
  }
  return { numbers, counters: next };
}

/**
 * Dòng bảng kê của một đợt: mỗi bút toán chỉ xuất hiện MỘT lần.
 * Bút toán tiền mặt của GĐNTU / GĐNTT được thể hiện trên phiếu thu / phiếu chi sinh tự động,
 * nên trên dòng giấy đề nghị chỉ còn bút toán không qua quỹ (vd Nợ 642 / Có 141).
 */
export function ledgerLines(docs) {
  const lines = [];
  for (const d of docs) {
    let entries = d.entries?.length ? d.entries : [{ debit: d.debit || '', credit: d.credit || '', amount: voucherAmount(d) }];
    if (!d.auto && (d.type === 'TU' || d.type === 'TT') && (d.generatedIds || []).length) {
      entries = entries.filter((e) => e.debit !== '1111' && e.credit !== '1111');
    }
    if (!entries.length) lines.push({ doc: d, debit: '', credit: '', amount: null, info: true });
    for (const e of entries) lines.push({ doc: d, debit: String(e.debit || ''), credit: String(e.credit || ''), amount: Math.round(Number(e.amount) || 0), info: false });
  }
  return lines;
}
