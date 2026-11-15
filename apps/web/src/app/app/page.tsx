'use client';

import { TITLES, type TradeSummary } from '@signaldesk/domain';
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import Link from 'next/link';
import { TradeCard } from '@/components/trade';
import { PushPrompt } from '@/components/subscriber/push-prompt';
import { buttonClass, EmptyState, ErrorState, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';

function Group({ id, title, trades }: { id: string; title: string; trades: TradeSummary[] }) {
  if (trades.length === 0) return null;
  return (
    <section aria-labelledby={id} className="mb-7">
      <h2
        id={id}
        className="mb-2.5 flex items-baseline gap-2 text-[13px] font-semibold uppercase tracking-wide text-muted"
      >
        {title}
        <span className="num font-medium text-subtle">{trades.length}</span>
      </h2>
      <div className="flex flex-col gap-3">
        {trades.map((t) => (
          <TradeCard key={t.id} trade={t} href={`/app/trades/${t.id}`} />
        ))}
      </div>
    </section>
  );
}

/**
 * Live trades only: those in progress first, then those still to start. A trade leaves this page the moment it
 * closes and is in History straight away; nothing is listed twice.
 */
export default function SignalsPage() {
  const active = useQuery({
    queryKey: ['active'],
    queryFn: () => api.get<{ trades: TradeSummary[] }>('/trades/active'),
  });
  const trades = active.data?.trades ?? [];
  const running = trades.filter((t) => t.status !== 'PUBLISHED');
  const upcoming = trades.filter((t) => t.status === 'PUBLISHED');
  return (
    <>
      <PageHeader title="Signals" />
      <PushPrompt />
      {active.isPending && <Loading rows={3} label="Loading signals" />}
      {active.isError && <ErrorState error={active.error} onRetry={() => void active.refetch()} />}
      {active.isSuccess && trades.length === 0 && (
        <EmptyState
          icon={<Activity className="size-5" aria-hidden />}
          title="No live signals right now"
          action={
            <Link href="/app/history" className={buttonClass('secondary')}>
              See {TITLES.history}
            </Link>
          }
        >
          New signals appear here as soon as they are published.
        </EmptyState>
      )}
      <Group id="running" title={TITLES.active} trades={running} />
      <Group id="upcoming" title={TITLES.upcoming} trades={upcoming} />
    </>
  );
}
