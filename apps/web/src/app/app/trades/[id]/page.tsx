'use client';

import type { TradeDetail } from '@signaldesk/domain';
import { STATUS_LABELS } from '@signaldesk/domain';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { DirectionBadge, Levels, OutcomeSummary, StatusBadge, Timeline } from '@/components/trade';
import { Badge, Card, ErrorState, Loading } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

const STATE_HELP: Record<string, string> = {
  PUBLISHED: 'This signal is waiting for its entry. It is not active until an update says so.',
  ACTIVE: 'This trade is active. Follow the current stop-loss below.',
  PARTIALLY_CLOSED: 'Part of this trade has been closed. The rest is still open.',
  CLOSED: 'This trade is finished. No further action is needed.',
  CANCELLED: 'This signal was cancelled before entry. Do not enter it.',
  EXPIRED: 'The entry was not reached in time. Do not enter it.',
};

export default function TradePage() {
  const { id } = useParams<{ id: string }>();
  const trade = useQuery({ queryKey: ['trade', id], queryFn: () => api.get<TradeDetail>(`/trades/${id}`) });
  const back = (
    <Link
      href="/app/active"
      className="-ml-1 inline-flex items-center gap-1 rounded px-1 text-[13px] text-muted hover:text-text"
    >
      <ArrowLeft className="size-3.5" aria-hidden /> Active trades
    </Link>
  );
  if (trade.isPending) return <Loading rows={2} label="Loading trade" />;
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
  return (
    <>
      {back}
      <header className="mt-2">
        <div className="flex flex-wrap items-center gap-2">
          <DirectionBadge direction={t.direction} large />
          <h1 className="text-[22px] font-semibold tracking-tight">{t.symbol}</h1>
          <StatusBadge status={t.status} />
          {t.priority === 'PRIORITY' && <Badge tone="update">Priority</Badge>}
        </div>
        <p className="mt-1 text-[13px] text-muted">
          <span className="num">{t.ref}</span> · Published {formatDateTime(t.publishedAt)}
        </p>
      </header>

      <Card className="mt-4 p-4 sm:p-5">
        <p className="mb-3 text-sm text-muted">{STATE_HELP[t.status] ?? STATUS_LABELS[t.status]}</p>
        <Levels
          precision={t.pricePrecision}
          entryLow={t.entryLow}
          entryHigh={t.entryHigh}
          entryType={t.entryType}
          targets={t.targets}
          stopLoss={t.stopLoss}
          originalStopLoss={t.originalStopLoss}
        />
        {t.entryExpiresAt && t.status === 'PUBLISHED' && (
          <p className="mt-3 text-[13px] text-muted">Entry valid until {formatDateTime(t.entryExpiresAt)}.</p>
        )}
        {t.outcome && (
          <div className="mt-4">
            <OutcomeSummary outcome={t.outcome} precision={t.pricePrecision} />
          </div>
        )}
      </Card>

      <section aria-labelledby="timeline" className="mt-6">
        <h2 id="timeline" className="mb-3 text-[13px] font-semibold text-muted">
          What happened, in order
        </h2>
        <Timeline events={t.events} />
      </section>
      <p className="mt-8 text-xs leading-relaxed text-subtle">
        General information, not personal advice. You decide whether to act on it. Prices can move before you read this.{' '}
        <Link href="/disclosures" className="underline">
          Risk disclosure
        </Link>
      </p>
    </>
  );
}
