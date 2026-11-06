import { formatLocalDate, type SubscribersPage } from '@signaldesk/domain';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AccessBadge } from '@/admin/parts';
import { api, queryString } from '@/lib/api';
import { useColors } from '@/theme';
import { radius, space } from '@/theme/tokens';
import { Button, Chip, ChipRow, EmptyState, ErrorState, Field, Loading, PageTitle, Refresh, T, useRefresh } from '@/ui';

const FILTERS = [
  { value: '', label: 'Everyone' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'EXPIRING', label: 'Expiring' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'SUSPENDED', label: 'Suspended' },
] as const;

export default function Subscribers() {
  const c = useColors();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [access, setAccess] = useState<(typeof FILTERS)[number]['value']>('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const list = useInfiniteQuery({
    queryKey: ['admin', 'subscribers', q, access],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.get<SubscribersPage>(`/admin/subscribers${queryString({ q, access, page: pageParam, pageSize: 25 })}`),
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.subscribers) ?? [], [list.data]);
  const pull = useRefresh(useCallback(() => list.refetch(), [list]));
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]} edges={['top']}>
      <FlatList
        testID="subscribers-list"
        data={rows}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<Refresh {...pull} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            <PageTitle
              title="Subscribers"
              right={
                <Button
                  testID="new-subscriber"
                  label="New"
                  small
                  icon="add"
                  variant="primary"
                  onPress={() => router.push('/admin/subscribers/new')}
                />
              }
            />
            <Field
              testID="subscribers-search"
              label="Search by name, login, phone or email"
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            <ChipRow>
              {FILTERS.map((f) => (
                <Chip key={f.value} label={f.label} on={access === f.value} onPress={() => setAccess(f.value)} />
              ))}
            </ChipRow>
          </View>
        }
        ListEmptyComponent={
          list.isPending ? (
            <Loading rows={3} label="Loading subscribers" />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : (
            <EmptyState icon="people-outline" title={q || access ? 'Nobody matches that' : 'No subscribers yet'}>
              {q || access
                ? 'Try fewer filters.'
                : 'Add someone once you have recorded their payment. This app collects nothing.'}
            </EmptyState>
          )
        }
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <ActivityIndicator color={c.muted} style={{ marginVertical: space.lg }} />
          ) : undefined
        }
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        renderItem={({ item }) => (
          <Pressable
            testID={`subscriber-${item.loginId}`}
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${item.loginId}`}
            onPress={() => router.push(`/admin/subscribers/${item.id}`)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: c.surface, borderColor: c.line },
              pressed && { opacity: 0.75 },
            ]}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <T v="strong" numberOfLines={1}>
                {item.name}
              </T>
              <T v="small" c="muted" num numberOfLines={1}>
                {item.loginId}
                {item.subscription.lastValidDate
                  ? ` · through ${formatLocalDate(item.subscription.lastValidDate)}`
                  : ''}
              </T>
            </View>
            <AccessBadge row={item} />
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
