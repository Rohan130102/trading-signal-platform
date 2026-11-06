import { type AdminTradesPage, LIVE_STATUSES } from '@signaldesk/domain';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TradeRow } from '@/admin/parts';
import { api, queryString } from '@/lib/api';
import { useColors } from '@/theme';
import { space } from '@/theme/tokens';
import { Chip, ChipRow, EmptyState, ErrorState, Field, Loading, PageTitle, Refresh, useRefresh } from '@/ui';

type View_ = 'live' | 'all' | 'CLOSED';

export default function Desk() {
  const c = useColors();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [view, setView] = useState<View_>('live');
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const trades = useInfiniteQuery({
    queryKey: ['admin', 'trades', q, view],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.get<AdminTradesPage>(
        `/admin/trades${queryString({
          q,
          live: view === 'live' ? 'true' : undefined,
          status: view === 'CLOSED' ? 'CLOSED' : undefined,
          page: pageParam,
          pageSize: 25,
        })}`,
      ),
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const rows = useMemo(() => trades.data?.pages.flatMap((p) => p.trades) ?? [], [trades.data]);
  const pull = useRefresh(useCallback(() => trades.refetch(), [trades]));
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]} edges={['top']}>
      <FlatList
        testID="trades-list"
        data={rows}
        keyExtractor={(t) => t.id}
        style={styles.fill}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<Refresh {...pull} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (trades.hasNextPage && !trades.isFetchingNextPage) void trades.fetchNextPage();
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            <PageTitle title="Trades" />
            <Field
              testID="trades-search"
              label="Search by reference or instrument"
              value={search}
              onChangeText={setSearch}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="search"
            />
            <ChipRow>
              <Chip testID="trades-live" label="Live" on={view === 'live'} onPress={() => setView('live')} />
              <Chip testID="trades-all" label="All" on={view === 'all'} onPress={() => setView('all')} />
              <Chip testID="trades-closed" label="Closed" on={view === 'CLOSED'} onPress={() => setView('CLOSED')} />
            </ChipRow>
          </View>
        }
        ListEmptyComponent={
          trades.isPending ? (
            <Loading rows={3} label="Loading trades" />
          ) : trades.isError ? (
            <ErrorState error={trades.error} onRetry={() => void trades.refetch()} />
          ) : (
            <EmptyState icon="trending-up" title={view === 'live' ? 'Nothing live' : 'No trades here'}>
              {view === 'live'
                ? `Trades in ${LIVE_STATUSES.length} live states appear here. Publish a signal to start.`
                : 'Try another filter.'}
            </EmptyState>
          )
        }
        ListFooterComponent={
          trades.isFetchingNextPage ? (
            <ActivityIndicator color={c.muted} style={{ marginVertical: space.lg }} />
          ) : undefined
        }
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        renderItem={({ item }) => <TradeRow trade={item} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { padding: space.lg, paddingBottom: space.xxl, flexGrow: 1 },
  header: { gap: space.md, marginBottom: space.md },
});
