import test from 'node:test';
import assert from 'node:assert/strict';
import {
  settlement,
  cashEffect,
  validateVoucher,
  buildPostingPlan,
  buildReversalPlan,
  advanceRemaining,
  countersNeeded,
  internalForPlan,
  itemsTotal,
} from '../src/lib/vouchers.js';

let seq = 0;
const newId = () => `g${++seq}`;
const base = { person: 'Nguyễn Văn A', position: 'Phòng KD', reason: 'Mua văn phòng phẩm', date: '2026-11-05', status: 'APPROVED', approvedBy: 'waaseevn@gmail.com' };
const tt = (id, items, advanceAmount = 0, extra = {}) => ({ ...base, id, type: 'TT', items, advanceAmount, expenseAccount: '642', ...extra });

test('bảng kê và quyết toán A/B', () => {
  const items = [{ name: 'Giấy A4', qty: 10, price: 65000 }, { name: 'Bút', qty: 3, price: 12500 }];
  assert.equal(itemsTotal(items), 687500);
  assert.deepEqual(settlement(tt('x', items, 1000000)), { A: 687500, B: 1000000, cleared: 687500, refund: 312500, extra: 0 });
  assert.deepEqual(settlement(tt('x', items, 500000)), { A: 687500, B: 500000, cleared: 500000, refund: 0, extra: 187500 });
  assert.deepEqual(cashEffect(tt('x', items, 0)), { in: 0, out: 687500 });
  assert.deepEqual(cashEffect({ type: 'PT', amount: 5e6 }), { in: 5e6, out: 0 });
});

test('kiểm tra dữ liệu chứng từ', () => {
  assert.match(validateVoucher({ ...base, type: 'PC', amount: 0, debit: '642' }), /lớn hơn 0/);
  assert.match(validateVoucher({ ...base, type: 'TT', items: [], expenseAccount: '642' }), /ít nhất một dòng/);
  assert.equal(validateVoucher({ ...base, type: 'PC', amount: 1000, debit: '642' }), '');
  const adv = { id: 'tu1', type: 'TU', status: 'POSTED', amount: 2e6, settledAmount: 1.5e6, no: 'TU-202611-001' };
  assert.equal(advanceRemaining(adv), 5e5);
  assert.match(validateVoucher(tt('t', [{ name: 'x', qty: 1, price: 1e6 }], 6e5, { advanceId: 'tu1' }), { advances: [adv] }), /vượt/);
});

test('kết chuyển: đánh số, sinh phiếu chênh lệch, bút toán sổ quỹ mã cố định', () => {
  seq = 0;
  const tu = { id: 'tu1', type: 'TU', status: 'POSTED', amount: 2e6, settledAmount: 0, no: 'TU-202611-001', date: '2026-11-01', person: 'A' };
  const vouchers = [
    { ...base, id: 'pt1', type: 'PT', amount: 3e6, credit: '131', no: 'PT-202611-004' },
    { ...base, id: 'pc1', type: 'PC', amount: 1.2e6, debit: '642', no: '' },
    { ...base, id: 'tu2', type: 'TU', amount: 5e5, no: 'TU-202611-002', date: '2026-11-03' },
    tt('tt1', [{ name: 'Xăng', qty: 1, price: 1.5e6 }], 2e6, { advanceId: 'tu1', no: 'TT-202611-001' }),
    tt('tt2', [{ name: 'Taxi', qty: 2, price: 3e5 }], 0, { no: 'TT-202611-002' }),
  ];
  const p = buildPostingPlan({ vouchers, advances: { tu1: tu }, counters: { 'PC-202611': 7, 'KC-20261120': 1 }, postDate: '2026-11-20', newId, batchId: 'B1', actorEmail: 'o@x' });
  assert.equal(p.batchCode, 'KC-20261120-02');
  // pc1 chưa có số -> cấp số theo bộ đếm tháng
  const pc1 = p.voucherUpdates.find((u) => u.id === 'pc1');
  assert.equal(pc1.patch.no, 'PC-202611-009'); // phiếu chi tạm ứng của TU2 (ngày sớm hơn) nhận số 008
  // TU2 -> phiếu chi tạm ứng; TT1 hoàn ứng 500k -> phiếu thu; TT2 không ứng -> phiếu chi
  const types = p.generated.map((g) => `${g.data.type}:${g.data.amount}`).sort();
  assert.deepEqual(types, ['PC:500000', 'PC:600000', 'PT:500000']);
  assert.ok(p.generated.every((g) => g.data.status === 'POSTED' && g.data.auto));
  // Mã bút toán sổ quỹ cố định theo chứng từ -> không thể ghi trùng
  assert.ok(p.cashEntries.every((c) => /^V_(pt1|pc1|tu2|tt1|tt2)_B1_\d$/.test(c.id)));
  assert.equal(new Set(p.cashEntries.map((c) => c.id)).size, p.cashEntries.length);
  assert.equal(p.batch.receiptsTotal, 3e6 + 5e5);
  assert.equal(p.batch.paymentsTotal, 1.2e6 + 5e5 + 6e5);
  assert.equal(p.batch.net, 3.5e6 - 2.3e6);
  assert.equal(p.advanceUpdates.tu1.settledAmount, 2e6);
  // Định khoản TT1: Nợ 642 / Có 141 1.5tr + Nợ 1111 / Có 141 0.5tr
  const e = p.voucherUpdates.find((u) => u.id === 'tt1').patch.entries;
  assert.deepEqual(e, [
    { debit: '642', credit: '141', amount: 1.5e6 },
    { debit: '1111', credit: '141', amount: 5e5 },
  ]);
  // Bộ đếm tăng đúng
  assert.equal(p.counters['PC-202611'], 10);
  assert.equal(p.counters['PT-202611'], 1);
  assert.deepEqual(countersNeeded(vouchers, '2026-11-20').sort(), ['KC-20261120', 'PC-202611', 'PT-202611'].sort());
});

test('chi quá tạm ứng sinh phiếu chi bổ sung, quyết toán vượt dư nợ bị chặn', () => {
  const tu = { id: 'tu1', type: 'TU', status: 'POSTED', amount: 1e6, settledAmount: 0, no: 'TU-1' };
  const v = tt('tt9', [{ name: 'Vé', qty: 1, price: 1.3e6 }], 1e6, { advanceId: 'tu1', no: 'TT-9' });
  const p = buildPostingPlan({ vouchers: [v], advances: { tu1: tu }, postDate: '2026-11-21', newId, batchId: 'B2' });
  assert.equal(p.generated.length, 1);
  assert.equal(p.generated[0].data.type, 'PC');
  assert.equal(p.generated[0].data.amount, 3e5);
  assert.equal(p.generated[0].data.debit, '642');
  const twice = [v, { ...v, id: 'tt10', no: 'TT-10' }];
  assert.throws(() => buildPostingPlan({ vouchers: twice, advances: { tu1: tu }, postDate: '2026-11-21', newId, batchId: 'B3' }), /vượt/);
});

test('hủy kết chuyển: bút toán đảo, trả lại dư nợ tạm ứng', () => {
  const v = { ...tt('tt1', [{ name: 'x', qty: 1, price: 1.5e6 }], 2e6, { advanceId: 'tu1' }), status: 'POSTED', no: 'TT-1', postingBatchId: 'B1' };
  const cash = [{ id: 'V_tt1_B1_1', type: 'IN', amount: 5e5, voucherId: 'g1', voucherNo: 'PT-202611-001' }];
  const r = buildReversalPlan({ v, gens: [{ id: 'g1', status: 'POSTED' }], cash, advance: { id: 'tu1', settledAmount: 2e6 }, reverseDate: '2026-11-22', reason: 'Sai số' });
  assert.equal(r.reversals[0].id, 'R_V_tt1_B1_1');
  assert.equal(r.reversals[0].data.type, 'OUT');
  assert.equal(r.voucherPatch.status, 'APPROVED');
  assert.equal(r.advanceUpdate.settledAmount, 0);
  assert.throws(() => buildReversalPlan({ v: { type: 'TU', status: 'POSTED', settledAmount: 1 } }), /quyết toán/);
});

test('dòng chi nội bộ cho bảng điều phối không tính trùng phần đã kết chuyển', () => {
  const list = [
    { type: 'PC', status: 'APPROVED', amount: 1e6, date: '2026-11-02' },
    { type: 'TU', status: 'APPROVED', amount: 2e6, date: '2026-11-03' },
    { type: 'PT', status: 'APPROVED', amount: 5e5, date: '2026-11-03' },
    { type: 'PC', status: 'POSTED', amount: 7e5, date: '2026-11-01', postedOn: '2026-11-04' },
    { type: 'PC', status: 'POSTED', amount: 9e5, date: '2026-11-01', postedOn: '2026-11-04', auto: true },
    { type: 'PC', status: 'PENDING', amount: 4e6, date: '2026-11-03' },
  ];
  const r = internalForPlan(list, '2026-11');
  assert.equal(r.pendingOut, 3e6);
  assert.equal(r.pendingIn, 5e5);
  assert.equal(r.postedOut, 7e5);
});

test('bảng kê đợt: mỗi bút toán tiền mặt chỉ một dòng; mẫu in và Excel dựng được', async () => {
  const { ledgerLines } = await import('../src/lib/vouchers.js');
  const { buildPrintHtml } = await import('../src/lib/voucherPrint.js');
  const { buildBatchSheets } = await import('../src/lib/voucherExcel.js');
  const { buildXlsx } = await import('../src/lib/xlsx.js');
  const tu = { ...base, id: 'tu5', type: 'TU', amount: 5e5, no: 'TU-202611-005' };
  const t2 = tt('tt5', [{ name: 'Taxi', unit: 'chuyến', qty: 2, price: 3e5 }], 0, { no: 'TT-202611-005' });
  const p = buildPostingPlan({ vouchers: [tu, t2], postDate: '2026-11-20', newId, batchId: 'B9' });
  const lines = ledgerLines(p.docs);
  const cashOut = lines.filter((l) => l.credit === '1111').reduce((s, l) => s + l.amount, 0);
  assert.equal(cashOut, p.batch.paymentsTotal);
  const company = { companyName: 'Cty A', address: 'HN', regulation: 'TT200', bookNo: '01', addressee: 'Giám đốc' };
  const html = buildPrintHtml({ batch: p.batch, docs: p.docs, company, paper: 'A5' });
  assert.match(html, /BẢNG KÊ CHỨNG TỪ KẾT XUẤT/);
  assert.match(html, /GIẤY ĐỀ NGHỊ TẠM ỨNG/);
  assert.match(html, /Năm trăm nghìn đồng/);
  assert.match(html, /Sáu trăm nghìn đồng/);
  const bytes = buildXlsx(buildBatchSheets({ batch: p.batch, docs: p.docs, company }));
  assert.ok(bytes.length > 1000);
});

test('số liệu tháng của chứng từ: thu, chi, chi phí, chờ duyệt', async () => {
  const { voucherStats } = await import('../src/lib/vouchers.js');
  const list = [
    { type: 'PT', status: 'POSTED', amount: 5e6, date: '2026-11-03', entries: [{ debit: '1111', credit: '131', amount: 5e6 }] },
    { type: 'PC', status: 'POSTED', amount: 2e6, date: '2026-11-04', entries: [{ debit: '642', credit: '1111', amount: 2e6 }] },
    { type: 'TU', status: 'POSTED', amount: 3e6, settledAmount: 0, date: '2026-10-30', postedOn: '2026-11-01', entries: [{ debit: '141', credit: '1111', amount: 3e6 }], person: 'An', no: 'TU-1' },
    { type: 'TT', status: 'POSTED', items: [{ qty: 1, price: 1e6 }], advanceAmount: 1.5e6, date: '2026-11-10', postedOn: '2026-11-10', entries: [{ debit: '642', credit: '141', amount: 1e6 }, { debit: '1111', credit: '141', amount: 5e5 }] },
    { type: 'PC', status: 'POSTED', auto: true, amount: 3e6, date: '2026-11-01' },
    { type: 'PC', status: 'POSTED', amount: 9e6, date: '2026-10-20', entries: [] },
    { type: 'PC', status: 'PENDING', amount: 7e5, date: '2026-11-20' },
    { type: 'PT', status: 'APPROVED', amount: 4e5, date: '2026-11-21' },
  ];
  const s = voucherStats(list, '2026-11');
  assert.equal(s.cashIn, 5e6 + 5e5);
  assert.equal(s.cashOut, 2e6 + 3e6);
  assert.equal(s.net, 5.5e6 - 5e6);
  assert.equal(s.expense, 3e6);
  assert.equal(s.receipts, 2);
  assert.equal(s.payments, 2);
  assert.deepEqual(s.outByType, { TU: 3e6, TT: 0, PC: 2e6 });
  assert.equal(s.pendingCount, 1);
  assert.equal(s.pendingAmount, 7e5);
  assert.equal(s.approvedIn, 4e5);
  assert.equal(s.advanceOpen, 3e6);
});
