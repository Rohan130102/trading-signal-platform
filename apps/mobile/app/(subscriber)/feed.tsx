import {
  countActiveFilters,
  filterToQuery,
  type SignalCard as Card,
  type SignalsPage,
  type StatusGroup,
  TITLES,
} from '@signaldesk/domain';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FilterBar, useInstruments, useSavedFilter } from '@/filters';
import { api, queryString } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { enablePush, readPushStatus } from '@/lib/push';
import { useRealtime } from '@/lib/realtime';
import { prefs } from '@/lib/storage';
import { Notices } from '@/subscriber/Notices';
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
  const { start, setUnread, onAlert } = useRealtime();
  const instruments = useInstruments();
  const known = useMemo(() => instruments.data?.map((i) => i.symbol), [instruments.data]);
  const { filter, setFilter, loaded } = useSavedFilter('signals-filter', known);
  const [menuFor, setMenuFor] = useState<Card | null>(null);
  const list = useRef<FlatList<Row>>(null);
  const scrolledDown = useRef(false);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const [newAbove, setNewAbove] = useState(0);

  // A signal published while this list is open is outlined and labelled New for a while (the banner and the
  // buzz come from the root layout). Scrolled down the list, a button offers to go up to it.
  useEffect(
    () =>
      onAlert((alert) => {
        if (alert.category !== 'NEW_SIGNAL' || !alert.tradeId) return;
        const id = alert.tradeId;
        setFresh((current) => new Set(current).add(id));
        if (scrolledDown.current) setNewAbove((n) => n + 1);
        setTimeout(() => {
          setFresh((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
          });
        }, FRESH_MS);
      }),
    [onAlert],
  );

  const signals = useInfiniteQuery({
    queryKey: ['signals', filter],
    enabled: loaded,
    initialPageParam: undefined as number | undefined,
    // Live trades only: a trade leaves Signals when it finishes and is in History straight away.
    queryFn: ({ pageParam }) =>
      api.get<SignalsPage>(
        `/signals${queryString({ ...filterToQuery({ ...filter, status: liveGroup(filter.status) }), limit: 20, before: pageParam })}`,
      ),
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

  // Active first, then upcoming, each under its own heading. Newest activity first within each.
  const rows = useMemo<Row[]>(() => {
    const active = cards.filter((card) => card.status === 'ACTIVE' || card.status === 'PARTIALLY_CLOSED');
    const upcoming = cards.filter((card) => card.status === 'PUBLISHED');
    return [
      ...(active.length > 0 ? [{ header: TITLES.active, count: active.length }] : []),
      ...active,
      ...(upcoming.length > 0 ? [{ header: TITLES.upcoming, count: upcoming.length }] : []),
      ...upcoming,
    ];
  }, [cards]);

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
        ref={list}
        testID="feed-list"
        data={rows}
        keyExtractor={(row) => ('header' in row ? `header-${row.header}` : row.id)}
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
        extraData={fresh}
        scrollEventThrottle={100}
        onScroll={(e) => {
          scrolledDown.current = e.nativeEvent.contentOffset.y > 240;
          if (!scrolledDown.current) setNewAbove(0);
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            <PageTitle title="Signals" right={<LivePill />} />
            <ConnectionBanner />
            <Notices />
            <PushPrompt />
            <FilterBar value={filter} onChange={setFilter} instruments={instruments.data ?? []} groups={LIVE_GROUPS} />
          </View>
        }
        ListEmptyComponent={
          signals.isPending ? (
            <Loading rows={3} label="Loading signals" />
          ) : signals.isError ? (
            <ErrorState error={signals.error} onRetry={() => void signals.refetch()} />
          ) : (
            <EmptyState icon="pulse" title={filtered ? 'Nothing matches these filters' : 'No Signals Yet'}>
              {filtered ? 'Try fewer filters, or reset them.' : 'New signals will appear here.'}
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
        ItemSeparatorComponent={() => <View style={{ height: space.sm + 2 }} />}
        renderItem={({ item }) =>
          'header' in item ? (
            <T v="label" c="muted" style={styles.section} accessibilityRole="header">
              {`${item.header.toUpperCase()}  ${item.count}`}
            </T>
          ) : (
            <SignalCard card={item} onMenu={setMenuFor} fresh={fresh.has(item.id)} />
          )
        }
      />
      {newAbove > 0 && (
        <Pressable
          testID="new-signals-above"
          accessibilityRole="button"
          accessibilityLabel={newAbove === 1 ? 'New signal. Go to the top.' : `${newAbove} new signals. Go to the top.`}
          onPress={() => {
            haptics.selection();
            setNewAbove(0);
            list.current?.scrollToOffset({ offset: 0, animated: true });
          }}
          style={({ pressed }) => [styles.above, { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 }]}
        >
          <Ionicons name="arrow-up" size={16} color={c.primaryText} />
          <T v="strong" style={{ color: c.primaryText }}>
            {newAbove === 1 ? 'New signal' : `${newAbove} new signals`}
          </T>
        </Pressable>
      )}
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

/** How long a newly arrived signal stays outlined. */
const FRESH_MS = 20_000;

type Row = Card | { header: string; count: number };

/** Signals offers live statuses only; anything else, such as an older saved filter, means all live trades. */
const LIVE_GROUPS: readonly StatusGroup[] = ['ALL', 'AWAITING', 'LIVE'];
function liveGroup(group: StatusGroup): StatusGroup {
  return group === 'AWAITING' || group === 'LIVE' ? group : 'OPEN';
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  above: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: space.lg,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  list: { padding: space.lg, paddingBottom: space.xxl, flexGrow: 1 },
  header: { gap: space.md, marginBottom: space.md },
  section: { marginTop: space.sm, letterSpacing: 0.6 },
});
