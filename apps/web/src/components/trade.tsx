'use client';

import {
  BASIS_LABELS,
  type CalculationBasis,
  CLOSE_REASON_LABELS,
  type Direction,
  type EventCategory,
  type FeedEvent,
  formatPrice,
  type PublicOutcome,
  STATUS_LABELS,
  type TargetState,
  type TemplateTone,
  type TradeStatus,
  type TradeSummary,
} from '@signaldesk/domain';
import { clsx } from 'clsx';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, Circle, Megaphone, Siren } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useSyncExternalStore } from 'react';
import { formatClock, formatDateTime, formatFull, formatRelative, percent, signedPoints } from '@/lib/format';
import { Badge } from './ui';

export function DirectionBadge({ direction, large }: { direction: Direction; large?: boolean }) {
  const buy = direction === 'BUY';
  const Icon = buy ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-md font-bold',
        buy ? 'bg-buy-soft text-buy' : 'bg-sell-soft text-sell',
        large ? 'px-2 py-1 text-[15px]' : 'px-1.5 py-0.5 text-xs',
      )}
    >
      <Icon className={large ? 'size-[18px]' : 'size-3.5'} aria-hidden />
      {direction}
    </span>
  );
}

const STATUS_TONE: Record<TradeStatus, 'neutral' | 'update' | 'buy' | 'success'> = {
  DRAFT: 'neutral',
  PUBLISHED: 'update',
  ACTIVE: 'buy',
  PARTIALLY_CLOSED: 'buy',
  CLOSED: 'neutral',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
};

export function StatusBadge({ status }: { status: TradeStatus }) {
  const live = status === 'ACTIVE' || status === 'PARTIALLY_CLOSED';
  return (
    <Badge tone={STATUS_TONE[status]}>
      {live && <Circle className="size-2 fill-current" aria-hidden />}
      {STATUS_LABELS[status]}
    </Badge>
  );
}

const TONE_ACCENT: Record<TemplateTone, string> = {
  BUY: 'before:bg-buy',
  SELL: 'before:bg-sell',
  UPDATE: 'before:bg-update',
  SUCCESS: 'before:bg-success',
  STOP: 'before:bg-stop',
  NEUTRAL: 'before:bg-line-strong',
};

const TONE_TEXT: Record<TemplateTone, string> = {
  BUY: 'text-buy',
  SELL: 'text-sell',
  UPDATE: 'text-update',
  SUCCESS: 'text-success',
  STOP: 'text-stop',
  NEUTRAL: 'text-muted',
};

function categoryLabel(category: EventCategory, ref?: string): string {
  switch (category) {
    case 'NEW_SIGNAL':
      return 'New signal';
    case 'UPDATE':
      return `Update to ${ref ?? 'trade'}`;
    case 'CLOSURE':
      return `Closed: ${ref ?? 'trade'}`;
    case 'ANNOUNCEMENT':
      return 'Announcement';
  }
}

const nowListeners = new Set<() => void>();
let nowValue = Date.now();
let nowTimer: ReturnType<typeof setInterval> | null = null;

function subscribeToNow(listener: () => void) {
  nowListeners.add(listener);
  nowTimer ??= setInterval(() => {
    nowValue = Date.now();
    for (const notify of nowListeners) notify();
  }, 30_000);
  return () => {
    nowListeners.delete(listener);
    if (nowListeners.size === 0 && nowTimer) {
      clearInterval(nowTimer);
      nowTimer = null;
    }
  };
}

/** One shared clock, so a feed left open never keeps saying "just now" about an old signal. */
function useNow(): number {
  return useSyncExternalStore(
    subscribeToNow,
    () => nowValue,
    () => nowValue,
  );
}

function Time({ iso }: { iso: string }) {
  const now = useNow();
  const recent = now - new Date(iso).getTime() < 86_400_000;
  return (
    <time dateTime={iso} title={formatFull(iso)} className="whitespace-nowrap text-xs text-subtle">
      {recent ? `${formatClock(iso)} · ${formatRelative(iso, now)}` : formatDateTime(iso)}
    </time>
  );
}

export function PriceCell({
  label,
  value,
  tone,
  strike,
  note,
}: {
  label: string;
  value: string;
  tone?: 'stop' | 'success' | 'update';
  strike?: boolean;
  note?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd
        className={clsx(
          'num text-[15px] font-semibold leading-snug',
          tone === 'stop' && 'text-stop',
          tone === 'success' && 'text-success',
          tone === 'update' && 'text-update',
          strike && 'line-through decoration-1',
        )}
      >
        {value}
      </dd>
      {note && <dd className="text-xs text-subtle">{note}</dd>}
    </div>
  );
}

/** Entry, targets and stop-loss. The same arrangement everywhere, so the eye learns where to look. */
export function Levels({
  precision,
  entryLow,
  entryHigh,
  entryType,
  targets,
  stopLoss,
  originalStopLoss,
}: {
  precision: number;
  entryLow?: string;
  entryHigh?: string;
  entryType?: 'SINGLE' | 'RANGE';
  targets: Pick<TargetState, 'index' | 'price' | 'status'>[];
  stopLoss: string;
  originalStopLoss?: string;
}) {
  const fmt = (v: string) => formatPrice({ pricePrecision: precision }, v);
  const moved = originalStopLoss !== undefined && originalStopLoss !== stopLoss;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))]">
      {entryLow !== undefined && (
        <PriceCell
          label={entryType === 'RANGE' ? 'Entry range' : 'Entry'}
          value={entryType === 'RANGE' ? `${fmt(entryLow)} – ${fmt(entryHigh as string)}` : fmt(entryLow)}
        />
      )}
      <PriceCell
        label={moved ? 'Stop-loss (now)' : 'Stop-loss'}
        value={fmt(stopLoss)}
        tone="stop"
        note={
          moved ? (
            <>
              was <span className="num">{fmt(originalStopLoss)}</span>
            </>
          ) : undefined
        }
      />
      {targets.map((t) => (
        <PriceCell
          key={t.index}
          label={t.status === 'HIT' ? `Target ${t.index}, reached` : `Target ${t.index}`}
          value={fmt(t.price)}
          tone={t.status === 'HIT' ? 'success' : undefined}
          strike={t.status === 'HIT'}
        />
      ))}
    </dl>
  );
}

/** A figure is never shown without saying what it rests on. */
function basisShort(basis: CalculationBasis | undefined): string {
  return basis === 'ADMIN_DECLARED_EXECUTION' ? 'declared by the administrator, unverified' : 'hypothetical';
}

/** Shows a change as before → after, which is what makes an update readable at a glance. */
function ChangeLine({ event }: { event: FeedEvent }) {
  const p = event.payload;
  const precision = p.pricePrecision ?? 2;
  const fmt = (v: string) => formatPrice({ pricePrecision: precision }, v);
  const arrow = <ArrowRight className="mx-1 inline size-3.5 text-subtle" aria-label="changed to" />;
  if (event.type === 'STOP_MOVED' && p.previousStop && p.newStop) {
    return (
      <p className="text-[15px]">
        <span className="text-muted">
          {p.stopKind === 'TRAIL'
            ? 'Trail stop-loss '
            : p.stopKind === 'BREAKEVEN'
              ? 'Stop-loss to breakeven '
              : 'Stop-loss '}
        </span>
        <span className="num text-muted line-through decoration-1">{fmt(p.previousStop)}</span>
        {arrow}
        <span className="num font-semibold text-stop">{fmt(p.newStop)}</span>
      </p>
    );
  }
  if (event.type === 'TARGET_HIT' && p.targetPrice) {
    return (
      <p className="text-[15px]">
        <Check className="mr-1 inline size-4 text-success" aria-hidden />
        <span className="text-muted">Target {p.targetIndex} reached at </span>
        <span className="num font-semibold text-success">{fmt(p.targetPrice)}</span>
      </p>
    );
  }
  if (event.type === 'TARGETS_MODIFIED' && p.newTargets) {
    return (
      <p className="text-[15px]">
        <span className="text-muted">Targets </span>
        {p.previousTargets && p.previousTargets.length > 0 && (
          <>
            <span className="num text-muted line-through decoration-1">{p.previousTargets.map(fmt).join(', ')}</span>
            {arrow}
          </>
        )}
        <span className="num font-semibold">{p.newTargets.map(fmt).join(', ') || 'none'}</span>
      </p>
    );
  }
  if ((event.type === 'PARTIAL_BOOKED' || event.type === 'TRADE_CLOSED') && p.exitPrice) {
    return (
      <p className="text-[15px]">
        <span className="text-muted">
          {event.type === 'PARTIAL_BOOKED' ? `Booked ${percent(p.fraction ?? '0')} at ` : 'Exit at '}
        </span>
        <span className="num font-semibold">{fmt(p.exitPrice)}</span>
        {p.movementPoints && (
          <span className="ml-2 text-[13px] text-muted">
            <span className="num">{signedPoints(p.movementPoints)}</span> ({basisShort(p.basis)})
          </span>
        )}
      </p>
    );
  }
  if (event.type === 'URGENT_INSTRUCTION' || event.type === 'ANNOUNCEMENT') {
    return <p className="whitespace-pre-line text-[15px] leading-relaxed">{p.message}</p>;
  }
  if (event.type === 'CORRECTION' && p.changes) {
    return (
      <div className="flex flex-col gap-1 text-[15px]">
        {p.changes.map((c) => (
          <p key={c.field}>
            <span className="text-muted">{c.field} </span>
            <span className="num text-muted line-through decoration-1">{c.from ?? 'none'}</span>
            {arrow}
            <span className="num font-semibold">{c.to ?? 'none'}</span>
          </p>
        ))}
        {p.correctionReason && <p className="text-sm text-muted">Reason: {p.correctionReason}</p>}
      </div>
    );
  }
  return null;
}

/** Everything a card in the feed needs. New signals are bold and complete; updates are subordinate. */
export function FeedCard({ event, fresh }: { event: FeedEvent; fresh?: boolean }) {
  const p = event.payload;
  const isNew = event.category === 'NEW_SIGNAL';
  const direction = p.direction;
  const tone: TemplateTone = isNew && direction ? (direction === 'BUY' ? 'BUY' : 'SELL') : event.tone;
  const urgent = event.priority === 'PRIORITY';
  const heading = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className={clsx('text-xs font-semibold uppercase tracking-wide', TONE_TEXT[tone])}>
        {categoryLabel(event.category, p.ref)}
      </span>
      {urgent && (
        <Badge tone="update">
          <Siren className="size-3" aria-hidden /> Priority
        </Badge>
      )}
      <span className="ml-auto">
        <Time iso={event.createdAt} />
      </span>
    </div>
  );
  const body = (
    <>
      {heading}
      {event.category === 'ANNOUNCEMENT' ? (
        <div className="mt-2 flex gap-2.5">
          <Megaphone className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <div className="min-w-0">
            <h3 className="font-semibold">{event.title}</h3>
            <div className="mt-1">
              <ChangeLine event={event} />
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {direction && <DirectionBadge direction={direction} large={isNew} />}
          <span className={clsx('font-semibold', isNew ? 'text-[17px]' : 'text-[15px]')}>{p.symbol}</span>
          {!isNew && event.tradeStatus && <StatusBadge status={event.tradeStatus} />}
          {isNew && event.tradeStatus && event.tradeStatus !== 'PUBLISHED' && (
            <StatusBadge status={event.tradeStatus} />
          )}
          {isNew && event.tradeStatus === 'PUBLISHED' && <Badge tone="update">Awaiting entry</Badge>}
        </div>
      )}
      {isNew && p.after && (
        <div className="mt-3">
          <Levels
            precision={p.pricePrecision ?? 2}
            entryLow={p.entryLow}
            entryHigh={p.entryHigh}
            entryType={p.entryType}
            targets={p.after.targets}
            stopLoss={p.after.stopLoss}
          />
        </div>
      )}
      {!isNew && event.category !== 'ANNOUNCEMENT' && (
        <div className="mt-2">
          <ChangeLine event={event} />
          {event.type !== 'CORRECTION' && event.type !== 'URGENT_INSTRUCTION' && !hasChangeLine(event) && (
            <p className="text-[15px] font-medium">{event.title}</p>
          )}
        </div>
      )}
      {p.comment && <p className="mt-2 whitespace-pre-line text-sm text-muted">{p.comment}</p>}
    </>
  );
  const className = clsx(
    'relative block overflow-hidden rounded-xl border bg-surface pl-[17px] pr-4 py-3.5 before:absolute before:inset-y-0 before:left-0 before:w-[3px]',
    TONE_ACCENT[tone],
    urgent ? 'border-update/40' : 'border-line',
    fresh && 'animate-arrive',
    event.tradeId && 'transition-colors hover:border-line-strong',
  );
  return event.tradeId ? (
    <Link href={`/app/trades/${event.tradeId}`} className={className}>
      <span className="sr-only">Open trade {p.ref}. </span>
      {body}
    </Link>
  ) : (
    <article className={className}>{body}</article>
  );
}

function hasChangeLine(event: FeedEvent): boolean {
  return ['STOP_MOVED', 'TARGET_HIT', 'TARGETS_MODIFIED', 'PARTIAL_BOOKED', 'TRADE_CLOSED'].includes(event.type);
}

export function TradeCard({ trade, href }: { trade: TradeSummary; href: string }) {
  return (
    <Link
      href={href}
      className={clsx(
        'relative block overflow-hidden rounded-xl border border-line bg-surface pl-[17px] pr-4 py-4 transition-colors hover:border-line-strong before:absolute before:inset-y-0 before:left-0 before:w-[3px]',
        trade.direction === 'BUY' ? 'before:bg-buy' : 'before:bg-sell',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <DirectionBadge direction={trade.direction} large />
        <span className="text-[17px] font-semibold">{trade.symbol}</span>
        <StatusBadge status={trade.status} />
        {trade.priority === 'PRIORITY' && <Badge tone="update">Priority</Badge>}
        <span className="num ml-auto text-xs text-subtle">{trade.ref}</span>
      </div>
      <div className="mt-3">
        <Levels
          precision={trade.pricePrecision}
          entryLow={trade.entryLow}
          entryHigh={trade.entryHigh}
          entryType={trade.entryType}
          targets={trade.targets}
          stopLoss={trade.stopLoss}
          originalStopLoss={trade.originalStopLoss}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line pt-2.5 text-[13px] text-muted">
        <span className="min-w-0 truncate">
          {trade.updatesCount > 0 ? `Latest: ${trade.lastEventTitle}` : 'No updates yet'}
        </span>
        {trade.lastEventAt && <Time iso={trade.lastEventAt} />}
      </div>
    </Link>
  );
}

function timelineIcon(event: FeedEvent) {
  const color =
    TONE_TEXT[event.category === 'NEW_SIGNAL' ? (event.payload.direction === 'SELL' ? 'SELL' : 'BUY') : event.tone];
  return <span className={clsx('size-2.5 rounded-full bg-current ring-4 ring-surface', color)} aria-hidden />;
}

/** Oldest first, with the original signal clearly separate from everything that changed after it. */
export function Timeline({
  events,
  renderExtra,
}: {
  events: FeedEvent[];
  renderExtra?: (event: FeedEvent) => ReactNode;
}) {
  return (
    <ol className="relative">
      <span aria-hidden className="absolute bottom-3 left-[4.5px] top-3 w-px bg-line" />
      {events.map((event) => {
        const isOriginal = event.category === 'NEW_SIGNAL';
        return (
          <li key={event.seq} className="relative flex gap-4 pb-5 last:pb-0">
            <span className="relative mt-[7px] flex shrink-0">{timelineIcon(event)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <h3 className="text-sm font-semibold">{isOriginal ? 'Original signal' : event.title}</h3>
                <time dateTime={event.createdAt} title={formatFull(event.createdAt)} className="text-xs text-subtle">
                  {formatDateTime(event.createdAt)}
                </time>
              </div>
              <div className="mt-1 text-sm">
                {isOriginal ? (
                  <p className="whitespace-pre-line text-muted">{event.body}</p>
                ) : (
                  <ChangeLine event={event} />
                )}
                {!isOriginal && event.payload.comment && (
                  <p className="mt-1 whitespace-pre-line text-muted">{event.payload.comment}</p>
                )}
              </div>
              {renderExtra?.(event)}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function BasisNote({ basis }: { basis: CalculationBasis }) {
  return <span className="text-xs text-subtle">{BASIS_LABELS[basis]}</span>;
}

/** What a subscriber is told about an outcome. Explicitly not a statement of their own result. */
export function OutcomeSummary({ outcome, precision }: { outcome: PublicOutcome; precision: number }) {
  const label = { WIN: 'Favourable', LOSS: 'Unfavourable', BREAKEVEN: 'Breakeven', UNRESOLVED: 'Not measured' }[
    outcome.outcome
  ];
  const tone = { WIN: 'success', LOSS: 'stop', BREAKEVEN: 'neutral', UNRESOLVED: 'neutral' }[outcome.outcome] as
    'success' | 'stop' | 'neutral';
  return (
    <div className="rounded-lg bg-bg p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{label}</Badge>
        {outcome.reason && <span className="text-sm text-muted">{CLOSE_REASON_LABELS[outcome.reason]}</span>}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-3">
        {outcome.averageExit && (
          <PriceCell label="Average exit" value={formatPrice({ pricePrecision: precision }, outcome.averageExit)} />
        )}
        {outcome.weightedPoints && <PriceCell label="Move recorded" value={signedPoints(outcome.weightedPoints)} />}
        {outcome.closedFraction !== '1' && <PriceCell label="Closed so far" value={percent(outcome.closedFraction)} />}
      </dl>
      <p className="mt-2 text-xs leading-relaxed text-subtle">
        {BASIS_LABELS[outcome.basis]}. This describes the signal, not what any subscriber achieved. Your result depends
        on your own entry, size and costs.
      </p>
    </div>
  );
}
