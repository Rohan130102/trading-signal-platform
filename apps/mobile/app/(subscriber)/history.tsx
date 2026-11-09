import Ionicons from '@expo/vector-icons/Ionicons';
import {
  CLOSE_REASON_LABELS,
  filterToQuery,
  formatDateTime,
  type HistoryResponse,
  type HistoryRow,
  signedPoints,
  STATUS_LABELS,
} from '@signaldesk/domain';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FilterBar, useInstruments, useSavedFilter } from '@/filters';
import { api, queryString } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { DirectionBadge, StatusBadge } from '@/trade';
import { useColors } from '@/theme';
import { radius, space } from '@/theme/tokens';
import {
  ActionSheet,
  Badge,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  Loading,
  PageTitle,
  Refresh,
  T,
  ToggleRow,
  useRefresh,
  useToast,
} from '@/ui';

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [ms, value]);
  return settled;
}

/**
 * This subscriber's own history: signals of their membership, searchable, minus what they cleared. Paged by
 * the server, so a long record never loads all at once. Clearing changes nobody else's view and deletes nothing.
 */
export default function History() {
  const c = useColors();
  const router = useRouter();
  const client = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [hiddenOnly, setHiddenOnly] = useState(false);
  const [menuFor, setMenuFor] = useState<HistoryRow | null>(null);
  const q = useDebounced(search.trim(), 300);
  const instruments = useInstruments();
  const known = useMemo(() => instruments.data?.map((i) => i.symbol), [instruments.data]);
  const { filter, setFilter, loaded } = useSavedFilter('history-filter', known);

  const history = useInfiniteQuery({
    queryKey: ['history', q, filter, hiddenOnly],
    enabled: loaded,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      const { status, ...rest } = filterToQuery(filter);
      return api.get<HistoryResponse>(
        `/trades/history${queryString({ q, ...rest, group: status, visibility: hiddenOnly ? 'HIDDEN' : 'SHOWN', page: pageParam, pageSize: 20 })}`,
      );
    },
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const trades = useMemo(() => history.data?.pages.flatMap((p) => p.trades) ?? [], [history.data]);
  const pull = useRefresh(useCallback(() => history.refetch(), [history]));
  const filtered = Boolean(q) || hiddenOnly || trades.length !== history.data?.pages[0]?.total;

  const reload = useCallback(() => {
    void client.invalidateQueries({ queryKey: ['history'] });
    void client.invalidateQueries({ queryKey: ['signals'] });
  }, [client]);
  const clearAll = useCallback(
    () =>
      Alert.alert(
        'Clear your history?',
        'Finished signals leave your History and Signals. Live signals stay. Nothing is deleted, and only your own view changes.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Clear',
            style: 'destructive',
            onPress: () =>
              void api
                .post<{ cleared: number }>('/me/history/clear', { confirm: true })
                .then((r) => {
                  haptics.notify('success');
                  toast({ tone: 'success', title: r.cleared === 0 ? 'Nothing to clear' : `${r.cleared} cleared` });
                  reload();
                })
                .catch((error: Error) => toast({ tone: 'error', title: 'That did not work', body: error.message })),
          },
        ],
      ),
    [reload, toast],
  );
  const restoreAll = useCallback(
    () =>
      void api
        .post<{ restored: number }>('/me/history/restore', {})
        .then((r) => {
          haptics.notify('success');
          toast({ tone: 'success', title: `${r.restored} brought back` });
          setHiddenOnly(false);
          reload();
        })
        .catch((error: Error) => toast({ tone: 'error', title: 'That did not work', body: error.message })),
    [reload, toast],
  );

  const show = useCallback(
    (row: HistoryRow) =>
      void api
        .delete(`/me/hidden/TRADE/${row.id}`)
        .then(() => {
          haptics.notify('success');
          toast({ tone: 'success', title: `${row.symbol} is back in your Signals` });
          void client.invalidateQueries({ queryKey: ['history'] });
          void client.invalidateQueries({ queryKey: ['signals'] });
        })
        .catch((error: Error) => toast({ tone: 'error', title: 'That did not work', body: error.message })),
    [client, toast],
  );

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
            <PageTitle
              title="History"
              right={
                hiddenOnly ? (
                  <Button
                    testID="history-restore"
                    small
                    label="Bring all back"
                    icon="eye-outline"
                    onPress={restoreAll}
                  />
                ) : (
                  <Button testID="history-clear" small label="Clear" icon="trash-outline" onPress={clearAll} />
                )
              }
            />
            <Field
              testID="history-search"
              label="Search by reference or instrument"
              value={search}
              onChangeText={setSearch}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="search"
            />
            <FilterBar
              value={filter}
              onChange={setFilter}
              instruments={instruments.data ?? []}
              extraCount={hiddenOnly ? 1 : 0}
              extraChips={
                hiddenOnly ? (
                  <Chip icon="close" label="Cleared or hidden by me" on onPress={() => setHiddenOnly(false)} />
                ) : undefined
              }
              sheetExtra={
                <ToggleRow
                  testID="hidden-only"
                  label="Only what I cleared or hid"
                  hint="Trades you cleared or hid from your Signals list."
                  value={hiddenOnly}
                  onChange={setHiddenOnly}
                />
              }
            />
          </View>
        }
        ListEmptyComponent={
          history.isPending ? (
            <Loading rows={3} label="Loading history" />
          ) : history.isError ? (
            <ErrorState error={history.error} onRetry={() => void history.refetch()} />
          ) : (
            <EmptyState icon="time-outline" title={filtered ? 'Nothing matches that' : 'No trades yet'}>
              {hiddenOnly
                ? 'You have not cleared or hidden any trades.'
                : filtered
                  ? 'Try fewer filters.'
                  : 'Signals from your membership stay here with their full record of changes.'}
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
            accessibilityLabel={`${item.direction} ${item.symbol}, ${STATUS_LABELS[item.status]}, reference ${item.ref}${item.hidden ? ', hidden by you' : ''}${item.archived ? ', archived' : ''}`}
            onPress={() => router.push(`/trades/${item.id}`)}
            onLongPress={() => item.hidden && setMenuFor(item)}
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
              {item.hidden && (
                <Badge tone="neutral" icon="eye-off-outline">
                  Hidden
                </Badge>
              )}
              {item.archived && (
                <Badge tone="neutral" icon="archive-outline">
                  Archived
                </Badge>
              )}
              <View style={{ flexGrow: 1 }} />
              {item.hidden ? (
                <Pressable
                  testID={`history-menu-${item.ref}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Actions for ${item.symbol}`}
                  onPress={() => setMenuFor(item)}
                  style={styles.menu}
                >
                  <Ionicons name="ellipsis-horizontal" size={18} color={c.muted} />
                </Pressable>
              ) : (
                <T v="caption" c="subtle" num>
                  {item.ref}
                </T>
              )}
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
      <ActionSheet
        visible={menuFor !== null}
        title={menuFor ? `${menuFor.symbol} · ${menuFor.ref}` : ''}
        onClose={() => setMenuFor(null)}
        actions={
          menuFor
            ? [
                {
                  label: 'Show in Signals again',
                  icon: 'eye-outline',
                  testID: 'action-show',
                  onPress: () => show(menuFor),
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
  row: { padding: space.md, gap: space.sm, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  identity: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  menu: { width: 44, height: 36, alignItems: 'center', justifyContent: 'center', marginVertical: -8 },
});
