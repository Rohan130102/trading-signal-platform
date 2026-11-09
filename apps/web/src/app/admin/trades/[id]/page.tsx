'use client';

import {
  type AdminEvent,
  type AdminTradeDetail,
  BASIS_LABELS,
  CLOSE_REASON_LABELS,
  formatPrice,
} from '@signaldesk/domain';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  BookCheck,
  EyeOff,
  CircleCheck,
  Flag,
  Lock,
  OctagonX,
  PencilLine,
  Play,
  ShieldCheck,
  Siren,
  Target,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { DispatchStatus } from '@/components/admin/dispatch';
import { canRemove, RemoveTradesDialog, useRestoreTrades } from '@/components/admin/remove-trades';
import { ActionDialog, type ActionKind } from '@/components/admin/trade-actions';
import { DirectionBadge, Levels, StatusBadge, Timeline } from '@/components/trade';
import { Badge, Button, Card, CardHeader, ErrorState, Kbd, Loading, Stat } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, money, percent, signedPoints } from '@/lib/format';
import { useMe } from '@/lib/session';

const PRIMARY: { kind: ActionKind; label: string; icon: typeof Play; key?: string; variant?: 'primary' | 'danger' }[] =
  [
    { kind: 'ACTIVATE', label: 'Activate trade', icon: Play, key: 'A', variant: 'primary' },
    { kind: 'MOVE_STOP', label: 'Move stop-loss', icon: ShieldCheck, key: 'M' },
    { kind: 'MOVE_STOP_BREAKEVEN', label: 'Stop to breakeven', icon: Flag, key: 'E' },
    { kind: 'TRAIL_STOP', label: 'Trail stop', icon: TrendingUp, key: 'T' },
    { kind: 'TARGET_HIT', label: 'Target reached', icon: Target, key: 'H' },
    { kind: 'BOOK_PARTIAL', label: 'Book partial', icon: BookCheck, key: 'P' },
    { kind: 'CLOSE', label: 'Close trade', icon: CircleCheck, key: 'C', variant: 'primary' },
    { kind: 'URGENT', label: 'Urgent instruction', icon: Siren, key: 'U' },
    { kind: 'MODIFY_TARGETS', label: 'Change targets', icon: PencilLine },
    { kind: 'RECORD_EXECUTION', label: 'Record my execution', icon: Lock },
    { kind: 'CANCEL', label: 'Cancel signal', icon: Ban, variant: 'danger' },
    { kind: 'EXPIRE', label: 'Expired, no entry', icon: OctagonX },
    { kind: 'CORRECT', label: 'Correct an error', icon: PencilLine },
  ];

export default function AdminTradePage() {
  const { id } = useParams<{ id: string }>();
  const trade = useQuery({
    queryKey: ['admin', 'trade', id],
    queryFn: () => api.get<AdminTradeDetail>(`/admin/trades/${id}`),
    refetchInterval: (query) =>
      query.state.data?.events.some(
        (e) => e.dispatch && (e.dispatch.stage === 'PENDING' || e.dispatch.stage === 'IN_PROGRESS'),
      )
        ? 1500
        : 15_000,
  });
  const [action, setAction] = useState<{ kind: ActionKind; targetIndex?: number } | null>(null);
  const [removing, setRemoving] = useState(false);
  const master = useMe().data?.isMasterAdmin === true;
  const putBack = useRestoreTrades();
  const data = trade.data;
  const available = useMemo(() => (data?.allowedActions ?? []) as ActionKind[], [data?.allowedActions]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        action ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      const match = PRIMARY.find((p) => p.key?.toLowerCase() === event.key.toLowerCase() && available.includes(p.kind));
      if (match) {
        event.preventDefault();
        setAction({ kind: match.kind });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [action, available]);

  const back = (
    <Link
      href="/admin/trades"
      className="-ml-1 inline-flex items-center gap-1 rounded px-1 text-[13px] text-muted hover:text-text"
    >
      <ArrowLeft className="size-3.5" aria-hidden /> Trades
    </Link>
  );
  if (trade.isPending) return <Loading rows={3} label="Loading trade" />;
  if (trade.isError) {
    return (
      <>
        {back}
        <ErrorState
          error={trade.error}
          onRetry={() => void trade.refetch()}
          title={
            trade.error instanceof ApiError && trade.error.status === 404 ? 'That trade does not exist' : undefined
          }
        />
      </>
    );
  }
  const t = trade.data;
  const shown = PRIMARY.filter((p) => available.includes(p.kind));
  const aggregate = t.aggregate;
  return (
    <>
      {back}
      <header className="mb-4 mt-2">
        <div className="flex flex-wrap items-center gap-2">
          <DirectionBadge direction={t.direction} large />
          <h1 className="text-[22px] font-semibold tracking-tight">{t.symbol}</h1>
          <StatusBadge status={t.status} />
          {t.priority === 'PRIORITY' && <Badge tone="update">Priority</Badge>}
        </div>
        <p className="mt-1 text-[13px] text-muted">
          <span className="num">{t.ref}</span> · Published {formatDateTime(t.publishedAt)} · Version {t.version}
        </p>
      </header>
      {t.removal && (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-stop/30 bg-stop-soft p-3 text-sm text-stop"
        >
          <p className="flex items-start gap-2">
            <EyeOff className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Removed from subscriber screens by {t.removal.removedBy} on {formatDateTime(t.removal.removedAt)}:{' '}
              <span className="text-text">“{t.removal.reason}”</span>. It is still counted in performance figures.
              Nothing can be changed until it is put back.
            </span>
          </p>
          {master && (
            <Button size="sm" loading={putBack.isPending} onClick={() => putBack.mutate([t.id])}>
              Put back on screens
            </Button>
          )}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,19rem)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="p-4 sm:p-5">
            <Levels
              precision={t.pricePrecision}
              entryLow={t.entryLow}
              entryHigh={t.entryHigh}
              entryType={t.entryType}
              targets={t.targets}
              stopLoss={t.stopLoss}
              originalStopLoss={t.originalStopLoss}
            />
            {t.execution && (
              <p className="mt-3 border-t border-line pt-3 text-[13px] text-muted">
                <Lock className="mr-1 inline size-3.5" aria-hidden /> Declared execution (private): entry{' '}
                <span className="num text-text">{formatPrice(t, t.execution.entryPrice)}</span>
                {t.execution.quantity && (
                  <>
                    , quantity{' '}
                    <span className="num text-text">
                      {t.execution.quantity} {t.unitLabel}
                    </span>
                  </>
                )}
                . Not independently verified.
              </p>
            )}
          </Card>
          {aggregate && (
            <Card>
              <CardHeader title="Result" description={BASIS_LABELS[aggregate.basis]} />
              <dl className="grid grid-cols-2 border-t border-line sm:grid-cols-4">
                <Stat label="Closed" value={percent(aggregate.closedFraction)} />
                <Stat
                  label="Average exit"
                  value={aggregate.averageExit ? formatPrice(t, aggregate.averageExit) : 'n/a'}
                />
                <Stat
                  label="Move, weighted by portion"
                  value={aggregate.weightedPoints ? signedPoints(aggregate.weightedPoints) : 'Not measured'}
                />
                <Stat
                  label="Net result"
                  value={aggregate.netPnl ? money(aggregate.netPnl, t.quoteCurrency) : 'None'}
                  hint={
                    aggregate.netPnl
                      ? aggregate.grossPnl
                        ? `Gross ${money(aggregate.grossPnl, t.quoteCurrency)}`
                        : undefined
                      : 'No position recorded'
                  }
                />
              </dl>
              <div
                className="overflow-x-auto border-t border-line"
                role="region"
                aria-label="Exit records"
                tabIndex={0}
              >
                <table className="w-full min-w-[560px] text-left text-[13px]">
                  <caption className="sr-only">Exit records</caption>
                  <thead className="text-xs text-muted">
                    <tr>
                      {['Exit', 'Portion', 'Price', 'Entry used', 'Move', 'Net', 'When'].map((h) => (
                        <th key={h} scope="col" className="px-4 py-2 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {t.closures.map((c) => (
                      <tr
                        key={c.id}
                        className={`border-t border-line ${c.superseded ? 'text-subtle line-through' : ''}`}
                      >
                        <td className="px-4 py-2">
                          {c.kind === 'FINAL' ? 'Final' : 'Partial'}
                          {c.reason && <span className="text-muted"> · {CLOSE_REASON_LABELS[c.reason]}</span>}
                          {c.superseded && <span className="ml-1 no-underline">(corrected)</span>}
                        </td>
                        <td className="num px-4 py-2">{percent(c.fraction, 2)}</td>
                        <td className="num px-4 py-2">{formatPrice(t, c.exitPrice)}</td>
                        <td className="num px-4 py-2">{c.entryPriceUsed ? formatPrice(t, c.entryPriceUsed) : 'n/a'}</td>
                        <td className="num px-4 py-2">{c.points ? signedPoints(c.points) : 'n/a'}</td>
                        <td className="num px-4 py-2">{c.netPnl ? money(c.netPnl, t.quoteCurrency) : 'n/a'}</td>
                        <td className="px-4 py-2 text-muted">{formatDateTime(c.exitedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          <Card className="p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-semibold">Timeline</h2>
            <Timeline
              events={t.events}
              renderExtra={(event) => {
                const e = event as AdminEvent;
                return (
                  <div className="mt-1.5 flex flex-col gap-1">
                    {e.broadcast ? (
                      <DispatchStatus dispatch={e.dispatch} />
                    ) : (
                      <Badge className="self-start">
                        <Lock className="size-3" aria-hidden /> Internal, not sent
                      </Badge>
                    )}
                    <p className="text-xs text-subtle">{e.actorName ? `By ${e.actorName}` : 'By the system'}</p>
                  </div>
                );
              }}
            />
          </Card>
        </div>
        <aside aria-label="Actions" className="max-lg:order-first lg:sticky lg:top-7 lg:self-start">
          <Card>
            <CardHeader
              title="Actions"
              description={
                ['CLOSED', 'CANCELLED', 'EXPIRED'].includes(t.status)
                  ? shown.length > 0
                    ? 'This trade is finished. You can still correct a published error.'
                    : 'This signal is finished.'
                  : undefined
              }
            />
            {shown.length > 0 && (
              <div className="grid grid-cols-2 gap-1.5 border-t border-line p-3 lg:grid-cols-1">
                {shown.map(({ kind, label, icon: Icon, key, variant }) => (
                  <Button
                    key={kind}
                    variant={variant ?? 'secondary'}
                    className="w-full justify-start whitespace-normal text-left leading-tight max-lg:px-2.5"
                    onClick={() => setAction({ kind })}
                  >
                    <Icon className="size-4" aria-hidden />
                    {label}
                    {key && (
                      <span className="ml-auto">
                        <Kbd>{key}</Kbd>
                      </span>
                    )}
                  </Button>
                ))}
              </div>
            )}
            {master && canRemove({ ...t, removedAt: t.removal?.removedAt ?? null }) && (
              <div className="border-t border-line p-3">
                <Button variant="danger" className="w-full justify-start" onClick={() => setRemoving(true)}>
                  <EyeOff className="size-4" aria-hidden /> Remove from subscriber screens
                </Button>
              </div>
            )}
            <div className="border-t border-line p-3">
              <Link
                href={`/admin/compose?symbol=${encodeURIComponent(t.symbol)}&direction=${t.direction}`}
                className="text-[13px] text-muted underline underline-offset-2 hover:text-text"
              >
                Publish a new signal on {t.symbol}
              </Link>
            </div>
          </Card>
        </aside>
      </div>
      {action && (
        <ActionDialog
          key={action.kind}
          trade={t}
          kind={action.kind}
          targetIndex={action.targetIndex}
          onClose={() => setAction(null)}
        />
      )}
      {removing && <RemoveTradesDialog trades={[t]} onClose={() => setRemoving(false)} />}
    </>
  );
}
