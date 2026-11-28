import test from 'node:test';
import assert from 'node:assert/strict';
import { committedOut, isHeld, pendingApprovals, toPayItems, withRunning } from '../src/lib/pending.js';

const today = '2026-11-20';
const pc = (id, amount, extra = {}) => ({ id, type: 'PC', amount, person: `NV ${id}`, reason: 'Mua vật tư', date: '2026-11-10', status: 'PENDING', debit: '642', ...extra });
const debt = (id, total, dueDate, extra = {}) => ({ id, partnerName: `NCC ${id}`, total, paid: 0, dueDate, priority: 'P2', ...extra });

test('chờ duyệt: đề xuất chờ duyệt + công nợ đến hạn trong tháng, bỏ khoản đã có lệnh / đang hoãn', () => {
  const vouchers = [pc('a', 2e6, { submittedOn: '2026-11-12' }), pc('b', 1e6, { submittedOn: '2026-11-11' }), pc('c', 5e6, { status: 'APPROVED' }), pc('d', 1e6, { auto: true })];
  const ap = [
    debt('x', 10e6, '2026-11-25'),
    debt('y', 3e6, '2026-11-02', { priority: 'P1' }),
    debt('z', 4e6, '2026-12-10'), // tháng sau
    debt('w', 6e6, '2026-11-15'), // đã có lệnh duyệt
    debt('h', 7e6, '2026-11-15', { holdUntil: '2026-12-01' }), // đang hoãn
  ];
  const approvals = [{ id: 'o1', payableId: 'w', status: 'OPEN', mode: 'FULL' }];
  const list = pendingApprovals({ vouchers, ap, approvals, today });
  assert.deepEqual(
    list.map((x) => x.key),
    ['V:b', 'V:a', 'AP:y', 'AP:x'],
  );
  assert.equal(list.find((x) => x.key === 'AP:y').overdue, 18);
  assert.equal(list.find((x) => x.key === 'AP:x').amount, 10e6);
  // phạm vi "all": cả công nợ tháng sau
  assert.ok(pendingApprovals({ vouchers, ap, approvals, today, scope: 'all' }).some((x) => x.key === 'AP:z'));
});

test('hoãn công nợ hết hiệu lực khi qua ngày', () => {
  assert.equal(isHeld({ holdUntil: '2026-12-01' }, '2026-11-30'), true);
  assert.equal(isHeld({ holdUntil: '2026-12-01' }, '2026-12-01'), false);
  assert.equal(isHeld({}, today), false);
});

test('số còn lại sau từng khoản duyệt (tính dồn từ trên xuống)', () => {
  const items = [
    { key: '1', out: 3e6, inn: 0 },
    { key: '2', out: 0, inn: 1e6 },
    { key: '3', out: 9e6, inn: 0 },
  ];
  assert.deepEqual(
    withRunning(items, 10e6).map((x) => x.after),
    [7e6, 8e6, -1e6],
  );
});

test('tiền đã cam kết: đề xuất đã duyệt (số Sếp chốt) + lệnh chi công nợ chưa chuyển', () => {
  const vouchers = [
    pc('a', 2e6, { status: 'APPROVED' }),
    pc('b', 5e6, { status: 'APPROVED', approvedAmount: 3e6 }), // duyệt một phần
    { id: 'r', type: 'PT', amount: 1e6, status: 'APPROVED', credit: '131' },
    pc('c', 9e6, { status: 'POSTED' }),
  ];
  const ap = [debt('x', 10e6, '2026-11-25', { paid: 4e6 })];
  const approvals = [
    { id: 'o1', payableId: 'x', status: 'OPEN', mode: 'FULL' },
    { id: 'o2', payableId: 'x', status: 'DONE', mode: 'FULL' },
  ];
  const c = committedOut({ vouchers, approvals, ap });
  assert.equal(c.out, 2e6 + 3e6 + 6e6);
  assert.equal(c.in, 1e6);
  assert.equal(c.net, 1e6 - 11e6);
});

test('cần chi ngay: đề xuất đã duyệt chưa báo đã chi + lệnh chi công nợ, kèm thông tin người nhận', () => {
  const vouchers = [
    pc('a', 2e6, { status: 'APPROVED', approvedOn: '2026-11-18', payMethod: 'BANK', payeeAccount: '0123', payeeBank: 'VCB' }),
    pc('b', 5e6, { status: 'APPROVED', approvedAmount: 3e6, approvedOn: '2026-11-17' }),
    pc('c', 1e6, { status: 'APPROVED', paidAt: '2026-11-19' }), // đã chi, chờ chốt sổ
    pc('d', 1e6, { status: 'PENDING' }),
  ];
  const orders = [{ id: 'o1', partnerName: 'NCC X', payAmount: 6e6, approvedOn: '2026-11-16', supplier: { name: 'NCC X', bankAccount: '999', bankName: 'BIDV' } }];
  const list = toPayItems({ vouchers, orders });
  assert.deepEqual(
    list.map((x) => x.key),
    ['AP:o1', 'V:b', 'V:a'],
  );
  const b = list.find((x) => x.key === 'V:b');
  assert.equal(b.amount, 3e6);
  assert.equal(b.requested, 5e6);
  assert.equal(b.bank, false);
  const a = list.find((x) => x.key === 'V:a');
  assert.deepEqual(a.payee, { name: 'NV a', account: '0123', bank: 'VCB', branch: undefined });
  assert.equal(list.find((x) => x.key === 'AP:o1').payee.account, '999');
});
