'use client';

import type { TradeSummary } from '@signaldesk/domain';
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import Link from 'next/link';
import { TradeCard } from '@/components/trade';
import { buttonClass, EmptyState, ErrorState, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';

export default function ActivePage() {
  const active = useQuery({
    queryKey: ['active'],
    queryFn: () => api.get<{ trades: TradeSummary[] }>('/trades/active'),
  });
  const trades = active.data?.trades ?? [];
  const running = trades.filter((t) => t.status !== 'PUBLISHED');
  const waiting = trades.filter((t) => t.status === 'PUBLISHED');
  return (
    <>
      <PageHeader title="Active trades" description="The latest effective levels. These are always the current ones." />
      {active.isPending && <Loading rows={3} label="Loading active trades" />}
      {active.isError && <ErrorState error={active.error} onRetry={() => void active.refetch()} />}
      {active.isSuccess && trades.length === 0 && (
        <EmptyState
          icon={<Activity className="size-5" aria-hidden />}
          title="No active trades right now"
          action={
            <Link href="/app/history" className={buttonClass('secondary')}>
              See past trades
            </Link>
          }
        >
          Trades appear here from the moment they are published until they close.
        </EmptyState>
      )}
      {running.length > 0 && (
        <section aria-labelledby="running" className="mb-6">
          <h2 id="running" className="mb-2 text-[13px] font-semibold text-muted">
            In progress ({running.length})
          </h2>
          <div className="flex flex-col gap-3">
            {running.map((t) => (
              <TradeCard key={t.id} trade={t} href={`/app/trades/${t.id}`} />
            ))}
          </div>
        </section>
      )}
      {waiting.length > 0 && (
        <section aria-labelledby="waiting">
          <h2 id="waiting" className="mb-2 text-[13px] font-semibold text-muted">
            Awaiting entry ({waiting.length})
          </h2>
          <div className="flex flex-col gap-3">
            {waiting.map((t) => (
              <TradeCard key={t.id} trade={t} href={`/app/trades/${t.id}`} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
