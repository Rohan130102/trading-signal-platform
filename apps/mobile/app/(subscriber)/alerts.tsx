import Ionicons from '@expo/vector-icons/Ionicons';
import { isSafeDeepLink, type NotificationItem, type NotificationsPage } from '@signaldesk/domain';
import { type InfiniteData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, queryString } from '@/lib/api';
import { useRealtime } from '@/lib/realtime';
import { DirectionBadge, Time } from '@/trade';
import { useColors } from '@/theme';
import type { Palette } from '@/theme/tokens';
import { radius, space } from '@/theme/tokens';
import { Badge, Button, EmptyState, ErrorState, Loading, PageTitle, Refresh, T, useRefresh } from '@/ui';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function look(item: NotificationItem, c: Palette): { icon: IconName; color: string; label: string } {
  switch (item.category) {
    case 'NEW_SIGNAL':
      return { icon: 'flash', color: item.direction === 'SELL' ? c.sell : c.buy, label: 'New signal' };
    case 'CLOSURE':
      return { icon: 'flag', color: c.muted, label: 'Trade finished' };
    case 'ANNOUNCEMENT':
      return { icon: 'megaphone', color: c.update, label: 'Announcement' };
    default:
      return {
        icon:
          item.type === 'STOP_MOVED' ? 'shield-checkmark' : item.type === 'TARGET_HIT' ? 'checkmark-circle' : 'sync',
        color: item.type === 'STOP_MOVED' ? c.stop : item.type === 'TARGET_HIT' ? c.success : c.update,
        label: 'Trade update',
      };
  }
}

const Row = memo(function Row({
  item,
  fresh,
  onOpen,
}: {
  item: NotificationItem;
  fresh: boolean;
  onOpen: (item: NotificationItem) => void;
}) {
  const c = useColors();
  const { icon, color, label } = look(item, c);
  return (
    <Pressable
      testID={`alert-${item.seq}`}
      accessibilityRole="button"
      accessibilityLabel={`${fresh ? 'New. ' : ''}${label}. ${item.title}. ${item.body.split('\n')[0] ?? ''}`}
      accessibilityHint={item.tradeId ? 'Opens the trade' : 'Opens announcements'}
      onPress={() => onOpen(item)}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: fresh ? c.raised : c.surface, borderColor: c.line, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: c.neutralSoft }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <View style={styles.body}>
        <View style={styles.top}>
          <T v="label" c="muted" style={styles.caps} numberOfLines={1}>
            {label}
          </T>
          {item.priority === 'PRIORITY' && (
            <Badge tone="update" icon="warning">
              Priority
            </Badge>
          )}
          <View style={styles.spacer} />
          <Time iso={item.createdAt} />
        </View>
        <View style={styles.top}>
          {item.direction && item.category === 'NEW_SIGNAL' && <DirectionBadge direction={item.direction} />}
          <T v="strong" numberOfLines={2} style={{ flexShrink: 1 }}>
            {item.title}
          </T>
        </View>
        {item.body ? (
          <T v="small" c="muted" numberOfLines={2}>
            {item.body.split('\n').slice(0, 2).join(' · ')}
          </T>
        ) : null}
      </View>
      {fresh && <View accessibilityElementsHidden style={[styles.dot, { backgroundColor: c.buy }]} />}
    </Pressable>
  );
});

/**
 * Every alert, newest first. Opening this tab clears the badge after a moment; items that were new when
 * the list loaded stay marked until you leave, so you can still see what arrived.
 */
export default function Alerts() {
  const c = useColors();
  const router = useRouter();
  const client = useQueryClient();
  const { setUnread } = useRealtime();
  const [freshAtLoad, setFreshAtLoad] = useState<Set<string> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const list = useInfiniteQuery({
    queryKey: ['notifications'],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      api.get<NotificationsPage>(`/notifications${queryString({ before: pageParam, limit: 30 })}`),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    staleTime: 15_000,
  });
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const unread = list.data?.pages[0]?.unread ?? 0;

  if (freshAtLoad === null && list.data) {
    setFreshAtLoad(new Set(items.filter((i) => i.unread).map((i) => i.eventId)));
  }

  const markAll = useCallback(async () => {
    const head = items[0]?.seq;
    if (head === undefined) return;
    const result = await api.post<{ unread: number }>('/notifications/read', { all: true, upToSeq: head });
    setUnread(result.unread);
    client.setQueryData<InfiniteData<NotificationsPage>>(['notifications'], (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((p) => ({
              ...p,
              unread: result.unread,
              items: p.items.map((i) => ({ ...i, unread: false })),
            })),
          }
        : data,
    );
    void client.invalidateQueries({ queryKey: ['signals'] });
  }, [client, items, setUnread]);

  useFocusEffect(
    useCallback(() => {
      if (unread > 0) timer.current = setTimeout(() => void markAll().catch(() => undefined), 1500);
      return () => {
        if (timer.current) clearTimeout(timer.current);
        setFreshAtLoad(null);
      };
    }, [markAll, unread]),
  );

  const open = useCallback(
    (item: NotificationItem) => {
      if (item.unread) {
        void api
          .post<{ unread: number }>('/notifications/read', { eventIds: [item.eventId] })
          .then((r) => setUnread(r.unread))
          .catch(() => undefined);
      }
      if (isSafeDeepLink(item.path)) router.push(item.path as never);
    },
    [router, setUnread],
  );

  const pull = useRefresh(useCallback(() => list.refetch(), [list]));

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]} edges={['top']}>
      <FlatList
        testID="alerts-list"
        data={items}
        keyExtractor={(item) => item.eventId}
        style={styles.fill}
        contentContainerStyle={styles.list}
        refreshControl={<Refresh {...pull} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            <PageTitle
              title="Alerts"
              subtitle={unread > 0 ? `${unread} new` : 'Everything sent to you, newest first.'}
              right={
                unread > 0 ? (
                  <Button
                    label="Mark all read"
                    small
                    variant="ghost"
                    testID="mark-all-read"
                    onPress={() => void markAll()}
                  />
                ) : undefined
              }
            />
          </View>
        }
        ListEmptyComponent={
          list.isPending ? (
            <Loading rows={4} label="Loading alerts" />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : (
            <EmptyState icon="notifications-outline" title="No alerts yet">
              New signals, changes to trades and announcements are listed here as they are sent.
            </EmptyState>
          )
        }
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <ActivityIndicator color={c.muted} style={{ marginVertical: space.lg }} />
          ) : undefined
        }
        renderItem={({ item, index }) => {
          const previous = items[index - 1];
          const sameTrade = previous && item.tradeId && previous.tradeId === item.tradeId;
          return (
            <View style={{ marginTop: index === 0 ? 0 : sameTrade ? 4 : space.sm }}>
              <Row item={item} fresh={item.unread || Boolean(freshAtLoad?.has(item.eventId))} onOpen={open} />
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { padding: space.lg, paddingBottom: space.xxl, flexGrow: 1 },
  header: { marginBottom: space.md },
  row: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'flex-start',
  },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: 3 },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  spacer: { flexGrow: 1 },
  caps: { textTransform: 'uppercase', flexShrink: 1 },
  dot: { width: 9, height: 9, borderRadius: 5, marginTop: 6 },
});
