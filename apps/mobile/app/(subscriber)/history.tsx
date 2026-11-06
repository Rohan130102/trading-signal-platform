import {
  CLOSE_REASON_LABELS,
  formatDateTime,
  type HistoryPage,
  signedPoints,
  STATUS_LABELS,
  type TradeStatus,
} from '@signaldesk/domain';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, queryString } from '@/lib/api';
import { DirectionBadge, StatusBadge } from '@/trade';
import { useColors } from '@/theme';
import { radius, space } from '@/theme/tokens';
import { Chip, ChipRow, EmptyState, ErrorState, Field, Loading, PageTitle, Refresh, T, useRefresh } from '@/ui';

const STATUSES: TradeStatus[] = ['CLOSED', 'CANCELLED', 'EXPIRED', 'ACTIVE', 'PARTIALLY_CLOSED', 'PUBLISHED'];

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [ms, value]);
  return settled;
}

export default function History() {
  const c = useColors();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TradeStatus | ''>('');
  const [symbol, setSymbol] = useState('');
  const q = useDebounced(search.trim(), 300);
  const symbols = useQuery({
    queryKey: ['symbols'],
    queryFn: () => api.get<{ symbols: { symbol: string }[] }>('/instruments/symbols'),
    staleTime: 300_000,
  });
  const history = useInfiniteQuery({
    queryKey: ['history', q, status, symbol],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.get<HistoryPage>(`/trades/history${queryString({ q, status, symbol, page: pageParam, pageSize: 20 })}`),
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const trades = useMemo(() => history.data?.pages.flatMap((p) => p.trades) ?? [], [history.data]);
  const pull = useRefresh(useCallback(() => history.refetch(), [history]));
  const filtered = Boolean(q || status || symbol);
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]} edges={['top']}>
      <FlatList
        testID="history-list"
        data={trades}
        keyExtractor={(t) => t.id}
        style={styles.fill}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<Refresh {...pull} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (history.hasNextPage && !history.isFetchingNextPage) void history.fetchNextPage();
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            <PageTitle title="History" />
            <Field
              testID="history-search"
              label="Search by reference or instrument"
              value={search}
              onChangeText={setSearch}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="search"
            />
            <ChipRow>
              <Chip label="Any status" on={!status} onPress={() => setStatus('')} />
              {STATUSES.map((s) => (
                <Chip key={s} label={STATUS_LABELS[s]} on={status === s} onPress={() => setStatus(s)} />
              ))}
            </ChipRow>
            {(symbols.data?.symbols.length ?? 0) > 1 && (
              <ChipRow>
                <Chip label="Any instrument" on={!symbol} onPress={() => setSymbol('')} />
                {symbols.data?.symbols.map((s) => (
                  <Chip key={s.symbol} label={s.symbol} on={symbol === s.symbol} onPress={() => setSymbol(s.symbol)} />
                ))}
              </ChipRow>
            )}
          </View>
        }
        ListEmptyComponent={
          history.isPending ? (
            <Loading rows={3} label="Loading history" />
          ) : history.isError ? (
            <ErrorState error={history.error} onRetry={() => void history.refetch()} />
          ) : (
            <EmptyState icon="time-outline" title={filtered ? 'Nothing matches that' : 'No trades yet'}>
              {filtered ? 'Try fewer filters.' : 'Every signal stays here with its full record of changes.'}
            </EmptyState>
          )
        }
        ListFooterComponent={
          history.isFetchingNextPage ? (
            <ActivityIndicator color={c.muted} style={{ marginVertical: space.lg }} />
          ) : undefined
        }
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        renderItem={({ item }) => (
          <Pressable
            testID={`history-${item.ref}`}
            accessibilityRole="button"
            accessibilityLabel={`${item.direction} ${item.symbol}, ${STATUS_LABELS[item.status]}, reference ${item.ref}`}
            onPress={() => router.push(`/trades/${item.id}`)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: c.surface, borderColor: c.line },
              pressed && { opacity: 0.75 },
            ]}
          >
            <View style={styles.identity}>
              <DirectionBadge direction={item.direction} />
              <T v="strong">{item.symbol}</T>
              <StatusBadge status={item.status} />
              <View style={{ flexGrow: 1 }} />
              <T v="caption" c="subtle" num>
                {item.ref}
              </T>
            </View>
            <View style={styles.identity}>
              <T v="small" c="muted" num style={{ flexShrink: 1 }}>
                {formatDateTime(item.publishedAt)}
                {item.outcome?.reason ? ` · ${CLOSE_REASON_LABELS[item.outcome.reason]}` : ''}
              </T>
              <View style={{ flexGrow: 1 }} />
              {item.outcome?.weightedPoints && (
                <T v="small" num style={{ fontWeight: '600' }}>
                  {signedPoints(item.outcome.weightedPoints)}
                </T>
              )}
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { padding: space.lg, paddingBottom: space.xxl, flexGrow: 1 },
  header: { gap: space.md, marginBottom: space.md },
  row: { padding: space.md, gap: space.sm, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  identity: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
});
