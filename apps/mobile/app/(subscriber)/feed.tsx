import { type FeedEvent, type FeedPage } from '@signaldesk/domain';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, queryString } from '@/lib/api';
import { enablePush, readPushStatus } from '@/lib/push';
import { useRealtime } from '@/lib/realtime';
import { prefs } from '@/lib/storage';
import { FeedCard } from '@/trade';
import { useColors } from '@/theme';
import { space } from '@/theme/tokens';
import {
  Button,
  Card,
  Chip,
  ChipRow,
  ConnectionBanner,
  EmptyState,
  ErrorState,
  LivePill,
  Loading,
  PageTitle,
  Refresh,
  T,
  useRefresh,
} from '@/ui';

/** Asks once, at a moment when the benefit is obvious. Never on first launch before anything is seen. */
function PushPrompt() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      const dismissed = await prefs.get<boolean>('push-prompt-dismissed');
      if (dismissed) return;
      const status = await readPushStatus().catch(() => null);
      if (active && status === 'ready') setShow(true);
    })();
    return () => {
      active = false;
    };
  }, []);
  if (!show) return null;
  const dismiss = () => {
    setShow(false);
    void prefs.set('push-prompt-dismissed', true);
  };
  return (
    <Card testID="push-prompt" style={{ gap: space.sm }}>
      <T v="strong">Get alerts on this phone</T>
      <T v="small" c="muted">
        Know about new signals and stop-loss changes without keeping the app open. Alerts can be delayed or missed by
        your phone or network, so check the app before acting.
      </T>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button
          label="Turn on"
          variant="primary"
          small
          loading={busy}
          onPress={() => {
            setBusy(true);
            void enablePush()
              .catch(() => undefined)
              .finally(() => {
                setBusy(false);
                dismiss();
              });
          }}
        />
        <Button label="Not now" variant="ghost" small onPress={dismiss} />
      </View>
    </Card>
  );
}

export default function Feed() {
  const c = useColors();
  const { start, setUnread } = useRealtime();
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

  const head = feed.data?.pages[0]?.headSeq;
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

  // Reading the feed clears the unread count, here and on the server.
  const latest = events[0]?.seq;
  const lastMarked = useRef(0);
  const markRead = useCallback(() => {
    setUnread(0);
    if (latest === undefined || latest <= lastMarked.current || AppState.currentState !== 'active') return;
    lastMarked.current = latest;
    void api.post('/feed/read', { seq: latest }).catch(() => undefined);
  }, [latest, setUnread]);
  useFocusEffect(markRead);

  const initialSeq = useRef<number | null>(null);
  if (initialSeq.current === null && latest !== undefined) initialSeq.current = latest;

  const pull = useRefresh(useCallback(() => feed.refetch(), [feed]));
  const symbolList = symbols.data?.symbols ?? [];

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]} edges={['top']}>
      <FlatList
        testID="feed-list"
        data={events}
        keyExtractor={(event) => String(event.seq)}
        contentContainerStyle={styles.list}
        refreshControl={<Refresh {...pull} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            <PageTitle title="Feed" right={<LivePill />} />
            <ConnectionBanner />
            <PushPrompt />
            {symbolList.length > 1 && (
              <ChipRow>
                <Chip testID="filter-all" label="All" on={!symbol} onPress={() => setSymbol('')} />
                {symbolList.map((s) => (
                  <Chip key={s.symbol} label={s.symbol} on={symbol === s.symbol} onPress={() => setSymbol(s.symbol)} />
                ))}
              </ChipRow>
            )}
          </View>
        }
        ListEmptyComponent={
          feed.isPending ? (
            <Loading rows={3} label="Loading the feed" />
          ) : feed.isError ? (
            <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />
          ) : (
            <EmptyState icon="pulse" title={symbol ? `Nothing for ${symbol} yet` : 'No signals yet'}>
              When a signal is published it appears here straight away. There is no need to refresh.
            </EmptyState>
          )
        }
        ListFooterComponent={
          feed.isFetchingNextPage ? (
            <ActivityIndicator color={c.muted} style={{ marginVertical: space.lg }} />
          ) : undefined
        }
        renderItem={({ item, index }) => {
          const previous = events[index - 1];
          const sameTrade = previous && item.tradeId && previous.tradeId === item.tradeId;
          return (
            <View style={{ marginTop: index === 0 ? 0 : sameTrade ? 6 : space.md }}>
              <FeedCard event={item} fresh={initialSeq.current !== null && item.seq > initialSeq.current} />
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { padding: space.lg, paddingBottom: space.xxl, flexGrow: 1 },
  header: { gap: space.md, marginBottom: space.md },
});
