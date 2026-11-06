'use client';

import { toDec } from '@signaldesk/domain';
import { useId, useMemo, useState } from 'react';
import { formatPoints } from '@signaldesk/domain';
import { formatDateTime, signedPoints } from '@/lib/format';

export interface ChartPoint {
  ref: string;
  at: string;
  points: string;
}

const W = 720;
const H = 240;
const PAD = { top: 16, right: 56, bottom: 28, left: 56 };

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min];
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

function compact(value: number): string {
  const abs = Math.abs(value);
  return abs >= 1000 ? `${(value / 1000).toFixed(abs >= 10_000 ? 0 : 1)}K` : String(value);
}

/**
 * Running total of recorded points for one instrument and one basis, in closing order. Only ever drawn
 * for a single instrument: points on different instruments are not comparable. One neutral line on one
 * axis, because direction here is the story and identity is already in the title.
 */
export function CumulativeChart({ points, title, unit }: { points: ChartPoint[]; title: string; unit: string }) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const series = useMemo(() => {
    let running = toDec('0');
    return points.map((p) => {
      running = running.plus(toDec(p.points));
      return { ...p, total: running.toFixed(), value: running.toNumber() };
    });
  }, [points]);

  if (series.length < 2) {
    return (
      <p className="px-4 py-6 text-sm text-muted sm:px-5">At least two measured trades are needed to draw this.</p>
    );
  }

  const values = series.map((s) => s.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const ticks = niceTicks(min, max);
  const top = Math.max(max, ...ticks);
  const bottom = Math.min(min, ...ticks);
  const x = (i: number) => PAD.left + (i / (series.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - bottom) / (top - bottom || 1)) * (H - PAD.top - PAD.bottom);
  const line = series.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(s.value).toFixed(1)}`).join(' ');
  const last = series[series.length - 1] as (typeof series)[number];
  const hovered = active === null ? null : series[active];

  const pick = (clientX: number, rect: DOMRect) => {
    const ratio = (clientX - rect.left) / rect.width;
    const svgX = ratio * W;
    const index = Math.round(((svgX - PAD.left) / (W - PAD.left - PAD.right)) * (series.length - 1));
    setActive(Math.max(0, Math.min(series.length - 1, index)));
  };

  return (
    <figure className="m-0 px-2 pb-3 sm:px-3">
      <figcaption id={id} className="sr-only">
        {title}. {series.length} trades, ending at {signedPoints(last.total)}. The table below lists every record.
      </figcaption>
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
            if (e.key === 'ArrowRight') setActive((a) => Math.min(series.length - 1, (a ?? -1) + 1));
            if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? series.length) - 1));
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke={t === 0 ? 'var(--line-strong)' : 'var(--line)'}
                strokeWidth="1"
              />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--subtle)" className="num">
                {compact(t)}
              </text>
            </g>
          ))}
          <text x={PAD.left} y={H - 8} fontSize="11" fill="var(--subtle)">
            {series[0]?.ref}
          </text>
          <text x={W - PAD.right} y={H - 8} textAnchor="end" fontSize="11" fill="var(--subtle)">
            {last.ref}
          </text>
          <path
            d={line}
            fill="none"
            stroke="var(--text)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle
            cx={x(series.length - 1)}
            cy={y(last.value)}
            r="4"
            fill="var(--text)"
            stroke="var(--surface)"
            strokeWidth="2"
          />
          <text x={x(series.length - 1) + 8} y={y(last.value) + 4} fontSize="12" fontWeight="600" fill="var(--text)">
            {compact(Math.round(last.value))}
          </text>
          {hovered && active !== null && (
            <g>
              <line
                x1={x(active)}
                x2={x(active)}
                y1={PAD.top}
                y2={H - PAD.bottom}
                stroke="var(--line-strong)"
                strokeWidth="1"
              />
              <circle
                cx={x(active)}
                cy={y(hovered.value)}
                r="4"
                fill="var(--text)"
                stroke="var(--surface)"
                strokeWidth="2"
              />
            </g>
          )}
        </svg>
        {hovered && active !== null && (
          <div
            className="pointer-events-none absolute top-1 z-10 rounded-lg border border-line-strong bg-raised px-2.5 py-1.5 text-xs shadow-float"
            style={{
              left: `${(x(active) / W) * 100}%`,
              transform: active > series.length / 2 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)',
            }}
            role="status"
          >
            <p className="font-semibold">{hovered.ref}</p>
            <p className="num">This trade: {signedPoints(hovered.points)}</p>
            <p className="num">Running total: {signedPoints(hovered.total)}</p>
            <p className="text-muted">{formatDateTime(hovered.at)}</p>
          </div>
        )}
      </div>
      <p className="mt-1 px-2 text-xs text-subtle">
        Vertical axis in {unit}. Ends at {formatPoints(last.total)} {unit}.
      </p>
    </figure>
  );
}
