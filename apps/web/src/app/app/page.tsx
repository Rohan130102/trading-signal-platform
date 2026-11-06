'use client';

import type { FeedEvent, FeedPage } from '@signaldesk/domain';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { BellRing, Inbox, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FeedCard } from '@/components/trade';
import { Button, buttonClass, EmptyState, ErrorState, Loading, PageHeader, Select } from '@/components/ui';
import { api, queryString } from '@/lib/api';
import { usePush } from '@/lib/push';
import { useRealtime } from '@/lib/realtime';

/** Consecutive updates to one trade read as one story, so they sit closer together. */
function groupByTrade(events: FeedEvent[]): FeedEvent[][] {
  const groups: FeedEvent[][] = [];
  for (const event of events) {
    const current = groups[groups.length - 1];
    if (current && event.tradeId && current[0]?.tradeId === event.tradeId) current.push(event);
    else groups.push([event]);
  }
  return groups;
}

function PushPrompt() {
  const { state, enable, busy } = usePush();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem('sd-push-prompt-dismissed') === '1');
    } catch {
      setDismissed(false);
    }
  }, []);
  if (dismissed || (state !== 'ready' && state !== 'ios-needs-install' && state !== 'denied')) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem('sd-push-prompt-dismissed', '1');
    } catch {
      // It simply reappears next time.
    }
  };
  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-line bg-surface p-3.5">
      <BellRing className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        {state === 'ready' && (
          <>
            <p className="text-sm font-medium">Get alerts on this device</p>
            <p className="text-[13px] text-muted">
              Know about new signals and stop-loss changes without keeping the app open.
            </p>
            <Button size="sm" variant="primary" className="mt-2" loading={busy} onClick={() => void enable()}>
              Turn on notifications
            </Button>
          </>
        )}
        {state === 'ios-needs-install' && (
          <>
            <p className="text-sm font-medium">Want alerts on your iPhone?</p>
            <p className="text-[13px] text-muted">First add this app to your Home Screen.</p>
            <Link href="/app/account#notifications" className={buttonClass('secondary', 'sm', 'mt-2')}>
              Show me how
            </Link>
          </>
        )}
        {state === 'denied' && (
          <>
            <p className="text-sm font-medium">Notifications are blocked on this device</p>
            <p className="text-[13px] text-muted">This feed still updates while the app is open.</p>
            <Link href="/app/account#notifications" className={buttonClass('secondary', 'sm', 'mt-2')}>
              How to fix this
            </Link>
          </>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className="-mr-1 -mt-1 grid size-11 shrink-0 place-items-center rounded-lg text-muted hover:text-text"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

export default function FeedPage() {
  const { start, setUnread, state } = useRealtime();
  const [symbol, setSymbol] = useState('');
  const symbols = useQuery({
    queryKey: ['symbols'],
    queryFn: () => api.get<{ symbols: { symbol: string }[] }>('/instruments/symbols'),
    staleTime: 300_000,
  });

  const feed = useInfiniteQuery({
    queryKey: ['feed', symbol],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => api.get<FeedPage>(`/feed${queryString({ limit: 30, before: pageParam, symbol })}`),
    getNextPageParam: (last) => (last.hasMore ? last.events[last.events.length - 1]?.seq : undefined),
    staleTime: 60_000,
  });

  const firstPage = feed.data?.pages[0];
  const head = firstPage?.headSeq;
  useEffect(() => {
    if (head !== undefined) start(head);
  }, [head, start]);

  const events = useMemo(() => {
    const seen = new Set<number>();
    const out: FeedEvent[] = [];
    for (const page of feed.data?.pages ?? []) {
      for (const event of page.events) {
        if (seen.has(event.seq)) continue;
        seen.add(event.seq);
        if (!symbol || event.payload.symbol === symbol) out.push(event);
      }
    }
    return out.sort((a, b) => b.seq - a.seq);
  }, [feed.data, symbol]);

  // Reading the feed clears the unread count, on this tab and on the server.
  const latest = events[0]?.seq;
  const lastMarked = useRef(0);
  useEffect(() => {
    const markRead = () => {
      if (latest === undefined || latest <= lastMarked.current || document.visibilityState !== 'visible') return;
      lastMarked.current = latest;
      setUnread(0);
      void api.post('/feed/read', { seq: latest }).catch(() => undefined);
    };
    markRead();
    // Something that arrived while this tab was in the background counts as read only once it is seen.
    document.addEventListener('visibilitychange', markRead);
    return () => document.removeEventListener('visibilitychange', markRead);
  }, [latest, setUnread]);

  const initialSeq = useRef<number | null>(null);
  if (initialSeq.current === null && latest !== undefined) initialSeq.current = latest;

  return (
    <>
      <PageHeader
        title="Feed"
        description={state === 'live' ? 'New signals and updates appear here by themselves.' : undefined}
        action={
          (symbols.data?.symbols.length ?? 0) > 1 ? (
            <div className="w-40">
              <label htmlFor="feed-symbol" className="sr-only">
                Filter by instrument
              </label>
              <Select id="feed-symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                <option value="">All instruments</option>
                {symbols.data?.symbols.map((s) => (
                  <option key={s.symbol} value={s.symbol}>
                    {s.symbol}
                  </option>
                ))}
              </Select>
            </div>
          ) : undefined
        }
      />
      <PushPrompt />
      {feed.isPending && <Loading rows={4} label="Loading the feed" />}
      {feed.isError && <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />}
      {feed.isSuccess && events.length === 0 && (
        <EmptyState
          icon={<Inbox className="size-5" aria-hidden />}
          title={symbol ? `Nothing for ${symbol} yet` : 'No signals yet'}
        >
          When a signal is published it will appear here straight away. There is no need to refresh.
        </EmptyState>
      )}
      <div className="flex flex-col gap-3">
        {groupByTrade(events).map((group) => (
          <div key={group[0]?.seq} className="flex flex-col gap-1.5">
            {group.map((event) => (
              <FeedCard
                key={event.seq}
                event={event}
                fresh={initialSeq.current !== null && event.seq > initialSeq.current}
              />
            ))}
          </div>
        ))}
      </div>
      {feed.hasNextPage && (
        <div className="mt-4 text-center">
          <Button loading={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
            Show older
          </Button>
        </div>
      )}
    </>
  );
}
