import { clsx } from 'clsx';
import { ArrowUpRight, BellRing, Check } from 'lucide-react';

/**
 * What a signal looks like in the app, drawn for the landing and sign-in pages. It is marked as an example: it is
 * not a real trade and shows no result.
 */
export function SignalPreview({ className }: { className?: string }) {
  return (
    <figure className={clsx('relative', className)} aria-label="Example of a signal in the app">
      <div className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow)] sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-buy-soft px-2 py-0.5 text-xs font-bold tracking-wide text-buy">BUY</span>
            <span className="font-semibold">XAU/USD</span>
          </div>
          <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">
            Active
          </span>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-subtle">Entry</dt>
            <dd className="num mt-0.5 font-semibold">2,345.00</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-subtle">Target 1</dt>
            <dd className="num mt-0.5 flex items-center gap-1 font-semibold text-success">
              2,360.00 <Check className="size-3.5" aria-label="reached" />
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-subtle">Target 2</dt>
            <dd className="num mt-0.5 font-semibold">2,375.00</dd>
          </div>
        </dl>
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-update-soft px-3 py-2 text-[13px] text-update">
          <ArrowUpRight className="size-4 shrink-0" aria-hidden />
          <span>
            Stop-loss updated: <span className="num font-semibold">2,338.00</span> <span>(was 2,330.00)</span>
          </span>
        </div>
        <figcaption className="mt-3 text-[11px] text-subtle">Example for illustration. Not a real trade.</figcaption>
      </div>
      <div
        aria-hidden
        className="absolute -right-3 -top-5 hidden w-56 rotate-2 items-start gap-2.5 rounded-xl border border-line bg-raised p-3 shadow-[var(--shadow)] sm:flex"
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-buy-soft text-buy">
          <BellRing className="size-3.5" />
        </span>
        <span className="min-w-0 text-[12px] leading-snug">
          <span className="block font-semibold">New signal</span>
          <span className="block text-muted">Buy XAU/USD, entry 2,345.00</span>
        </span>
      </div>
    </figure>
  );
}
