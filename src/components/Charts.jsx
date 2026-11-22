/**
 * Biểu đồ SVG nhẹ (không thư viện):
 *  - CashFlowChart: thu vs chi tiền mặt theo tháng (cột nhóm, có tooltip + bảng số)
 *  - BankUsageBars: dư nợ / hạn mức còn được vay theo ngân hàng
 * Màu chuỗi đã kiểm tra bằng bộ kiểm tra bảng màu (thu #1baf7a, chi #eb6834).
 */
import { useMemo, useState } from 'react';
import { fmtCompact, fmtVND } from '../lib/format.js';
import { cx } from './ui.jsx';

export const SERIES = { in: '#1baf7a', out: '#eb6834', used: '#2a78d6', free: '#b7d3f6' };

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}

function Legend({ items }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/** data: [{ label: 'T6', month: '2026-06', inSum, outSum }] */
export function CashFlowChart({ data, onSelect }) {
  const [hover, setHover] = useState(null);
  const [table, setTable] = useState(false);
  const W = 640;
  const H = 230;
  const pad = { l: 66, r: 8, t: 12, b: 28 };
  const max = useMemo(() => niceMax(Math.max(...data.map((d) => Math.max(d.inSum, d.outSum)), 0)), [data]);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const cw = (W - pad.l - pad.r) / data.length;
  const bw = Math.min(26, (cw - 18) / 2);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const base = y(0);

  const bar = (x, v, color, key) => {
    const h = Math.max(0, base - y(v));
    if (h <= 0) return null;
    const r = Math.min(4, h, bw / 2);
    // bo tròn 4px ở đầu cột, chân cột vuông trên trục
    const d = `M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + bw - r} Q${x + bw},${base - h} ${x + bw},${base - h + r} V${base} Z`;
    return <path key={key} d={d} fill={color} />;
  };

  const hv = hover != null ? data[hover] : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <Legend items={[{ label: 'Thu tiền mặt', color: SERIES.in }, { label: 'Chi tiền mặt', color: SERIES.out }]} />
        <button type="button" onClick={() => setTable((t) => !t)} className="text-xs font-medium text-sapphire-600 hover:underline">
          {table ? 'Xem biểu đồ' : 'Xem bảng số'}
        </button>
      </div>
      {table ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500">
              <th className="py-1.5 text-left font-medium">Tháng</th>
              <th className="py-1.5 text-right font-medium">Thu</th>
              <th className="py-1.5 text-right font-medium">Chi</th>
              <th className="py-1.5 text-right font-medium">Chênh lệch</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((d) => (
              <tr key={d.month}>
                <td className="py-1.5">{d.label}</td>
                <td className="py-1.5 text-right money tabular-nums">{fmtVND(d.inSum)}</td>
                <td className="py-1.5 text-right money tabular-nums">{fmtVND(d.outSum)}</td>
                <td className={cx('py-1.5 text-right money tabular-nums font-medium', d.inSum - d.outSum < 0 ? 'text-vermilion-600' : 'text-jade-700')}>
                  {fmtVND(d.inSum - d.outSum)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Biểu đồ thu chi tiền mặt theo tháng">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth="1" strokeDasharray={t === 0 ? '' : '3 4'} />
                <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#64748b" className="money">
                  {t === 0 ? '0' : fmtCompact(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x0 = pad.l + i * cw + (cw - (bw * 2 + 2)) / 2;
              return (
                <g key={d.month}>
                  {hover === i && <rect x={pad.l + i * cw + 2} y={pad.t} width={cw - 4} height={base - pad.t} rx="8" fill="#0f1e3a" opacity="0.04" />}
                  {bar(x0, d.inSum, SERIES.in, 'i')}
                  {bar(x0 + bw + 2, d.outSum, SERIES.out, 'o')}
                  <text x={pad.l + i * cw + cw / 2} y={H - 8} textAnchor="middle" fontSize="11.5" fill={hover === i ? '#0f1e3a' : '#64748b'} fontWeight={hover === i ? 600 : 400}>
                    {d.label}
                  </text>
                  <rect
                    x={pad.l + i * cw}
                    y={pad.t}
                    width={cw}
                    height={H - pad.t}
                    fill="transparent"
                    style={{ cursor: onSelect ? 'pointer' : 'default' }}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => onSelect?.(d)}
                  />
                </g>
              );
            })}
          </svg>
          {hv && (
            <div
              className="pointer-events-none absolute top-2 z-10 w-48 rounded-xl bg-ink-900 px-3 py-2 text-xs text-white shadow-xl"
              style={{ left: `clamp(0px, calc(${((pad.l + hover * cw + cw / 2) / W) * 100}% - 96px), calc(100% - 192px))` }}
            >
              <p className="font-semibold mb-1">{hv.title}</p>
              <p className="flex justify-between gap-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm" style={{ background: SERIES.in }} /> Thu
                </span>
                <span className="money tabular-nums">{fmtVND(hv.inSum)}</span>
              </p>
              <p className="flex justify-between gap-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm" style={{ background: SERIES.out }} /> Chi
                </span>
                <span className="money tabular-nums">{fmtVND(hv.outSum)}</span>
              </p>
              <p className="mt-1 flex justify-between gap-2 border-t border-white/15 pt-1">
                <span>Chênh lệch</span>
                <span className="money tabular-nums font-semibold">{fmtVND(hv.inSum - hv.outSum)}</span>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** rows: bankSummary().rows */
export function BankUsageBars({ rows, onSelect }) {
  if (!rows.length) return <p className="text-sm text-slate-500">Chưa có ngân hàng nào.</p>;
  return (
    <div className="space-y-4">
      <Legend items={[{ label: 'Dư nợ đang vay', color: SERIES.used }, { label: 'Còn được vay', color: SERIES.free }]} />
      {rows.map((b) => {
        const total = Math.max(b.limit, b.outstanding) || 1;
        const used = (b.outstanding / total) * 100;
        return (
          <button
            type="button"
            key={b.id}
            onClick={() => onSelect?.(b)}
            className="block w-full text-left group"
            title={`${b.name}: dư nợ ${fmtVND(b.outstanding)} · còn được vay ${fmtVND(b.available)}`}
          >
            <div className="flex items-baseline justify-between gap-2 mb-1.5">
              <span className="text-sm font-medium text-ink-900 truncate group-hover:text-sapphire-600">{b.name}</span>
              <span className="text-xs text-slate-500 whitespace-nowrap">
                <span className="money font-semibold text-ink-900">{fmtCompact(b.outstanding)}</span> / <span className="money">{fmtCompact(b.limit)}</span>
              </span>
            </div>
            <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full">
              {used > 0 && <div className="h-full rounded-l-full" style={{ width: `${used}%`, background: SERIES.used, borderTopRightRadius: used >= 100 ? 9999 : 0, borderBottomRightRadius: used >= 100 ? 9999 : 0 }} />}
              {used < 100 && <div className="h-full flex-1 rounded-r-full" style={{ background: SERIES.free, borderTopLeftRadius: used <= 0 ? 9999 : 0, borderBottomLeftRadius: used <= 0 ? 9999 : 0 }} />}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Còn được vay <span className="money font-semibold text-sapphire-600">{fmtVND(b.available)}</span>
            </p>
          </button>
        );
      })}
    </div>
  );
}
