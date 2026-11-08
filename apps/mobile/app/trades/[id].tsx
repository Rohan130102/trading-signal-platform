import type { TradeDetail } from '@signaldesk/domain';
import { formatDateTime } from '@signaldesk/domain';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { useRealtime } from '@/lib/realtime';
import { useScreenProtection } from '@/security/Protected';
import { DirectionBadge, Levels, OutcomeSummary, StatusBadge, Timeline } from '@/trade';
import { useColors } from '@/theme';
import { space } from '@/theme/tokens';
import {
  Badge,
  Button,
  Card,
  ConnectionBanner,
  ErrorState,
  Loading,
  Notice,
  Screen,
  SectionTitle,
  T,
  useToast,
} from '@/ui';

const STATUS_NOTE: Partial<Record<TradeDetail['status'], string>> = {
  PUBLISHED: 'Published and awaiting entry. It is not active until the administrator says so.',
  CANCELLED: 'Cancelled. Do not enter this signal.',
  EXPIRED: 'Expired without entry.',
};

export default function TradeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const client = useQueryClient();
  const toast = useToast();
  const { setUnread } = useRealtime();
  useScreenProtection('trade', 'trade');
  // Always the authoritative state on arrival, so an old notification can never show old levels as current.
  const trade = useQuery({
    queryKey: ['trade', id],
    queryFn: () => api.get<TradeDetail>(`/trades/${id}`),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const refresh = useCallback(() => trade.refetch(), [trade]);
  const t = trade.data;
  const [busy, setBusy] = useState(false);

  const markedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!t || markedFor.current === `${t.id}:${t.version}`) return;
    markedFor.current = `${t.id}:${t.version}`;
    void api
      .post<{ unread: number }>('/notifications/read', { tradeId: t.id })
      .then((result) => {
        setUnread(result.unread);
        void client.invalidateQueries({ queryKey: ['signals'] });
        void client.invalidateQueries({ queryKey: ['notifications'] });
      })
      .catch(() => undefined);
  }, [client, setUnread, t]);

  const setHidden = useCallback(
    async (hidden: boolean) => {
      if (!t) return;
      setBusy(true);
      try {
        if (hidden) await api.post('/me/hidden', { type: 'TRADE', id: t.id });
        else await api.delete(`/me/hidden/TRADE/${t.id}`);
        haptics.notify('success');
        toast({
          tone: 'info',
          title: hidden ? 'Hidden from your Signals' : 'Back in your Signals',
          body: hidden ? 'Only for you. Alerts still arrive, and it stays in History.' : undefined,
        });
        await Promise.all([
          client.invalidateQueries({ queryKey: ['trade', t.id] }),
          client.invalidateQueries({ queryKey: ['signals'] }),
          client.invalidateQueries({ queryKey: ['history'] }),
        ]);
      } catch (error) {
        toast({ tone: 'error', title: 'That did not work', body: (error as Error).message });
      } finally {
        setBusy(false);
      }
    },
    [client, t, toast],
  );

  return (
    <View style={{ flex: 1 }}>
      <Screen edges={['bottom']} refresh={refresh} testID="trade-detail">
        <Stack.Screen
          options={{
            title: t?.ref ?? 'Trade',
            headerRight: t
              ? () => (
                  <Pressable
                    testID="trade-visibility"
                    accessibilityRole="button"
                    accessibilityLabel={t.hidden ? 'Show in Signals' : 'Hide from Signals'}
                    disabled={busy}
                    onPress={() => void setHidden(!t.hidden)}
                    style={({ pressed }) => ({
                      width: 44,
                      height: 44,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: pressed || busy ? 0.5 : 1,
                    })}
                  >
                    <Ionicons name={t.hidden ? 'eye-outline' : 'eye-off-outline'} size={22} color={c.text} />
                  </Pressable>
                )
              : undefined,
          }}
        />
        {trade.isPending && <Loading rows={2} label="Loading trade" />}
        {trade.isError && (
          <ErrorState
            error={trade.error}
            title={
              trade.error instanceof ApiError && trade.error.status === 404 ? 'That trade is not available' : undefined
            }
            onRetry={() => void trade.refetch()}
          />
        )}
        {t && (
          <>
            <ConnectionBanner />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm }}>
              <DirectionBadge direction={t.direction} large />
              <T v="title" accessibilityRole="header">
                {t.symbol}
              </T>
              <StatusBadge status={t.status} />
              {t.priority === 'PRIORITY' && (
                <Badge tone="update" icon="warning">
                  Priority
                </Badge>
              )}
            </View>
            {t.hidden && (
              <Notice tone="neutral" icon="eye-off-outline" title="Hidden from your Signals">
                Only you see it this way. Alerts about it still arrive, and it stays in History.
              </Notice>
            )}
            {t.hidden && (
              <Button
                label="Show in Signals"
                icon="eye-outline"
                small
                onPress={() => void setHidden(false)}
                loading={busy}
              />
            )}
            {t.archived && (
              <Notice tone="neutral" icon="archive-outline">
                The desk moved this finished trade out of the Signals list. Its full record stays here and in History.
              </Notice>
            )}
            {STATUS_NOTE[t.status] && (
              <Notice tone={t.status === 'PUBLISHED' ? 'update' : 'neutral'}>{STATUS_NOTE[t.status]}</Notice>
            )}
            <Card style={{ gap: space.md }}>
              <Levels
                big
                precision={t.pricePrecision}
                entryLow={t.entryLow}
                entryHigh={t.entryHigh}
                entryType={t.entryType}
                targets={t.targets}
                stopLoss={t.stopLoss}
                originalStopLoss={t.originalStopLoss}
              />
              {t.commentary ? (
                <T v="small" c="muted">
                  {t.commentary}
                </T>
              ) : null}
              <T v="caption" c="subtle" num>
                Published {formatDateTime(t.publishedAt)}
                {t.closedAt ? ` · Closed ${formatDateTime(t.closedAt)}` : ''}
              </T>
            </Card>
            {t.outcome && <OutcomeSummary outcome={t.outcome} precision={t.pricePrecision} />}
            <SectionTitle>What has happened</SectionTitle>
            <Card>
              <Timeline events={t.events} />
            </Card>
            <T v="caption" c="subtle" center>
              A published signal is a recommendation, not a confirmed trade. Your result depends on your own entry, size
              and costs.
            </T>
          </>
        )}
      </Screen>
    </View>
  );
}
