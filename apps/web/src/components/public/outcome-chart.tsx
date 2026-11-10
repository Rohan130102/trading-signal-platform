'use client';

import { useId, useMemo, useState } from 'react';

export interface MonthOutcomes {
  /** YYYY-MM */
  month: string;
  wins: number;
  losses: number;
  breakevens: number;
}

const W = 720;
const H = 240;
const PAD = { top: 18, right: 16, bottom: 28, left: 40 };
const GAP = 2;
const R = 4;

const monthLabel = (month: string, style: 'short' | 'long' = 'short') =>
  new Date(`${month}-01T12:00:00Z`).toLocaleDateString(undefined, {
    month: style,
    year: style === 'long' ? 'numeric' : '2-digit',
    timeZone: 'UTC',
  });

/** A bar from the baseline with its far end rounded, so the data end reads and the baseline stays square. */
function bar(x: number, width: number, base: number, end: number): string {
  const up = end < base;
  const h = Math.abs(base - end);
  if (h < 0.5) return '';
  const r = Math.min(R, width / 2, h);
  if (up) {
    return `M${x},${base} V${end + r} Q${x},${end} ${x + r},${end} H${x + width - r} Q${x + width},${end} ${x + width},${end + r} V${base} Z`;
  }
  return `M${x},${base} V${end - r} Q${x},${end} ${x + r},${end} H${x + width - r} Q${x + width},${end} ${x + width},${end - r} V${base} Z`;
}

/**
 * Favourable trades above the line and unfavourable ones below it, one column per month of exits. Position
 * carries the meaning; the two colours and the legend repeat it. Breakevens are counted in the tooltip.
 */
export function OutcomeChart({ months }: { months: MonthOutcomes[] }) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const max = useMemo(() => Math.max(1, ...months.map((m) => Math.max(m.wins, m.losses))), [months]);
  if (months.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted sm:px-5">No finished, measured trades in this selection.</p>;
  }
  const plotH = H - PAD.top - PAD.bottom;
  const base = PAD.top + plotH / 2;
  const scale = (n: number) => (n / max) * (plotH / 2);
  const slot = (W - PAD.left - PAD.right) / months.length;
  const width = Math.max(4, Math.min(40, slot - GAP * 2));
  const x = (i: number) => PAD.left + i * slot + (slot - width) / 2;
  const step = Math.max(1, Math.ceil(months.length / 8));
  const hovered = active === null ? null : months[active];
  const totals = months.reduce((a, m) => ({ wins: a.wins + m.wins, losses: a.losses + m.losses }), {
    wins: 0,
    losses: 0,
  });

  const pick = (clientX: number, rect: DOMRect) => {
    const svgX = ((clientX - rect.left) / rect.width) * W;
    const index = Math.floor((svgX - PAD.left) / slot);
    setActive(index >= 0 && index < months.length ? index : null);
  };

  return (
    <figure className="m-0 px-2 pb-3 sm:px-3">
      <figcaption id={id} className="sr-only">
        Favourable and unfavourable finished trades by month of exit, {monthLabel(months[0]!.month, 'long')} to{' '}
        {monthLabel(months[months.length - 1]!.month, 'long')}: {totals.wins} favourable, {totals.losses} unfavourable.
        The table below lists every record.
      </figcaption>
      <div className="mb-2 flex flex-wrap items-center gap-4 px-2 text-xs text-muted" aria-hidden>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: 'var(--chart-win)' }} /> Favourable
          (above the line)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: 'var(--chart-loss)' }} /> Unfavourable
          (below the line)
        </span>
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-labelledby={id}
          tabIndex={0}
          className="block h-auto w-full touch-pan-y rounded"
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') setActive((a) => Math.min(months.length - 1, (a ?? -1) + 1));
            if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? months.length) - 1));
          }}
        >
          {[max, Math.round(max / 2)]
            .filter((v, i, all) => v > 0 && all.indexOf(v) === i)
            .map((v) => (
              <g key={v}>
                <line x1={PAD.left} x2={W - PAD.right} y1={base - scale(v)} y2={base - scale(v)} stroke="var(--line)" />
                <line x1={PAD.left} x2={W - PAD.right} y1={base + scale(v)} y2={base + scale(v)} stroke="var(--line)" />
                <text x={PAD.left - 8} y={base - scale(v) + 4} textAnchor="end" fontSize="11" fill="var(--subtle)">
                  {v}
                </text>
                <text x={PAD.left - 8} y={base + scale(v) + 4} textAnchor="end" fontSize="11" fill="var(--subtle)">
                  {v}
                </text>
              </g>
            ))}
          {active !== null && (
            <rect
              x={PAD.left + active * slot}
              y={PAD.top}
              width={slot}
              height={plotH}
              fill="var(--neutral-soft)"
              rx="4"
            />
          )}
          {months.map((m, i) => (
            <g key={m.month}>
              <path d={bar(x(i), width, base - GAP / 2, base - GAP / 2 - scale(m.wins))} fill="var(--chart-win)" />
              <path d={bar(x(i), width, base + GAP / 2, base + GAP / 2 + scale(m.losses))} fill="var(--chart-loss)" />
              {i % step === 0 && (
                <text x={x(i) + width / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--subtle)">
                  {monthLabel(m.month)}
                </text>
              )}
            </g>
          ))}
          <line x1={PAD.left} x2={W - PAD.right} y1={base} y2={base} stroke="var(--line-strong)" />
        </svg>
        {hovered && active !== null && (
          <div
            className="pointer-events-none absolute top-1 z-10 rounded-lg border border-line-strong bg-raised px-2.5 py-1.5 text-xs shadow-float"
            style={{
              left: `${((PAD.left + (active + 0.5) * slot) / W) * 100}%`,
              transform: active > months.length / 2 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)',
            }}
            role="status"
          >
            <p className="font-semibold">{monthLabel(hovered.month, 'long')}</p>
            <p className="num">Favourable: {hovered.wins}</p>
            <p className="num">Unfavourable: {hovered.losses}</p>
            <p className="num text-muted">Breakeven: {hovered.breakevens}</p>
          </div>
        )}
      </div>
    </figure>
  );
}
