import Ionicons from '@expo/vector-icons/Ionicons';
import { type AdminTradesPage, formatDateTime, STATUS_LABELS } from '@signaldesk/domain';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, queryString } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { DirectionBadge } from '@/trade';
import { useColors } from '@/theme';
import { radius, space } from '@/theme/tokens';
import {
  Button,
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  errorMessage,
  Loading,
  Notice,
  Refresh,
  Segmented,
  T,
  useRefresh,
  useToast,
} from '@/ui';

type Tab = 'FINISHED' | 'ARCHIVED';
const AGES = [
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year', days: 365 },
] as const;

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Tidying the subscribers' Signals list. Only finished trades can be archived; they stay in History with
 * every update. Published trades are never deleted, because the history of what was sent must stay
 * complete and honest.
 */
export default function ManageHistory() {
  const c = useColors();
  const router = useRouter();
  const client = useQueryClient();
  const toast = useToast();
  const { symbol } = useLocalSearchParams<{ symbol?: string }>();
  const [tab, setTab] = useState<Tab>('FINISHED');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const list = useInfiniteQuery({
    queryKey: ['admin', 'trades', 'archive', tab, symbol ?? ''],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.get<AdminTradesPage>(
        `/admin/trades${queryString({
          group: 'CLOSED',
          archived: tab === 'ARCHIVED' ? 'ARCHIVED' : 'NOT_ARCHIVED',
          symbols: symbol,
          page: pageParam,
          pageSize: 30,
        })}`,
      ),
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.trades) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  const pull = useRefresh(useCallback(() => list.refetch(), [list]));

  const done = (message: string) => {
    haptics.notify('success');
    toast({ tone: 'success', title: message });
    setSelected(new Set());
    void client.invalidateQueries({ queryKey: ['admin', 'trades'] });
    void client.invalidateQueries({ queryKey: ['signals'] });
    void client.invalidateQueries({ queryKey: ['history'] });
  };
  const fail = (error: unknown) => {
    haptics.notify('error');
    toast({ tone: 'error', title: 'Nothing was changed', body: errorMessage(error) });
    void list.refetch();
  };

  const archive = useMutation({
    mutationFn: (ids: string[]) =>
      api.post<{ archived: number }>('/admin/trade-archive', { tradeIds: ids, expectedCount: ids.length }),
    onSuccess: (r) => done(`${r.archived} archived`),
    onError: fail,
  });
  const restore = useMutation({
    mutationFn: (ids: string[]) => api.post<{ restored: number }>('/admin/trade-archive/restore', { tradeIds: ids }),
    onSuccess: (r) => done(`${r.restored} back in the Signals list`),
    onError: fail,
  });
  const archiveBefore = useMutation({
    mutationFn: async (days: number) => {
      const before = isoDaysAgo(days);
      const { count } = await api.get<{ count: number }>(`/admin/trade-archive/preview?before=${before}`);
      return { before, count, days };
    },
    onSuccess: ({ before, count, days }) => {
      if (count === 0) {
        toast({ tone: 'info', title: `Nothing finished more than ${days} days ago to archive` });
        return;
      }
      Alert.alert(
        `Archive ${count} finished trade${count === 1 ? '' : 's'}?`,
        `Every trade that finished before ${before}. They leave the Signals list and stay in History with every update. You can restore them.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: `Archive ${count}`,
            onPress: () =>
              void api
                .post<{ archived: number }>('/admin/trade-archive/before', { before, expectedCount: count })
                .then((r) => done(`${r.archived} archived`))
                .catch(fail),
          },
        ],
      );
    },
    onError: fail,
  });

  const ids = [...selected];
  const confirmSelected = () => {
    const n = ids.length;
    if (tab === 'ARCHIVED') {
      restore.mutate(ids);
      return;
    }
    Alert.alert(
      `Archive ${n} trade${n === 1 ? '' : 's'}?`,
      'They leave the Signals list and stay in History. You can restore them.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: `Archive ${n}`, onPress: () => archive.mutate(ids) },
      ],
    );
  };

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]} edges={['bottom']}>
      <FlatList
        testID="admin-history"
        data={rows}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        refreshControl={<Refresh {...pull} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            <Notice tone="neutral" icon="shield-checkmark-outline" title="Nothing published is deleted">
              Archiving moves finished trades out of the subscribers' Signals list. Each keeps its full timeline in
              History. Live trades cannot be archived.
            </Notice>
            <Segmented
              label="Show"
              options={[
                { value: 'FINISHED', label: 'Finished', testID: 'history-tab-finished' },
                { value: 'ARCHIVED', label: 'Archived', testID: 'history-tab-archived' },
              ]}
              value={tab}
              onChange={(v) => {
                setTab(v);
                setSelected(new Set());
              }}
            />
            {symbol ? (
              <ChipRow>
                <Chip icon="close" label={symbol} on onPress={() => router.setParams({ symbol: undefined })} />
              </ChipRow>
            ) : null}
            {tab === 'FINISHED' && (
              <View style={{ gap: space.sm }}>
                <T v="small" c="muted">
                  Archive everything that finished more than
                </T>
                <ChipRow>
                  {AGES.map((a) => (
                    <Chip
                      key={a.days}
                      testID={`archive-older-${a.days}`}
                      label={`${a.label} ago`}
                      onPress={() => archiveBefore.mutate(a.days)}
                    />
                  ))}
                </ChipRow>
              </View>
            )}
            <T v="caption" c="subtle">
              {total} {tab === 'ARCHIVED' ? 'archived' : 'finished, not archived'}
            </T>
          </View>
        }
        ListEmptyComponent={
          list.isPending ? (
            <Loading rows={3} label="Loading trades" />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : (
            <EmptyState
              icon="archive-outline"
              title={tab === 'ARCHIVED' ? 'Nothing archived' : 'No finished trades to archive'}
            />
          )
        }
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <ActivityIndicator color={c.muted} style={{ marginVertical: space.lg }} />
          ) : undefined
        }
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        renderItem={({ item }) => {
          const on = selected.has(item.id);
          return (
            <Pressable
              testID={`archive-row-${item.ref}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${item.direction} ${item.symbol}, ${STATUS_LABELS[item.status]}, ${item.ref}`}
              onPress={() => {
                haptics.selection();
                setSelected((s) => {
                  const next = new Set(s);
                  if (next.has(item.id)) next.delete(item.id);
                  else next.add(item.id);
                  return next;
                });
              }}
              onLongPress={() => router.push(`/admin/trades/${item.id}`)}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: c.surface, borderColor: on ? c.primary : c.line, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <View
                style={[
                  styles.check,
                  { borderColor: on ? c.primary : c.lineStrong, backgroundColor: on ? c.primary : 'transparent' },
                ]}
              >
                {on && <Ionicons name="checkmark" size={16} color={c.primaryText} />}
              </View>
              <View style={styles.flex}>
                <View style={styles.line}>
                  <DirectionBadge direction={item.direction} />
                  <T v="strong">{item.symbol}</T>
                  <T v="small" c="muted">
                    {STATUS_LABELS[item.status]}
                  </T>
                </View>
                <T v="caption" c="subtle" num>
                  {item.ref} ·{' '}
                  {item.closedAt
                    ? `finished ${formatDateTime(item.closedAt)}`
                    : `published ${formatDateTime(item.publishedAt)}`}
                  {item.archivedAt ? ` · archived ${formatDateTime(item.archivedAt)}` : ''}
                </T>
              </View>
            </Pressable>
          );
        }}
      />
      {selected.size > 0 && (
        <View style={[styles.bulkBar, { backgroundColor: c.surface, borderTopColor: c.line }]}>
          <T v="strong" style={styles.flex}>
            {selected.size} selected
          </T>
          <Button label="Clear" small variant="ghost" onPress={() => setSelected(new Set())} />
          <Button
            testID="archive-selected"
            label={tab === 'ARCHIVED' ? 'Restore' : 'Archive'}
            small
            variant="primary"
            loading={archive.isPending || restore.isPending}
            onPress={confirmSelected}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { padding: space.lg, paddingBottom: space.xxl, flexGrow: 1 },
  header: { gap: space.md, marginBottom: space.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 56,
  },
  check: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  bulkBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
