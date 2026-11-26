import { useEffect, useMemo, useState } from 'react';
import { fmtCompact, fmtNum, fmtVND, parseMoney } from '../lib/format.js';
import { cx, inputCls } from './ui.jsx';

/** Hiển thị số tiền VNĐ (tự làm mờ khi bật Chế độ riêng tư) */
export function Money({ value, className = '', sign = false, compact = false, unit = true }) {
  const v = Math.round(Number(value) || 0);
  const text = compact ? fmtCompact(v) : unit ? fmtVND(v) : fmtNum(v);
  return (
    <span className={cx('money tabular-nums whitespace-nowrap', className)}>
      {sign && v > 0 ? '+' : ''}
      {text}
    </span>
  );
}

const coarse = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/**
 * Ô nhập tiền:
 *  - Tự thêm dấu chấm phân cách hàng nghìn khi gõ.
 *  - Trên máy tính có thể gõ tắt: 500k, 150tr, 1,5 tỷ.
 *  - Trên điện thoại bật bàn phím số.
 */
export function MoneyInput({ value, onChange, className = '', showHint = true, placeholder = '0', unit = true, ...rest }) {
  const [text, setText] = useState(value ? fmtNum(value) : '');
  const [focused, setFocused] = useState(false);
  const numericKeyboard = useMemo(coarse, []);

  useEffect(() => {
    if (!focused) setText(value ? fmtNum(value) : '');
  }, [value, focused]);

  const handle = (e) => {
    const raw = e.target.value;
    if (/^[\d.\s]*$/.test(raw)) {
      const digits = raw.replace(/\D/g, '');
      setText(digits ? fmtNum(Number(digits)) : '');
      onChange?.(digits ? Number(digits) : 0);
    } else {
      setText(raw);
      const n = parseMoney(raw);
      if (n != null) onChange?.(n);
    }
  };

  const parsed = parseMoney(text) ?? 0;
  return (
    <div>
      <div className="relative">
        <input
          {...rest}
          type="text"
          inputMode={numericKeyboard ? 'numeric' : 'text'}
          autoComplete="off"
          value={text}
          placeholder={placeholder}
          onChange={handle}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            setText(value ? fmtNum(value) : '');
            rest.onBlur?.(e);
          }}
          className={cx(inputCls, 'money text-right tabular-nums font-medium', unit && 'pr-8', className)}
        />
        {unit && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">₫</span>}
      </div>
      {showHint && focused && parsed >= 1000 && (
        <span className="mt-1 block text-right text-xs text-slate-500">≈ {fmtCompact(parsed)}</span>
      )}
    </div>
  );
}
