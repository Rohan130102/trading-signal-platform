import type { TradeDetail } from '@signaldesk/domain';
import { formatDateTime } from '@signaldesk/domain';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { DirectionBadge, Levels, OutcomeSummary, StatusBadge, Timeline } from '@/trade';
import { space } from '@/theme/tokens';
import { Badge, Card, ConnectionBanner, ErrorState, Loading, Notice, Screen, SectionTitle, T } from '@/ui';

const STATUS_NOTE: Partial<Record<TradeDetail['status'], string>> = {
  PUBLISHED: 'Published and awaiting entry. It is not active until the administrator says so.',
  CANCELLED: 'Cancelled. Do not enter this signal.',
  EXPIRED: 'Expired without entry.',
};

export default function TradeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trade = useQuery({ queryKey: ['trade', id], queryFn: () => api.get<TradeDetail>(`/trades/${id}`) });
  const refresh = useCallback(() => trade.refetch(), [trade]);
  const t = trade.data;
  return (
    <Screen edges={['bottom']} refresh={refresh} testID="trade-detail">
      <Stack.Screen options={{ title: t?.ref ?? 'Trade' }} />
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
  );
}
