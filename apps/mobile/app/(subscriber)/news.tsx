import type { AnnouncementsPage, AnnouncementView } from '@signaldesk/domain';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AnnouncementCard } from '@/announcements/AnnouncementCard';
import { api, queryString } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { useColors } from '@/theme';
import { space } from '@/theme/tokens';
import { ActionSheet, EmptyState, ErrorState, Loading, PageTitle, Refresh, useRefresh, useToast } from '@/ui';

export default function News() {
  const c = useColors();
  const client = useQueryClient();
  const toast = useToast();
  const [menuFor, setMenuFor] = useState<AnnouncementView | null>(null);
  const board = useInfiniteQuery({
    queryKey: ['announcements'],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.get<AnnouncementsPage>(`/announcements${queryString({ page: pageParam, pageSize: 20 })}`),
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    staleTime: 30_000,
  });
  const items = useMemo(() => board.data?.pages.flatMap((p) => p.announcements) ?? [], [board.data]);
  const pull = useRefresh(useCallback(() => board.refetch(), [board]));

  const setHidden = useCallback(
    async (item: AnnouncementView, hidden: boolean) => {
      if (hidden) await api.post('/me/hidden', { type: 'ANNOUNCEMENT', id: item.id });
      else await api.delete(`/me/hidden/ANNOUNCEMENT/${item.id}`);
      await client.invalidateQueries({ queryKey: ['announcements'] });
    },
    [client],
  );

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]} edges={['top']}>
      <FlatList
        testID="news-list"
        data={items}
        keyExtractor={(item) => item.id}
        style={styles.fill}
        contentContainerStyle={styles.list}
        refreshControl={<Refresh {...pull} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (board.hasNextPage && !board.isFetchingNextPage) void board.fetchNextPage();
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            <PageTitle title="News" subtitle="Announcements from the desk. Pinned ones stay on top." />
          </View>
        }
        ListEmptyComponent={
          board.isPending ? (
            <Loading rows={2} label="Loading announcements" />
          ) : board.isError ? (
            <ErrorState error={board.error} onRetry={() => void board.refetch()} />
          ) : (
            <EmptyState icon="megaphone-outline" title="No announcements">
              Market notes, schedule changes and other news from the desk appear here.
            </EmptyState>
          )
        }
        ListFooterComponent={
          board.isFetchingNextPage ? <ActivityIndicator color={c.muted} style={{ marginVertical: space.lg }} /> : undefined
        }
        ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        renderItem={({ item }) => <AnnouncementCard item={item} onMenu={setMenuFor} />}
      />
      <ActionSheet
        visible={menuFor !== null}
        title={menuFor?.title ?? ''}
        onClose={() => setMenuFor(null)}
        actions={
          menuFor
            ? [
                {
                  label: 'Hide this announcement',
                  icon: 'eye-off-outline',
                  hint: 'Only for you.',
                  testID: 'action-hide-announcement',
                  onPress: () => {
                    const item = menuFor;
                    void setHidden(item, true)
                      .then(() => {
                        haptics.notify('success');
                        toast({
                          tone: 'info',
                          title: 'Announcement hidden',
                          duration: 6000,
                          action: { label: 'Undo', onPress: () => void setHidden(item, false).catch(() => undefined) },
                        });
                      })
                      .catch((error: Error) => toast({ tone: 'error', title: 'Could not hide it', body: error.message }));
                  },
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
  header: { marginBottom: space.md },
});
