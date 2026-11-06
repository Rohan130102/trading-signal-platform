import type { TradeSummary } from '@signaldesk/domain';
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { TradeCard } from '@/trade';
import { useColors } from '@/theme';
import { space } from '@/theme/tokens';
import { ConnectionBanner, EmptyState, ErrorState, Loading, PageTitle, Refresh, useRefresh } from '@/ui';

export default function Active() {
  const c = useColors();
  const trades = useQuery({
    queryKey: ['active'],
    queryFn: () => api.get<{ trades: TradeSummary[] }>('/trades/active'),
  });
  const pull = useRefresh(useCallback(() => trades.refetch(), [trades]));
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]} edges={['top']}>
      <FlatList
        testID="active-list"
        data={trades.data?.trades ?? []}
        keyExtractor={(t) => t.id}
        style={styles.fill}
        contentContainerStyle={styles.list}
        refreshControl={<Refresh {...pull} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <PageTitle title="Active" subtitle="Trades awaiting entry or still open." />
            <ConnectionBanner />
          </View>
        }
        ListEmptyComponent={
          trades.isPending ? (
            <Loading rows={2} label="Loading active trades" />
          ) : trades.isError ? (
            <ErrorState error={trades.error} onRetry={() => void trades.refetch()} />
          ) : (
            <EmptyState icon="trending-up" title="No active trades">
              Signals you can still act on appear here, with their current stop-loss and targets.
            </EmptyState>
          )
        }
        ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        renderItem={({ item }) => <TradeCard trade={item} href={`/trades/${item.id}`} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { padding: space.lg, paddingBottom: space.xxl, flexGrow: 1 },
  header: { gap: space.md, marginBottom: space.md },
});
