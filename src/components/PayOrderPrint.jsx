/**
 * Nút "In lệnh chi / bàn giao thanh toán": các khoản Sếp đã duyệt chưa chi
 * (đề xuất nội bộ + lệnh chi công nợ), Phần I chuyển khoản, Phần II tiền mặt — theo số Sếp duyệt.
 */
import { useState } from 'react';
import { Printer } from 'lucide-react';
import { todayISO } from '../lib/dates.js';
import { plainText, transferContent } from '../lib/vouchers.js';
import { buildPayOrderHtml } from '../lib/approvalPrint.js';
import { useToPay } from './NotificationCenter.jsx';
import { SheetPreview } from './SheetPreview.jsx';
import { Button } from './ui.jsx';

export function payOrderParts(toPay) {
  const bank = toPay
    .filter((it) => it.bank)
    .map((it) => ({
      who: it.payee?.name || it.who,
      account: it.payee?.account || '',
      bank: it.payee?.bank || '',
      branch: it.payee?.branch || '',
      amount: it.amount,
      requested: it.requested || 0,
      content: it.kind === 'V' ? it.v.transferNote || transferContent(it.v) : plainText(`Thanh toan ${it.who} ${it.what}`).slice(0, 140),
    }));
  const cash = toPay.filter((it) => !it.bank).map((it) => ({ who: it.who, what: it.what, amount: it.amount, requested: it.requested || 0 }));
  return { bank, cash };
}

export function PayOrderButton({ label = 'In lệnh chi / bàn giao', size = 'md', variant = 'secondary', className = '' }) {
  const toPay = useToPay();
  const [open, setOpen] = useState(false);
  const build = ({ company, preparer, date }) => buildPayOrderHtml({ company, date, preparer, ...payOrderParts(toPay) });
  return (
    <>
      <Button size={size} variant={variant} icon={Printer} disabled={!toPay.length} onClick={() => setOpen(true)} className={className}>
        {label}
      </Button>
      <SheetPreview
        open={open}
        onClose={() => setOpen(false)}
        title="Lệnh chi / bàn giao thanh toán"
        subtitle={`${toPay.length} khoản Sếp đã duyệt · Phần I chuyển khoản, Phần II tiền mặt`}
        fileBase={`Lenh-chi_${todayISO()}`}
        build={build}
        signerKeys={['director', 'chiefAccountant', 'cashier']}
      />
    </>
  );
}
