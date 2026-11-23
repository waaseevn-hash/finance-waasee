// Kiểm thử logic tài chính:  npm test   (hoặc: node --test tests/)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  apSummary,
  arSummary,
  bankSummary,
  buildRadar,
  cashBalance,
  cashLedger,
  cashMonthStats,
  approvalAmount,
  computePlan,
  computeVariance,
  loanInterestForMonth,
  mergePlanRows,
  planCandidates,
  planReceivables,
} from '../src/lib/calc.js';
import { daysBetween, monthRange, shiftMonth, addDays } from '../src/lib/dates.js';
import { parseMoney, fmtNum, fmtCompact, matchSearch } from '../src/lib/format.js';

test('ngày tháng', () => {
  assert.equal(daysBetween('2026-11-21', '2026-12-06'), 15);
  assert.equal(daysBetween('2026-11-21', '2026-11-01'), -20);
  assert.deepEqual(monthRange('2026-02'), { start: '2026-02-01', end: '2026-02-28', days: 28 });
  assert.equal(monthRange('2028-02').end, '2028-02-29');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
});

test('đọc số tiền người dùng nhập', () => {
  assert.equal(parseMoney('1.250.000'), 1250000);
  assert.equal(parseMoney('150tr'), 150000000);
  assert.equal(parseMoney('1,5 tỷ'), 1500000000);
  assert.equal(parseMoney('1.5 tỷ'), 1500000000);
  assert.equal(parseMoney('500k'), 500000);
  assert.equal(parseMoney('2 triệu'), 2000000);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('abc'), null);
  assert.equal(fmtNum(1250000), '1.250.000');
  assert.equal(fmtCompact(1250000000), '1,25 tỷ');
  assert.ok(matchSearch('Công ty Đông Á', 'dong a'));
});

test('sổ quỹ tiền mặt: tồn quỹ & lũy kế', () => {
  const entries = [
    { id: 'b', date: '2026-11-05', type: 'OUT', amount: 30 },
    { id: 'a', date: '2026-10-31', type: 'IN', amount: 100 },
    { id: 'c', date: '2026-11-10', type: 'IN', amount: 50 },
  ];
  assert.equal(cashBalance(entries), 120);
  const led = cashLedger(entries);
  assert.deepEqual(led.map((e) => [e.id, e.balance]), [['a', 100], ['b', 70], ['c', 120]]);
  assert.deepEqual(cashMonthStats(entries, '2026-11'), { opening: 100, inSum: 50, outSum: 30, closing: 120 });
});

test('ngân hàng: dư nợ, hạn mức còn được vay', () => {
  const banks = [
    { id: 'v', name: 'VCB', creditLimit: 1000, limitExpiry: '2027-06-30', depositBalance: 40 },
    { id: 'b', name: 'BIDV', creditLimit: 500 },
  ];
  const loans = [
    { id: 'l1', bankId: 'v', amount: 300, status: 'ACTIVE' },
    { id: 'l2', bankId: 'v', amount: 200, status: 'SETTLED' },
    { id: 'l3', bankId: 'b', amount: 100, status: 'ACTIVE' },
  ];
  const { rows, totals } = bankSummary(banks, loans, '2026-11-21');
  assert.equal(rows[0].outstanding, 300);
  assert.equal(rows[0].available, 700);
  assert.equal(rows[1].available, 400);
  assert.equal(totals.outstanding, 400);
  assert.equal(totals.available, 1100);
  assert.equal(totals.deposit, 40);
});

test('lãi vay ước tính theo ngày thực tế', () => {
  const full = { amount: 365_000_000, interestRate: 10, status: 'ACTIVE', disbursedDate: '2026-01-01', maturityDate: '2027-01-01' };
  assert.equal(Math.round(loanInterestForMonth(full, '2026-11')), 3_000_000); // 30 ngày
  const ending = { ...full, maturityDate: '2026-11-11' }; // còn dư nợ 1..10/11
  assert.equal(Math.round(loanInterestForMonth(ending, '2026-11')), 1_000_000);
  const starting = { ...full, disbursedDate: '2026-11-21' }; // 21..30/11 = 10 ngày
  assert.equal(Math.round(loanInterestForMonth(starting, '2026-11')), 1_000_000);
  assert.equal(loanInterestForMonth({ ...full, status: 'SETTLED' }, '2026-11'), 0);
});

test('công nợ phải thu / phải trả', () => {
  const ar = [
    { id: '1', total: 100, paid: 20, dueDate: '2026-12-01' },
    { id: '2', total: 50, paid: 0, dueDate: '2026-10-01', certainty: 'DOUBTFUL' },
    { id: '3', total: 10, paid: 10, dueDate: '2026-09-01' },
  ];
  const s = arSummary(ar, '2026-11-21');
  assert.equal(s.total, 130);
  assert.equal(s.inTerm, 80);
  assert.equal(s.overdue, 50);
  assert.equal(s.aging.d31_60, 50);
  const ap = [
    { id: 'x', total: 70, paid: 0, dueDate: '2026-11-25', priority: 'P1' },
    { id: 'y', total: 30, paid: 0, dueDate: '2026-11-02' },
    { id: 'z', total: 90, paid: 0, dueDate: '2026-12-15' },
  ];
  const p = apSummary(ap, '2026-11-21');
  assert.equal(p.dueThisMonth, 100);
  assert.equal(p.overdue, 30);
  assert.equal(p.p1Due, 70);
  assert.equal(p.total, 190);
});

test('radar cảnh báo', () => {
  const alerts = buildRadar({
    today: '2026-11-21',
    loans: [
      { id: 'a', bankId: 'v', contractNo: 'K1', amount: 1, status: 'ACTIVE', maturityDate: '2026-11-30' },
      { id: 'b', bankId: 'v', contractNo: 'K2', amount: 1, status: 'ACTIVE', maturityDate: '2026-12-15' },
      { id: 'c', bankId: 'v', contractNo: 'K3', amount: 1, status: 'ACTIVE', maturityDate: '2027-03-01' },
    ],
    banks: [{ id: 'v', name: 'VCB' }],
    ar: [{ id: 'r', partnerName: 'KH A', total: 10, paid: 0, dueDate: '2026-11-11' }],
    ap: [
      { id: 'p', partnerName: 'NCC', total: 10, paid: 0, dueDate: '2026-11-25', priority: 'P1' },
      { id: 'q', partnerName: 'NCC2', total: 10, paid: 0, dueDate: '2026-11-25', priority: 'P3' },
    ],
  });
  const ids = alerts.map((a) => `${a.id}:${a.level}`);
  assert.ok(ids.includes('loan-a:red'));
  assert.ok(ids.includes('loan-b:yellow'));
  assert.ok(!ids.some((x) => x.startsWith('loan-c')));
  assert.ok(ids.includes('ar-r:yellow'));
  assert.ok(ids.includes('ap-p:red'));
  assert.ok(!ids.some((x) => x.startsWith('ap-q')));
  assert.equal(alerts[0].level, 'red');
});

test('điều phối tháng: ứng viên, gộp thứ tự, giả lập', () => {
  const month = '2026-11';
  const ap = [
    { id: 'p1', partnerName: 'Điện lực', total: 100, paid: 0, dueDate: '2026-11-20', priority: 'P1' },
    { id: 'p2', partnerName: 'Vật tư', total: 300, paid: 100, dueDate: '2026-11-28', priority: 'P2' },
    { id: 'p3', partnerName: 'Quảng cáo', total: 50, paid: 0, dueDate: '2026-11-15', priority: 'P3' },
    { id: 'p4', partnerName: 'Tháng sau', total: 999, paid: 0, dueDate: '2026-12-15', priority: 'P2' },
  ];
  const loans = [{ id: 'l', bankId: 'v', contractNo: 'K9', amount: 400, status: 'ACTIVE', maturityDate: '2026-11-25', disbursedDate: '2026-05-25', interestRate: 0 }];
  const cands = planCandidates({ ap, loans, banks: [{ id: 'v', name: 'VCB' }], month, custom: [{ key: 'c1', label: 'Lương', amount: 200, priority: 'P1', category: 'Lương' }] });
  assert.equal(cands.length, 5); // p1, p2, p3, đáo hạn, lương (lãi = 0 nên không có)
  const rows = mergePlanRows(cands, {});
  assert.deepEqual(rows.map((r) => r.priority), ['P1', 'P1', 'P1', 'P2', 'P3']);
  assert.equal(rows.find((r) => r.key === 'ap_p3').selected, false); // P3 mặc định không chọn
  assert.equal(rows.find((r) => r.key === 'ap_p2').amount, 200); // mặc định = số còn nợ

  // thứ tự kéo-thả đã lưu + một khoản mới (lương) được chèn cuối nhóm P1
  const ordered = mergePlanRows(cands, { order: ['ap_p2', 'ap_p1', 'lm_l', 'ap_p3'], items: { ap_p2: { amount: 150 } } });
  assert.equal(ordered[0].mode, 'PART'); // bản cũ chỉ lưu số tiền -> hiểu là trả 1 phần
  assert.equal(ordered[0].remainingAfter, 50);
  // chọn "Trả toàn bộ" -> luôn bằng số còn nợ, bỏ qua số tiền đã nhập trước đó
  const full = mergePlanRows(cands, { items: { ap_p2: { amount: 150, mode: 'FULL' } } });
  assert.equal(full.find((r) => r.key === 'ap_p2').amount, 200);
  const part = mergePlanRows(cands, { items: { ap_p2: { amount: 80, mode: 'PART' } } });
  assert.equal(part.find((r) => r.key === 'ap_p2').amount, 80);
  assert.deepEqual(ordered.map((r) => r.key), ['ap_p2', 'ap_p1', 'lm_l', 'c1', 'ap_p3']);

  const arRows = planReceivables({ ar: [{ id: 'k', partnerName: 'KH', total: 500, paid: 0, dueDate: '2026-11-30', certainty: 'SURE' }, { id: 'k2', partnerName: 'KH2', total: 80, paid: 0, dueDate: '2026-11-30', certainty: 'MAYBE_LATE' }], month });
  assert.equal(arRows.filter((r) => r.selected).length, 1);

  const plan = computePlan({ cashBalance: 300, reserve: 100, deposits: 50, includeDeposits: true, arRows, creditAvailable: 600, creditBanks: [{ id: 'a', name: 'ACB', available: 40 }, { id: 'v', name: 'VCB', available: 560 }], rows: ordered });
  // nguồn = 200 + 50 + 500 = 750 ; chi = 150 + 100 + 400 + 200 = 850
  assert.equal(plan.baseSources, 750);
  assert.equal(plan.payTotal, 850);
  assert.equal(plan.balance, -100);
  assert.equal(plan.suggestedDraw, 100);
  assert.equal(plan.uncovered, 0);
  assert.equal(plan.haveTotal, 250); // Tổng có = tiền mặt có thể dùng + tiền gửi
  assert.deepEqual(plan.groups, { SUPPLIER: 250, FIXED: 200, BANK: 400, INTERNAL: 0 });
  assert.deepEqual(plan.drawPlan.map((d) => [d.name, d.amount]), [['VCB', 100]]); // giải ngân từ NH còn nhiều hạn mức nhất
  assert.equal(plan.balanceAfterDraw, 0);
  assert.equal(plan.rows.find((r) => r.key === 'c1').overflow, true);
  assert.equal(plan.rows.find((r) => r.key === 'lm_l').overflow, false);

  // hạn mức không đủ: giải ngân hết các ngân hàng, vẫn còn thiếu
  const tight = computePlan({ cashBalance: 300, reserve: 100, deposits: 50, arRows, creditAvailable: 60, creditBanks: [{ id: 'a', name: 'ACB', available: 40 }, { id: 'v', name: 'VCB', available: 20 }], rows: ordered });
  assert.equal(tight.sources, 750); // hạn mức không bao giờ được cộng sẵn vào nguồn
  assert.equal(tight.suggestedDraw, 60);
  assert.equal(tight.uncovered, 40);
  assert.deepEqual(tight.drawPlan.map((d) => [d.name, d.amount]), [['ACB', 40], ['VCB', 20]]);
});

test('duyệt chi: khoản đã duyệt luôn vào kế hoạch với số tiền đã duyệt', () => {
  const month = '2026-11';
  const ap = [
    { id: 'x', partnerName: 'Dây cáp', total: 1000, paid: 200, dueDate: '2027-01-10', priority: 'P2' }, // chưa đến hạn
    { id: 'y', partnerName: 'Bao bì', total: 500, paid: 0, dueDate: '2027-02-10', priority: 'P2' },
    { id: 'z', partnerName: 'Điện', total: 90, paid: 0, dueDate: '2026-11-20', priority: 'P1' },
  ];
  const approvals = [
    { id: 'a1', payableId: 'x', mode: 'PART', amount: 300, status: 'OPEN' },
    { id: 'a2', payableId: 'y', mode: 'FULL', amount: 500, status: 'DONE' }, // đã chuyển -> không còn mở
    { id: 'a3', payableId: 'z', mode: 'FULL', amount: 50, status: 'OPEN' }, // chi hết = theo số còn nợ hiện tại
  ];
  const cands = planCandidates({ ap, month, approvals });
  assert.deepEqual(cands.map((c) => c.refId).sort(), ['x', 'z']);
  const rows = mergePlanRows(cands, { items: { ap_x: { sel: false, amount: 10, mode: 'PART' } } });
  const x = rows.find((r) => r.refId === 'x');
  assert.equal(x.selected, true); // đã duyệt thì không bỏ chọn được
  assert.equal(x.amount, 300);
  assert.equal(x.locked, true);
  assert.equal(x.remainingAfter, 500);
  assert.equal(rows.find((r) => r.refId === 'z').amount, 90);
  assert.equal(approvalAmount({ mode: 'PART', amount: 999 }, 120), 120); // không vượt số còn nợ
});

test('đối chiếu kế hoạch vs thực tế', () => {
  const snap = {
    month: '2026-11',
    arRows: [{ key: 'k', refId: 'k', partner: 'KH', selected: true, amount: 500 }],
    rows: [
      { key: 'ap_p1', kind: 'AP', refId: 'p1', partner: 'Điện', selected: true, amount: 100 },
      { key: 'c1', kind: 'CUSTOM', partner: 'Lương', selected: true, amount: 200 },
    ],
  };
  const payments = [
    { kind: 'AR', parentId: 'k', amount: 300, date: '2026-11-25' },
    { kind: 'AP', parentId: 'p1', amount: 100, date: '2026-11-20' },
    { kind: 'AP', parentId: 'zz', partnerName: 'Ngoài KH', amount: 70, date: '2026-11-21' },
    { kind: 'AP', parentId: 'p1', amount: 5, date: '2026-12-01' },
  ];
  const v = computeVariance(snap, payments);
  assert.equal(v.inRows[0].variance, -200);
  assert.equal(v.inRows[0].material, true);
  assert.equal(v.outRows[0].variance, 0);
  assert.equal(v.totals.unplannedOut, 70);
  assert.equal(v.totals.untrackedOut, 200);
  assert.equal(v.totals.inRate, 60);
  // Chốt ngày 22/11: khoản thu ngày 21/11 (trước khi chốt) không tính lại
  const v2 = computeVariance({ ...snap, lockedOn: '2026-11-22' }, [...payments, { kind: 'AR', parentId: 'k', amount: 99, date: '2026-11-21' }]);
  assert.equal(v2.inRows[0].actual, 300);
  assert.equal(v2.totals.unplannedOut, 0);
});

test('nguồn khả dụng có / không gộp hạn mức vay', () => {
  const rows = [{ key: 'a', kind: 'CUSTOM', selected: true, amount: 900, priority: 'P1' }];
  const off = computePlan({ cashBalance: 500, reserve: 100, deposits: 200, arRows: [{ selected: true, amount: 100 }], creditAvailable: 1000, rows });
  assert.equal(off.available, 700);
  assert.equal(off.balanceAvailable, -200);
  assert.equal(off.suggestedDraw, 200);
  const on = computePlan({ cashBalance: 500, reserve: 100, deposits: 200, arRows: [{ selected: true, amount: 100 }], creditAvailable: 1000, includeCredit: true, rows });
  assert.equal(on.available, 1700);
  assert.equal(on.balanceAvailable, 800);
  assert.equal(on.suggestedDraw, 200);
});
