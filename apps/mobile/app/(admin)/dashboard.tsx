import type { DashboardResponse, TradeSummary } from '@signaldesk/domain';
import { formatDateTime, formatLocalDate } from '@signaldesk/domain';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';
import { DispatchStatus, TradeRow } from '@/admin/parts';
import { api } from '@/lib/api';
import { space } from '@/theme/tokens';
import {
  Button,
  Card,
  ConnectionBanner,
  Divider,
  ErrorState,
  ListRow,
  LivePill,
  Loading,
  Notice,
  PageTitle,
  Screen,
  SectionTitle,
  Stat,
  T,
} from '@/ui';

function TradeGroup({ title, trades, empty }: { title: string; trades: TradeSummary[]; empty?: string }) {
  if (trades.length === 0 && !empty) return null;
  return (
    <>
      <SectionTitle>{`${title} (${trades.length})`}</SectionTitle>
      {trades.length === 0 ? (
        <Card>
          <T c="muted">{empty}</T>
        </Card>
      ) : (
        <View style={{ gap: space.sm }}>
          {trades.map((t) => (
            <TradeRow key={t.id} trade={t} />
          ))}
        </View>
      )}
    </>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const dashboard = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: () => api.get<DashboardResponse>('/admin/dashboard'),
    refetchInterval: 15_000,
  });
  const refresh = useCallback(() => dashboard.refetch(), [dashboard]);
  const d = dashboard.data;
  return (
    <Screen refresh={refresh} testID="dashboard">
      <PageTitle title="Desk" right={<LivePill />} />
      <ConnectionBanner />
      {d?.alerts.map((alert) => (
        <Notice key={alert.message} tone={alert.level === 'CRITICAL' ? 'stop' : 'update'} icon="warning">
          {alert.message}
        </Notice>
      ))}
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <Button
          testID="quick-buy"
          style={{ flex: 1 }}
          large
          heavy
          variant="buy"
          icon="arrow-up"
          label="BUY"
          onPress={() => router.push({ pathname: '/compose', params: { direction: 'BUY' } })}
        />
        <Button
          testID="quick-sell"
          style={{ flex: 1 }}
          large
          heavy
          variant="sell"
          icon="arrow-down"
          label="SELL"
          onPress={() => router.push({ pathname: '/compose', params: { direction: 'SELL' } })}
        />
      </View>
      {dashboard.isPending && <Loading rows={3} label="Loading your desk" />}
      {dashboard.isError && !d && <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />}
      {d && (
        <>
          <Card style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
            <Stat label="Active subscribers" value={d.subscribers.active} />
            <Stat
              label="Expiring soon"
              value={d.subscribers.expiringSoon}
              tone={d.subscribers.expiringSoon > 0 ? 'update' : undefined}
            />
          </Card>
          <TradeGroup title="Active" trades={d.active} empty="Nothing active." />
          <TradeGroup title="Awaiting entry" trades={d.awaitingEntry} />
          {d.drafts > 0 && (
            <Card padded={false} style={{ paddingHorizontal: space.lg }}>
              <ListRow
                testID="open-drafts"
                icon="document-outline"
                title={`${d.drafts} draft${d.drafts === 1 ? '' : 's'}`}
                onPress={() => router.push('/admin/drafts')}
              />
            </Card>
          )}
          {d.expiring.length > 0 && (
            <>
              <SectionTitle>Expiring soon</SectionTitle>
              <Card padded={false} style={{ paddingHorizontal: space.lg }}>
                {d.expiring.map((s, i) => (
                  <View key={s.id}>
                    {i > 0 && <Divider />}
                    <ListRow
                      title={s.name}
                      subtitle={s.expiresAt ? `Ends ${formatLocalDate(s.expiresAt.slice(0, 10))}` : undefined}
                      onPress={() => router.push(`/admin/subscribers/${s.id}`)}
                    />
                  </View>
                ))}
              </Card>
            </>
          )}
          <TradeGroup title="Recently closed" trades={d.recentlyClosed} />
          {d.recentEvents.length > 0 && (
            <>
              <SectionTitle>Recent broadcasts</SectionTitle>
              <Card style={{ gap: space.md }}>
                {d.recentEvents.slice(0, 6).map((event, i) => (
                  <View key={event.id} style={{ gap: 4 }}>
                    {i > 0 && <Divider style={{ marginBottom: space.sm }} />}
                    <T v="strong" numberOfLines={2}>
                      {event.title}
                    </T>
                    <T v="caption" c="subtle" num>
                      {formatDateTime(event.createdAt)}
                    </T>
                    <DispatchStatus dispatch={event.dispatch} />
                  </View>
                ))}
              </Card>
            </>
          )}
        </>
      )}
    </Screen>
  );
}
