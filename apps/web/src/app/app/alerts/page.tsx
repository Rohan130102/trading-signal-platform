'use client';

import type { FeedEvent, FeedPage } from '@signaldesk/domain';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FeedCard } from '@/components/trade';
import { InstrumentPicker } from '@/components/instrument-picker';
import { PushPrompt } from '@/components/subscriber/push-prompt';
import { Button, EmptyState, ErrorState, Loading, PageHeader } from '@/components/ui';
import { api, queryString } from '@/lib/api';
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

export default function AlertsPage() {
  const { start, setUnread } = useRealtime();
  const [symbol, setSymbolState] = useState('');
  useEffect(() => {
    try {
      setSymbolState(localStorage.getItem('sd-feed-symbol') ?? '');
    } catch {
      // Private mode or blocked storage: start from all instruments.
    }
  }, []);
  const setSymbol = (next: string) => {
    setSymbolState(next);
    try {
      localStorage.setItem('sd-feed-symbol', next);
    } catch {
      // See above.
    }
  };
  const symbols = useQuery({
    queryKey: ['symbols'],
    queryFn: () =>
      api.get<{ symbols: { symbol: string; displayName: string; exchange: string | null; archived: boolean }[] }>(
        '/instruments/symbols',
      ),
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
        title="Alerts"
        description="Everything sent to you, newest first. New ones appear here by themselves."
        action={
          (symbols.data?.symbols.length ?? 0) > 1 ? (
            <InstrumentPicker value={symbol} onChange={setSymbol} instruments={symbols.data?.symbols ?? []} />
          ) : undefined
        }
      />
      <PushPrompt />
      {feed.isPending && <Loading rows={4} label="Loading the feed" />}
      {feed.isError && <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />}
      {feed.isSuccess && events.length === 0 && (
        <EmptyState
          icon={<Inbox className="size-5" aria-hidden />}
          title={symbol ? `Nothing for ${symbol} yet` : 'No alerts yet'}
        >
          New signals and updates will appear here.
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
