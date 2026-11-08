import Ionicons from '@expo/vector-icons/Ionicons';
import type { InstrumentRow } from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { useColors } from '@/theme';
import { radius, space } from '@/theme/tokens';
import {
  ActionSheet,
  Badge,
  EmptyState,
  ErrorState,
  errorMessage,
  Field,
  Loading,
  Refresh,
  Segmented,
  T,
  useRefresh,
  useToast,
} from '@/ui';

type View_ = 'ACTIVE' | 'OFF' | 'ARCHIVED' | 'ALL';
const VIEWS: readonly { value: View_; label: string }[] = [
  { value: 'ACTIVE', label: 'On' },
  { value: 'OFF', label: 'Off' },
  { value: 'ARCHIVED', label: 'Archived' },
  { value: 'ALL', label: 'All' },
];
type Sort = 'ORDER' | 'SYMBOL' | 'TRADES';

/**
 * Instruments without code changes. Switching one off or archiving it never touches its trades: each
 * published trade keeps the configuration it was published with.
 */
export default function Instruments() {
  const c = useColors();
  const router = useRouter();
  const client = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState<View_>('ACTIVE');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('ORDER');
  const [menuFor, setMenuFor] = useState<InstrumentRow | null>(null);
  const list = useQuery({
    queryKey: ['admin', 'instruments'],
    queryFn: () => api.get<{ instruments: InstrumentRow[] }>('/admin/instruments'),
    select: (data) => data.instruments,
  });
  const pull = useRefresh(useCallback(() => list.refetch(), [list]));

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = (list.data ?? []).filter((i) => {
      if (view === 'ACTIVE' && (!i.active || i.archivedAt)) return false;
      if (view === 'OFF' && (i.active || i.archivedAt)) return false;
      if (view === 'ARCHIVED' && !i.archivedAt) return false;
      if (!q) return true;
      return [i.symbol, i.displayName, i.exchange ?? '', i.assetClass].some((v) => v.toLowerCase().includes(q));
    });
    return [...filtered].sort((a, b) =>
      sort === 'SYMBOL'
        ? a.symbol.localeCompare(b.symbol)
        : sort === 'TRADES'
          ? b.tradeCount - a.tradeCount
          : a.sortOrder - b.sortOrder || a.symbol.localeCompare(b.symbol),
    );
  }, [list.data, query, sort, view]);

  const act = useMutation({
    mutationFn: async ({ row, action }: { row: InstrumentRow; action: 'on' | 'off' | 'archive' | 'restore' }) => {
      if (action === 'archive') return api.post(`/admin/instruments/${row.id}/archive`);
      if (action === 'restore') return api.post(`/admin/instruments/${row.id}/restore`);
      const { id: _i, archivedAt: _a, tradeCount: _t, ...spec } = row;
      return api.put(`/admin/instruments/${row.id}`, { ...spec, active: action === 'on' });
    },
    onSuccess: (_data, { row, action }) => {
      haptics.notify('success');
      toast({
        tone: 'success',
        title:
          action === 'archive'
            ? `${row.symbol} archived`
            : action === 'restore'
              ? `${row.symbol} restored, still switched off`
              : `${row.symbol} switched ${action}`,
      });
      void client.invalidateQueries({ queryKey: ['admin', 'instruments'] });
      void client.invalidateQueries({ queryKey: ['symbols'] });
    },
    onError: (error) => toast({ tone: 'error', title: 'That did not work', body: errorMessage(error) }),
  });

  const archive = (row: InstrumentRow) =>
    Alert.alert(
      `Archive ${row.symbol}?`,
      `It can no longer be used for new signals and disappears from filters once it has no trades. Its ${row.tradeCount} published trades keep their full history. You can restore it later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Archive', style: 'destructive', onPress: () => act.mutate({ row, action: 'archive' }) },
      ],
    );

  return (
    <View style={[styles.fill, { backgroundColor: c.bg }]}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              testID="instrument-add"
              accessibilityRole="button"
              accessibilityLabel="Add an instrument"
              onPress={() => router.push('/admin/instrument')}
              style={styles.headerButton}
            >
              <Ionicons name="add" size={26} color={c.text} />
            </Pressable>
          ),
        }}
      />
      <FlatList
        testID="instrument-list"
        data={rows}
        keyExtractor={(row) => row.id}
        contentContainerStyle={styles.list}
        refreshControl={<Refresh {...pull} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          <View style={styles.header}>
            <Segmented label="Show" options={VIEWS} value={view} onChange={setView} />
            <Field
              label="Search"
              testID="instrument-filter"
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="characters"
            />
            <Segmented
              label="Sort by"
              options={[
                { value: 'ORDER', label: 'Display order' },
                { value: 'SYMBOL', label: 'Symbol' },
                { value: 'TRADES', label: 'Most used' },
              ]}
              value={sort}
              onChange={setSort}
            />
          </View>
        }
        ListEmptyComponent={
          list.isPending ? (
            <Loading rows={3} label="Loading instruments" />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : (
            <EmptyState icon="layers-outline" title={query ? 'Nothing matches' : 'Nothing here'}>
              {query ? 'Try another search.' : 'Add an instrument with the + button.'}
            </EmptyState>
          )
        }
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        renderItem={({ item }) => (
          <Pressable
            testID={`instrument-row-${item.symbol}`}
            accessibilityRole="button"
            accessibilityLabel={`${item.symbol}, ${item.displayName}. ${item.archivedAt ? 'Archived' : item.active ? 'On' : 'Off'}. ${item.tradeCount} trades.`}
            onPress={() => router.push(`/admin/instrument?id=${item.id}`)}
            onLongPress={() => setMenuFor(item)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: c.surface, borderColor: c.line, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <View style={styles.flex}>
              <View style={styles.line}>
                <T v="strong">{item.symbol}</T>
                {item.archivedAt ? (
                  <Badge tone="neutral" icon="archive-outline">
                    Archived
                  </Badge>
                ) : item.active ? (
                  <Badge tone="success">On</Badge>
                ) : (
                  <Badge tone="neutral">Off</Badge>
                )}
              </View>
              <T v="small" c="muted" numberOfLines={1}>
                {[item.displayName, item.exchange, item.assetClass.toLowerCase()].filter(Boolean).join(' · ')}
              </T>
              <T v="caption" c="subtle" num>
                {item.tradeCount} published trade{item.tradeCount === 1 ? '' : 's'} · order {item.sortOrder}
              </T>
            </View>
            <Pressable
              testID={`instrument-menu-${item.symbol}`}
              accessibilityRole="button"
              accessibilityLabel={`More actions for ${item.symbol}`}
              onPress={() => setMenuFor(item)}
              style={styles.menu}
            >
              <Ionicons name="ellipsis-horizontal" size={20} color={c.muted} />
            </Pressable>
          </Pressable>
        )}
      />
      <ActionSheet
        visible={menuFor !== null}
        title={menuFor ? `${menuFor.symbol} · ${menuFor.displayName}` : ''}
        onClose={() => setMenuFor(null)}
        actions={
          menuFor
            ? [
                {
                  label: 'Edit',
                  icon: 'create-outline',
                  onPress: () => router.push(`/admin/instrument?id=${menuFor.id}`),
                },
                ...(!menuFor.archivedAt
                  ? [
                      {
                        label: menuFor.active ? 'Switch off' : 'Switch on',
                        icon: (menuFor.active ? 'pause-circle-outline' : 'play-circle-outline') as never,
                        hint: menuFor.active ? 'No new signals until switched on again.' : undefined,
                        onPress: () => act.mutate({ row: menuFor, action: menuFor.active ? 'off' : 'on' }),
                      },
                      {
                        label: 'Archive',
                        icon: 'archive-outline' as never,
                        danger: true,
                        testID: 'instrument-archive',
                        onPress: () => archive(menuFor),
                      },
                    ]
                  : [
                      {
                        label: 'Restore',
                        icon: 'arrow-undo-outline' as never,
                        testID: 'instrument-restore',
                        onPress: () => act.mutate({ row: menuFor, action: 'restore' }),
                      },
                    ]),
                {
                  label: 'View its trades',
                  icon: 'time-outline',
                  hint: `${menuFor.tradeCount} published`,
                  onPress: () => router.push(`/admin/history?symbol=${encodeURIComponent(menuFor.symbol)}`),
                },
              ]
            : []
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { padding: space.lg, paddingBottom: space.xxl, flexGrow: 1 },
  header: { gap: space.md, marginBottom: space.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  menu: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
