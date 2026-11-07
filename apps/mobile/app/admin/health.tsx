import { formatDateTime, type NotificationHealth } from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { space } from '@/theme/tokens';
import {
  Badge,
  Button,
  Card,
  Divider,
  ErrorState,
  errorMessage,
  Loading,
  Screen,
  SectionTitle,
  Stat,
  T,
  useToast,
} from '@/ui';

const ms = (value: number | null) => (value === null ? 'n/a' : `${value} ms`);
const grid = { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg } as const;

export default function Health() {
  const client = useQueryClient();
  const toast = useToast();
  const health = useQuery({
    queryKey: ['admin', 'health'],
    queryFn: () => api.get<NotificationHealth>('/admin/notifications/health'),
    refetchInterval: 10_000,
  });
  const retry = useMutation({
    mutationFn: () => api.post<{ deliveries: number; outbox: number }>('/admin/notifications/retry-failed'),
    onSuccess: (result) => {
      toast({ title: `Requeued ${result.deliveries + result.outbox}`, tone: 'success' });
      void client.invalidateQueries({ queryKey: ['admin', 'health'] });
    },
    onError: (error) => toast({ title: 'Could not requeue', body: errorMessage(error), tone: 'error' }),
  });
  const refresh = useCallback(() => health.refetch(), [health]);
  const h = health.data;
  return (
    <Screen edges={['bottom']} refresh={refresh} testID="health">
      {health.isPending && <Loading rows={3} label="Loading delivery health" />}
      {health.isError && !h && <ErrorState error={health.error} onRetry={() => void health.refetch()} />}
      {h && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Badge tone={h.status === 'HEALTHY' ? 'success' : 'update'}>
              {h.status === 'HEALTHY' ? 'Healthy' : 'Needs attention'}
            </Badge>
            <Button
              testID="health-retry"
              small
              label="Retry recent failures"
              icon="refresh"
              loading={retry.isPending}
              onPress={() => retry.mutate()}
            />
          </View>
          <SectionTitle>Background worker</SectionTitle>
          <Card style={grid}>
            <Stat
              label="State"
              value={h.worker.healthy ? 'Running' : 'Not responding'}
              tone={h.worker.healthy ? undefined : 'stop'}
              hint={h.worker.lastSeenSecondsAgo === null ? undefined : `Seen ${h.worker.lastSeenSecondsAgo}s ago`}
            />
            <Stat
              label="Waiting"
              value={h.outbox.pending}
              hint={h.outbox.oldestPendingSeconds === null ? undefined : `Oldest ${h.outbox.oldestPendingSeconds}s`}
            />
            <Stat label="Failed permanently" value={h.outbox.dead} tone={h.outbox.dead > 0 ? 'stop' : undefined} />
          </Card>
          <SectionTitle>Push, last 24 hours</SectionTitle>
          <Card style={{ gap: space.md }}>
            <T v="small" c="muted">
              {h.push.note}
            </T>
            <View style={grid}>
              <Stat label="Accepted" value={h.push.last24h.accepted} />
              <Stat label="In progress" value={h.push.last24h.pending} />
              <Stat
                label="Failed"
                value={h.push.last24h.failed}
                tone={h.push.last24h.failed > 0 ? 'stop' : undefined}
              />
              <Stat label="Device gone" value={h.push.last24h.invalidated} hint="Removed automatically" />
              <Stat label="Skipped" value={h.push.last24h.skipped} hint="Access ended first" />
              <Stat label="Native push" value={h.push.nativeAvailable ? 'Available' : 'Off'} />
            </View>
          </Card>
          <SectionTitle>Live delivery, last 24 hours</SectionTitle>
          <Card style={{ gap: space.md }}>
            <T v="small" c="muted">
              {h.live.note}
            </T>
            <View style={grid}>
              <Stat label="Median" value={ms(h.live.last24h.p50Ms)} />
              <Stat
                label="95th percentile"
                value={ms(h.live.last24h.p95Ms)}
                hint={`Target under ${h.live.sloTargetP95Ms} ms`}
              />
              <Stat label="Slowest" value={ms(h.live.last24h.maxMs)} />
              <Stat label="Samples" value={h.live.last24h.samples} />
            </View>
          </Card>
          {h.recentFailures.length > 0 && (
            <>
              <SectionTitle>Recent failures</SectionTitle>
              <Card style={{ gap: space.md }}>
                {h.recentFailures.map((failure, i) => (
                  <View key={failure.id} style={{ gap: 2 }}>
                    {i > 0 && <Divider style={{ marginBottom: space.sm }} />}
                    <T v="strong" numberOfLines={2}>
                      {failure.title}
                    </T>
                    <T v="small" c="muted">
                      {failure.error ?? 'Unknown error'}
                    </T>
                    <T v="caption" c="subtle" num>
                      {formatDateTime(failure.at)} · {failure.attempts} attempts
                    </T>
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
