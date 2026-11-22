/**
 * LOGIC TÀI CHÍNH THUẦN (không phụ thuộc Firebase / React)
 * Mọi con số trên Dashboard, Sổ quỹ, Ngân hàng, Công nợ và Bảng điều phối
 * đều được tính ở đây để dễ kiểm thử (xem tests/calc.test.js).
 */
import { addDays, daysBetween, monthLabel, monthRange, todayISO } from './dates.js';

export const PRIORITY_RANK = { P1: 1, P2: 2, P3: 3 };

const num = (v) => Number(v) || 0;

/* ------------------------------------------------------------------ */
/*  Tiện ích chung                                                     */
/* ------------------------------------------------------------------ */

export function tsMillis(ts) {
  if (!ts) return Number.MAX_SAFE_INTEGER; // bản ghi đang chờ lưu -> xếp cuối
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  if (ts instanceof Date) return ts.getTime();
  return Number(ts) || 0;
}

/** Số còn phải thu / phải trả của một khoản công nợ */
export function remaining(r) {
  return Math.max(0, num(r.total) - num(r.paid));
}

/* ------------------------------------------------------------------ */
/*  Tiền mặt trong két                                                 */
/* ------------------------------------------------------------------ */

const signed = (e) => (e.type === 'IN' ? 1 : -1) * num(e.amount);

export function cashBalance(entries = []) {
  return entries.reduce((s, e) => s + signed(e), 0);
}

/** Sắp xếp sổ quỹ theo thời gian và tính tồn quỹ lũy kế sau từng phiếu */
export function cashLedger(entries = []) {
  const sorted = [...entries].sort(
    (a, b) =>
      (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
      tsMillis(a.createdAt) - tsMillis(b.createdAt) ||
      String(a.id).localeCompare(String(b.id)),
  );
  let run = 0;
  return sorted.map((e) => {
    run += signed(e);
    return { ...e, balance: run };
  });
}

export function cashMonthStats(entries = [], ym) {
  const { start, end } = monthRange(ym);
  let opening = 0;
  let inSum = 0;
  let outSum = 0;
  for (const e of entries) {
    if (e.date < start) opening += signed(e);
    else if (e.date <= end) {
      if (e.type === 'IN') inSum += num(e.amount);
      else outSum += num(e.amount);
    }
  }
  return { opening, inSum, outSum, closing: opening + inSum - outSum };
}

/* ------------------------------------------------------------------ */
/*  Ngân hàng & hạn mức tín dụng                                       */
/* ------------------------------------------------------------------ */

export function loanOutstanding(l) {
  return l.status === 'ACTIVE' ? num(l.amount) : 0;
}

/**
 * Lãi ước tính phát sinh trong tháng của một KUNN:
 *   dư nợ × lãi suất năm × số ngày tính lãi / 365
 * Số ngày tính lãi = số ngày trong tháng mà khoản vay còn dư nợ
 * (từ ngày giải ngân, trước ngày đáo hạn; KUNN quá hạn vẫn tính đủ tháng).
 */
export function loanInterestForMonth(l, ym) {
  if (l.status !== 'ACTIVE') return 0;
  const { start, end } = monthRange(ym);
  const afterEnd = addDays(end, 1);
  const from = l.disbursedDate && l.disbursedDate > start ? l.disbursedDate : start;
  if (from > end) return 0;
  const to = l.maturityDate && l.maturityDate > start && l.maturityDate < afterEnd ? l.maturityDate : afterEnd;
  const days = Math.max(0, daysBetween(from, to));
  return (num(l.amount) * num(l.interestRate)) / 100 * (days / 365);
}

export function bankSummary(banks = [], loans = [], today = todayISO()) {
  const rows = banks.map((b) => {
    const bl = loans.filter((l) => l.bankId === b.id);
    const outstanding = bl.reduce((s, l) => s + loanOutstanding(l), 0);
    const limit = num(b.creditLimit);
    const available = Math.max(0, limit - outstanding);
    const usedPct = limit > 0 ? Math.min(100, (outstanding / limit) * 100) : outstanding > 0 ? 100 : 0;
    return {
      ...b,
      limit,
      outstanding,
      available,
      usedPct,
      deposit: num(b.depositBalance),
      activeLoans: bl.filter((l) => l.status === 'ACTIVE').length,
    };
  });
  const totals = rows.reduce(
    (t, r) => ({
      limit: t.limit + r.limit,
      outstanding: t.outstanding + r.outstanding,
      available: t.available + r.available,
      deposit: t.deposit + r.deposit,
    }),
    { limit: 0, outstanding: 0, available: 0, deposit: 0 },
  );
  // KUNN không gắn với ngân hàng nào (dữ liệu lệch) vẫn phải tính vào dư nợ
  const ids = new Set(banks.map((b) => b.id));
  totals.outstanding += loans.filter((l) => !ids.has(l.bankId)).reduce((s, l) => s + loanOutstanding(l), 0);
  totals.usedPct = totals.limit > 0 ? Math.min(100, (totals.outstanding / totals.limit) * 100) : 0;
  return { rows, totals };
}

/* ------------------------------------------------------------------ */
/*  Công nợ phải thu / phải trả                                        */
/* ------------------------------------------------------------------ */

export function arSummary(ar = [], today = todayISO()) {
  const aging = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0 };
  let total = 0;
  let inTerm = 0;
  let overdue = 0;
  let doubtful = 0;
  let count = 0;
  for (const r of ar) {
    const rem = remaining(r);
    if (rem <= 0) continue;
    count += 1;
    total += rem;
    if (r.certainty === 'DOUBTFUL') doubtful += rem;
    const late = r.dueDate ? daysBetween(r.dueDate, today) : 0; // > 0 là quá hạn
    if (late > 0) {
      overdue += rem;
      if (late <= 30) aging.d1_30 += rem;
      else if (late <= 60) aging.d31_60 += rem;
      else if (late <= 90) aging.d61_90 += rem;
      else aging.d90 += rem;
    } else {
      inTerm += rem;
      aging.current += rem;
    }
  }
  return { total, inTerm, overdue, doubtful, count, aging };
}

export function apSummary(ap = [], today = todayISO()) {
  const { end } = monthRange(today.slice(0, 7));
  let total = 0;
  let dueThisMonth = 0;
  let overdue = 0;
  let p1Due = 0;
  let count = 0;
  for (const r of ap) {
    const rem = remaining(r);
    if (rem <= 0) continue;
    count += 1;
    total += rem;
    if (r.dueDate && r.dueDate <= end) {
      dueThisMonth += rem;
      if (r.dueDate < today) overdue += rem;
      if ((r.priority || 'P2') === 'P1') p1Due += rem;
    }
  }
  return { total, dueThisMonth, overdue, p1Due, count };
}

/* ------------------------------------------------------------------ */
/*  Radar cảnh báo hành động                                           */
/* ------------------------------------------------------------------ */

export function buildRadar({ loans = [], banks = [], ar = [], ap = [], today = todayISO(), includeTreasury = true }) {
  const alerts = [];
  const bankName = (id) => banks.find((b) => b.id === id)?.name || 'Ngân hàng';

  if (includeTreasury) {
    for (const l of loans) {
      if (l.status !== 'ACTIVE' || !l.maturityDate) continue;
      const d = daysBetween(today, l.maturityDate);
      if (d > 30) continue;
      alerts.push({
        id: `loan-${l.id}`,
        level: d <= 15 ? 'red' : 'yellow',
        kind: 'LOAN',
        title:
          d < 0
            ? `KUNN ${l.contractNo || ''} đã quá hạn ${-d} ngày`
            : `KUNN ${l.contractNo || ''} đáo hạn ${d === 0 ? 'hôm nay' : `sau ${d} ngày`}`,
        sub: bankName(l.bankId),
        amount: num(l.amount),
        date: l.maturityDate,
        sortKey: d,
        route: 'bank',
      });
    }
  }

  for (const r of ar) {
    const rem = remaining(r);
    if (rem <= 0 || !r.dueDate || r.dueDate >= today) continue;
    const late = daysBetween(r.dueDate, today);
    alerts.push({
      id: `ar-${r.id}`,
      level: late > 30 || r.certainty === 'DOUBTFUL' ? 'red' : 'yellow',
      kind: 'AR',
      title: `Phải thu quá hạn ${late} ngày: ${r.partnerName}`,
      sub: r.description || 'Công nợ phải thu',
      amount: rem,
      date: r.dueDate,
      sortKey: -late,
      route: 'partners?tab=ar',
    });
  }

  for (const r of ap) {
    const rem = remaining(r);
    if (rem <= 0 || !r.dueDate || (r.priority || 'P2') !== 'P1') continue;
    const d = daysBetween(today, r.dueDate);
    if (d > 15) continue;
    alerts.push({
      id: `ap-${r.id}`,
      level: d <= 7 ? 'red' : 'yellow',
      kind: 'AP',
      title:
        d < 0
          ? `Phải trả P1 quá hạn ${-d} ngày: ${r.partnerName}`
          : `Phải trả P1 ${d === 0 ? 'đến hạn hôm nay' : `đến hạn sau ${d} ngày`}: ${r.partnerName}`,
      sub: r.description || 'Công nợ phải trả',
      amount: rem,
      date: r.dueDate,
      sortKey: d,
      route: 'partners?tab=ap',
    });
  }

  return alerts.sort((a, b) => (a.level === b.level ? a.sortKey - b.sortKey : a.level === 'red' ? -1 : 1));
}

/* ------------------------------------------------------------------ */
/*  Bảng điều phối tài chính tháng                                     */
/* ------------------------------------------------------------------ */

/** Các khoản phải thu có thể về trong tháng (đến hạn ≤ cuối tháng, kể cả quá hạn) */
export function planReceivables({ ar = [], month, extraAr = [], state = {} }) {
  const { end } = monthRange(month);
  return ar
    .filter((r) => remaining(r) > 0 && ((r.dueDate && r.dueDate <= end) || extraAr.includes(r.id)))
    .map((r) => {
      const st = state[r.id] || {};
      const outstanding = remaining(r);
      return {
        key: r.id,
        refId: r.id,
        partner: r.partnerName,
        label: r.description || '',
        dueDate: r.dueDate || null,
        certainty: r.certainty || 'SURE',
        outstanding,
        selected: st.sel ?? (r.certainty || 'SURE') === 'SURE',
        amount: st.amount ?? outstanding,
        extra: !(r.dueDate && r.dueDate <= end),
      };
    })
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
}

/** Tập ứng viên chi trả của tháng: công nợ phải trả, đáo hạn KUNN, lãi vay, khoản chi cố định */
/** Lệnh duyệt chi còn mở (chưa chuyển tiền) theo từng khoản phải trả */
export function openApprovalsByPayable(approvals = []) {
  const m = new Map();
  for (const a of approvals) if (a && a.status === 'OPEN' && a.payableId) m.set(a.payableId, a);
  return m;
}

/** Số tiền của lệnh duyệt chi: "Chi hết" = luôn bằng số còn nợ hiện tại; "Chi 1 phần" = số đã duyệt (không vượt số còn nợ) */
export function approvalAmount(a, outstanding) {
  if (!a) return 0;
  return a.mode === 'FULL' ? Math.max(0, num(outstanding)) : Math.max(0, Math.min(num(a.amount), num(outstanding)));
}

/** Nhóm của một khoản chi trong bảng tổng hợp */
export const PAY_GROUP = { AP: 'SUPPLIER', CUSTOM: 'FIXED', LOAN: 'BANK', INTEREST: 'BANK' };

export function planCandidates({ ap = [], loans = [], banks = [], month, extraAp = [], custom = [], approvals = [] }) {
  const { end } = monthRange(month);
  const bankName = (id) => banks.find((b) => b.id === id)?.name || 'Ngân hàng';
  const items = [];
  const approved = openApprovalsByPayable(approvals);

  for (const r of ap) {
    const rem = remaining(r);
    if (rem <= 0) continue;
    const due = !!r.dueDate && r.dueDate <= end;
    const a = approved.get(r.id) || null;
    // Khoản đã được duyệt chi luôn có mặt trong kế hoạch, kể cả khi chưa đến hạn
    if (!due && !a && !extraAp.includes(r.id)) continue;
    items.push({
      key: `ap_${r.id}`,
      kind: 'AP',
      refId: r.id,
      label: r.description || 'Công nợ phải trả',
      partner: r.partnerName,
      dueDate: r.dueDate || null,
      outstanding: rem,
      defaultPriority: r.priority || 'P2',
      category: 'Công nợ NCC',
      supplierId: r.supplierId || null,
      extra: !due && !a,
      approval: a
        ? { id: a.id, mode: a.mode === 'PART' ? 'PART' : 'FULL', amount: approvalAmount(a, rem), approvedOn: a.approvedOn || null, note: a.note || '', createdBy: a.createdBy || null }
        : null,
    });
  }

  const interestByBank = new Map();
  for (const l of loans) {
    if (l.status !== 'ACTIVE') continue;
    if (l.maturityDate && l.maturityDate <= end) {
      items.push({
        key: `lm_${l.id}`,
        kind: 'LOAN',
        refId: l.id,
        label: `Đáo hạn KUNN ${l.contractNo || ''}`.trim(),
        partner: bankName(l.bankId),
        dueDate: l.maturityDate,
        outstanding: num(l.amount),
        defaultPriority: 'P1',
        category: 'Đáo hạn NH',
      });
    }
    const it = loanInterestForMonth(l, month);
    if (it > 0) interestByBank.set(l.bankId, (interestByBank.get(l.bankId) || 0) + it);
  }
  for (const [bankId, amount] of interestByBank) {
    items.push({
      key: `li_${bankId}`,
      kind: 'INTEREST',
      refId: bankId,
      label: `Lãi vay ước tính ${monthLabel(month).toLowerCase()}`,
      partner: bankName(bankId),
      dueDate: null,
      outstanding: Math.round(amount),
      defaultPriority: 'P1',
      category: 'Lãi vay',
    });
  }

  for (const c of custom) {
    items.push({
      key: c.key,
      kind: 'CUSTOM',
      refId: null,
      label: c.label,
      partner: 'Chi cố định hàng tháng',
      dueDate: c.dueDate || null,
      outstanding: num(c.amount),
      defaultPriority: c.priority || 'P1',
      category: c.category || 'Khác',
    });
  }
  return items;
}

export function byPriorityThenDue(a, b) {
  return (
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99') ||
    b.outstanding - a.outstanding
  );
}

/**
 * Gộp ứng viên với lựa chọn đã lưu (tick, số tiền, mức ưu tiên, thứ tự kéo-thả).
 * Khoản mới xuất hiện được chèn vào cuối nhóm cùng mức ưu tiên.
 */
export function mergePlanRows(candidates = [], { items = {}, order = [] } = {}) {
  const rows = candidates.map((c) => {
    const st = items[c.key] || {};
    const priority = st.priority || c.defaultPriority;
    if (c.approval) {
      // Đã duyệt chi: số tiền và hình thức theo lệnh duyệt, luôn được tính vào kế hoạch
      return {
        ...c,
        priority,
        mode: c.approval.mode,
        selected: true,
        amount: c.approval.amount,
        remainingAfter: Math.max(0, c.outstanding - c.approval.amount),
        edited: c.approval.mode === 'PART',
        locked: true,
      };
    }
    // Trả toàn bộ (FULL) = luôn bằng số còn nợ hiện tại; Trả 1 phần (PART) = số tiền tự nhập
    const mode = st.mode || (st.amount != null && st.amount !== c.outstanding ? 'PART' : 'FULL');
    const amount = mode === 'FULL' ? c.outstanding : st.amount ?? c.outstanding;
    return {
      ...c,
      priority,
      mode,
      selected: st.sel ?? priority !== 'P3',
      amount,
      remainingAfter: Math.max(0, c.outstanding - amount),
      edited: mode === 'PART',
    };
  });
  const idx = new Map(order.map((k, i) => [k, i]));
  const result = rows.filter((r) => idx.has(r.key)).sort((a, b) => idx.get(a.key) - idx.get(b.key));
  const fresh = rows.filter((r) => !idx.has(r.key)).sort(byPriorityThenDue);
  for (const f of fresh) {
    let at = 0;
    for (let i = 0; i < result.length; i += 1) {
      if (PRIORITY_RANK[result[i].priority] <= PRIORITY_RANK[f.priority]) at = i + 1;
    }
    result.splice(at, 0, f);
  }
  return result;
}

/** Chia số tiền cần giải ngân cho các ngân hàng còn hạn mức (ngân hàng còn nhiều hạn mức nhất trước) */
export function allocateDraw(amount, creditBanks = []) {
  let left = Math.max(0, num(amount));
  const out = [];
  const list = creditBanks
    .map((b) => ({ id: b.id, name: b.name || 'Ngân hàng', available: num(b.available) }))
    .filter((b) => b.available > 0)
    .sort((x, y) => y.available - x.available);
  for (const b of list) {
    if (left <= 0) break;
    const take = Math.min(left, b.available);
    out.push({ bankId: b.id, name: b.name, available: b.available, amount: take });
    left -= take;
  }
  return out;
}

/**
 * Cân đối tháng:
 *   Tổng có       = tiền mặt có thể dùng (tồn két − dự phòng) + tiền gửi tài khoản
 *   Nguồn cơ sở   = Tổng có + phải thu chắc chắn về (các khoản đã chọn)
 *   Thiếu         = Tổng phải chi − Nguồn cơ sở  → phần thiếu lấy từ giải ngân hạn mức vay
 * Số dư lũy kế chạy theo thứ tự ưu tiên, âm ở khoản nào = từ khoản đó phải dùng tiền giải ngân.
 */
export function computePlan({
  cashBalance: cash = 0,
  reserve = 0,
  deposits = 0,
  includeDeposits = true,
  arRows = [],
  creditAvailable = 0,
  creditBanks = [],
  rows = [],
}) {
  const cashUsable = num(cash) - num(reserve);
  const depositUsable = includeDeposits ? num(deposits) : 0;
  const haveTotal = cashUsable + depositUsable;
  const arIn = arRows.filter((r) => r.selected).reduce((s, r) => s + num(r.amount), 0);
  const baseSources = haveTotal + arIn;

  const byPriority = { P1: 0, P2: 0, P3: 0 };
  const groups = { SUPPLIER: 0, FIXED: 0, BANK: 0 };
  const groupCount = { SUPPLIER: 0, FIXED: 0, BANK: 0 };
  let payTotal = 0;
  let running = baseSources;
  const outRows = rows.map((r) => {
    if (r.selected) {
      const amt = num(r.amount);
      running -= amt;
      payTotal += amt;
      byPriority[r.priority] = (byPriority[r.priority] || 0) + amt;
      const g = PAY_GROUP[r.kind] || 'FIXED';
      groups[g] += amt;
      groupCount[g] += 1;
    }
    return { ...r, runningAfter: running, overflow: !!r.selected && running < 0 };
  });

  const balance = baseSources - payTotal; // âm = thiếu
  const shortfall = Math.max(0, -balance);
  const suggestedDraw = Math.min(shortfall, num(creditAvailable));
  const uncovered = Math.max(0, shortfall - num(creditAvailable));
  const drawPlan = allocateDraw(suggestedDraw, creditBanks);

  return {
    cashBalance: num(cash),
    reserve: num(reserve),
    cashUsable,
    depositUsable,
    haveTotal,
    arIn,
    baseSources,
    sources: baseSources,
    creditAvailable: num(creditAvailable),
    creditUsed: suggestedDraw,
    payTotal,
    byPriority,
    groups,
    groupCount,
    balance,
    shortfall,
    needCredit: shortfall,
    suggestedDraw,
    uncovered,
    drawPlan,
    balanceAfterDraw: balance + suggestedDraw,
    p1Covered: baseSources + num(creditAvailable) >= byPriority.P1,
    p1CoveredBase: baseSources >= byPriority.P1,
    selectedCount: outRows.filter((r) => r.selected).length,
    rows: outRows,
  };
}

/* ------------------------------------------------------------------ */
/*  Đối chiếu Kế hoạch vs Thực tế (variance analysis)                  */
/* ------------------------------------------------------------------ */

const MATERIAL_PCT = 10; // chênh lệch ≥ 10% được đánh dấu trọng yếu

function varianceRow(base) {
  const variance = base.actual - base.planned;
  const pct = base.planned ? (variance / base.planned) * 100 : null;
  return { ...base, variance, pct, material: pct == null ? base.actual > 0 : Math.abs(pct) >= MATERIAL_PCT };
}

/**
 * So sánh bản kế hoạch đã chốt với các lần thu/chi thực tế được ghi nhận
 * (bộ sưu tập payments) từ ngày chốt (hoặc đầu tháng nếu chốt trước) đến cuối tháng.
 * Các lần thanh toán trước ngày chốt đã nằm trong "số còn nợ" lúc lập kế hoạch nên không tính lại.
 */
export function varianceWindow(snapshot) {
  const { start, end } = monthRange(snapshot.month);
  const from = snapshot.lockedOn && snapshot.lockedOn > start ? snapshot.lockedOn : start;
  return { from, end };
}

export function computeVariance(snapshot, payments = []) {
  const { from, end } = varianceWindow(snapshot);
  const inMonth = payments.filter((p) => p.date >= from && p.date <= end);
  const sumBy = (kind) => {
    const m = new Map();
    for (const p of inMonth) if (p.kind === kind) m.set(p.parentId, (m.get(p.parentId) || 0) + num(p.amount));
    return m;
  };
  const arAct = sumBy('AR');
  const apAct = sumBy('AP');

  const plannedAr = (snapshot.arRows || []).filter((r) => r.selected);
  const plannedAp = (snapshot.rows || []).filter((r) => r.selected && r.kind === 'AP');
  const untracked = (snapshot.rows || []).filter((r) => r.selected && r.kind !== 'AP');

  const inRows = plannedAr.map((r) =>
    varianceRow({ key: r.key, partner: r.partner, label: r.label, planned: num(r.amount), actual: arAct.get(r.refId) || 0 }),
  );
  const outRows = plannedAp.map((r) =>
    varianceRow({ key: r.key, partner: r.partner, label: r.label, planned: num(r.amount), actual: apAct.get(r.refId) || 0 }),
  );

  const arIds = new Set(plannedAr.map((r) => r.refId));
  const apIds = new Set(plannedAp.map((r) => r.refId));
  const groupUnplanned = (kind, ids) => {
    const m = new Map();
    for (const p of inMonth) {
      if (p.kind !== kind || ids.has(p.parentId)) continue;
      const cur = m.get(p.parentId) || { key: p.parentId, partner: p.partnerName || '—', label: p.description || '', actual: 0 };
      cur.actual += num(p.amount);
      m.set(p.parentId, cur);
    }
    return [...m.values()];
  };
  const unplannedIn = groupUnplanned('AR', arIds);
  const unplannedOut = groupUnplanned('AP', apIds);

  const sum = (rows, k) => rows.reduce((s, r) => s + num(r[k]), 0);
  const totals = {
    plannedIn: sum(inRows, 'planned'),
    actualIn: sum(inRows, 'actual'),
    unplannedIn: sum(unplannedIn, 'actual'),
    plannedOut: sum(outRows, 'planned'),
    actualOut: sum(outRows, 'actual'),
    unplannedOut: sum(unplannedOut, 'actual'),
    untrackedOut: sum(untracked, 'amount'),
  };
  totals.inRate = totals.plannedIn ? (totals.actualIn / totals.plannedIn) * 100 : null;
  totals.outRate = totals.plannedOut ? (totals.actualOut / totals.plannedOut) * 100 : null;

  return { inRows, outRows, unplannedIn, unplannedOut, untracked, totals };
}
