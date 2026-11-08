import { countActiveFilters, filterToQuery, type SignalCard as Card, type SignalsPage } from '@signaldesk/domain';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FilterBar, useInstruments, useSavedFilter } from '@/filters';
import { api, queryString } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { enablePush, readPushStatus } from '@/lib/push';
import { useRealtime } from '@/lib/realtime';
import { prefs } from '@/lib/storage';
import { SignalCard } from '@/trade/SignalCard';
import { useColors } from '@/theme';
import { space } from '@/theme/tokens';
import {
  ActionSheet,
  Button,
  Card as Panel,
  ConnectionBanner,
  EmptyState,
  ErrorState,
  LivePill,
  Loading,
  PageTitle,
  Refresh,
  T,
  useRefresh,
  useToast,
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
    <Panel testID="push-prompt" style={{ gap: space.sm }}>
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
    </Panel>
  );
}

export default function Signals() {
  const c = useColors();
  const client = useQueryClient();
  const toast = useToast();
  const { start, setUnread } = useRealtime();
  const instruments = useInstruments();
  const known = useMemo(() => instruments.data?.map((i) => i.symbol), [instruments.data]);
  const { filter, setFilter, loaded } = useSavedFilter('signals-filter', known);
  const [menuFor, setMenuFor] = useState<Card | null>(null);

  const signals = useInfiniteQuery({
    queryKey: ['signals', filter],
    enabled: loaded,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      api.get<SignalsPage>(`/signals${queryString({ ...filterToQuery(filter), limit: 20, before: pageParam })}`),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    staleTime: 30_000,
  });

  const first = signals.data?.pages[0];
  useEffect(() => {
    if (!first) return;
    if (start(first.headSeq)) setUnread(first.unread);
  }, [first, setUnread, start]);

  const cards = useMemo(() => {
    const seen = new Set<string>();
    const out: Card[] = [];
    for (const page of signals.data?.pages ?? []) {
      for (const card of page.cards) {
        if (seen.has(card.id)) continue;
        seen.add(card.id);
        out.push(card);
      }
    }
    return out;
  }, [signals.data]);

  const pull = useRefresh(useCallback(() => signals.refetch(), [signals]));
  const filtered = countActiveFilters(filter) > 0;

  const setHidden = useCallback(
    async (card: Card, hidden: boolean) => {
      if (hidden) await api.post('/me/hidden', { type: 'TRADE', id: card.id });
      else await api.delete(`/me/hidden/TRADE/${card.id}`);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['signals'] }),
        client.invalidateQueries({ queryKey: ['history'] }),
        client.invalidateQueries({ queryKey: ['trade', card.id] }),
      ]);
    },
    [client],
  );

  const hide = useCallback(
    (card: Card) => {
      void setHidden(card, true)
        .then(() => {
          haptics.notify('success');
          toast({
            tone: 'info',
            title: `${card.symbol} hidden from Signals`,
            body: 'Only for you. Alerts still arrive, and it stays in History.',
            duration: 6000,
            action: { label: 'Undo', onPress: () => void setHidden(card, false).catch(() => undefined) },
          });
        })
        .catch((error: Error) => toast({ tone: 'error', title: 'Could not hide it', body: error.message }));
    },
    [setHidden, toast],
  );

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]} edges={['top']}>
      <FlatList
        testID="feed-list"
        data={cards}
        keyExtractor={(card) => card.id}
        style={styles.fill}
        contentContainerStyle={styles.list}
        refreshControl={<Refresh {...pull} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (signals.hasNextPage && !signals.isFetchingNextPage) void signals.fetchNextPage();
        }}
        initialNumToRender={6}
        windowSize={7}
        removeClippedSubviews
        ListHeaderComponent={
          <View style={styles.header}>
            <PageTitle title="Signals" right={<LivePill />} />
            <ConnectionBanner />
            <PushPrompt />
            <FilterBar value={filter} onChange={setFilter} instruments={instruments.data ?? []} />
          </View>
        }
        ListEmptyComponent={
          signals.isPending ? (
            <Loading rows={3} label="Loading signals" />
          ) : signals.isError ? (
            <ErrorState error={signals.error} onRetry={() => void signals.refetch()} />
          ) : (
            <EmptyState icon="pulse" title={filtered ? 'Nothing matches these filters' : 'No signals yet'}>
              {filtered
                ? 'Try fewer filters, or reset them.'
                : 'When a signal is published it appears here straight away. Every later change stays attached to it.'}
            </EmptyState>
          )
        }
        ListFooterComponent={
          signals.isFetchingNextPage ? (
            <ActivityIndicator color={c.muted} style={{ marginVertical: space.lg }} />
          ) : filtered && cards.length > 0 ? (
            <Button
              label="Reset filters"
              variant="ghost"
              small
              onPress={() => setFilter({ symbols: [], direction: null, status: 'ALL' })}
            />
          ) : undefined
        }
        ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        renderItem={({ item }) => <SignalCard card={item} onMenu={setMenuFor} />}
      />
      <ActionSheet
        visible={menuFor !== null}
        title={menuFor ? `${menuFor.direction === 'BUY' ? 'Buy' : 'Sell'} ${menuFor.symbol}` : ''}
        subtitle={menuFor?.ref}
        onClose={() => setMenuFor(null)}
        actions={
          menuFor
            ? [
                {
                  label: 'Hide from Signals',
                  icon: 'eye-off-outline',
                  hint: 'Only for you. It stays in History, and alerts still arrive.',
                  testID: 'action-hide',
                  onPress: () => hide(menuFor),
                },
              ]
            : []
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { padding: space.lg, paddingBottom: space.xxl, flexGrow: 1 },
  header: { gap: space.md, marginBottom: space.md },
});
