import test from 'node:test';
import assert from 'node:assert/strict';
import { moneyToWords, readNumberVi } from '../src/lib/vnwords.js';

const cases = [
  [0, 'Không đồng'],
  [5, 'Năm đồng'],
  [10, 'Mười đồng'],
  [15, 'Mười lăm đồng'],
  [21, 'Hai mươi mốt đồng'],
  [24, 'Hai mươi bốn đồng'],
  [25, 'Hai mươi lăm đồng'],
  [100, 'Một trăm đồng'],
  [105, 'Một trăm linh năm đồng'],
  [110, 'Một trăm mười đồng'],
  [115, 'Một trăm mười lăm đồng'],
  [1000, 'Một nghìn đồng'],
  [1001, 'Một nghìn không trăm linh một đồng'],
  [1010, 'Một nghìn không trăm mười đồng'],
  [1100, 'Một nghìn một trăm đồng'],
  [21000, 'Hai mươi mốt nghìn đồng'],
  [115000, 'Một trăm mười lăm nghìn đồng'],
  [1005000, 'Một triệu không trăm linh năm nghìn đồng'],
  [1050000, 'Một triệu không trăm năm mươi nghìn đồng'],
  [1000005, 'Một triệu không trăm linh năm đồng'],
  [1250000, 'Một triệu hai trăm năm mươi nghìn đồng'],
  [47544889, 'Bốn mươi bảy triệu năm trăm bốn mươi bốn nghìn tám trăm tám mươi chín đồng'],
  [300769315, 'Ba trăm triệu bảy trăm sáu mươi chín nghìn ba trăm mười lăm đồng'],
  [1000000000, 'Một tỷ đồng'],
  [1005000000, 'Một tỷ không trăm linh năm triệu đồng'],
  [1254761425, 'Một tỷ hai trăm năm mươi bốn triệu bảy trăm sáu mươi mốt nghìn bốn trăm hai mươi lăm đồng'],
  [1000000005, 'Một tỷ không trăm linh năm đồng'],
  [2000000000000, 'Hai nghìn tỷ đồng'],
  [1500000000000, 'Một nghìn năm trăm tỷ đồng'],
  [12345678901, 'Mười hai tỷ ba trăm bốn mươi lăm triệu sáu trăm bảy mươi tám nghìn chín trăm linh một đồng'],
];

test('đọc số tiền thành chữ', () => {
  for (const [n, s] of cases) assert.equal(moneyToWords(n), s, `số ${n}`);
});

test('làm tròn và giá trị không hợp lệ', () => {
  assert.equal(moneyToWords('1250000'), 'Một triệu hai trăm năm mươi nghìn đồng');
  assert.equal(readNumberVi(NaN), 'không');
  assert.equal(moneyToWords(999999999), 'Chín trăm chín mươi chín triệu chín trăm chín mươi chín nghìn chín trăm chín mươi chín đồng');
});
