'use client';

import type { NotificationHealth } from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, RotateCw } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Badge, Button, Card, CardHeader, ErrorState, Loading, PageHeader, Stat } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

type Health = NotificationHealth;

export default function NotificationsPage() {
  const client = useQueryClient();
  const health = useQuery({
    queryKey: ['admin', 'health'],
    queryFn: () => api.get<Health>('/admin/notifications/health'),
    refetchInterval: 10_000,
  });
  const retry = useMutation({
    mutationFn: () => api.post<{ deliveries: number; outbox: number }>('/admin/notifications/retry-failed'),
    onSuccess: (r) => {
      toast.success(`Requeued ${r.deliveries} deliveries and ${r.outbox} jobs.`);
      void client.invalidateQueries({ queryKey: ['admin', 'health'] });
    },
  });
  if (health.isPending) return <Loading rows={3} label="Loading delivery health" />;
  if (health.isError) return <ErrorState error={health.error} onRetry={() => void health.refetch()} />;
  const h = health.data;
  const p95 = h.live.last24h.p95Ms;
  return (
    <>
      <PageHeader
        title="Delivery health"
        description="What the system did. Nothing here can say whether a person saw a message."
        action={
          <Button loading={retry.isPending} onClick={() => retry.mutate()}>
            <RotateCw className="size-4" aria-hidden /> Retry recent failures
          </Button>
        }
      />
      <div className="flex flex-col gap-4">
        <Card className={h.status === 'HEALTHY' ? '' : 'border-stop/40'}>
          <div className="flex items-center gap-3 p-4 sm:p-5">
            {h.status === 'HEALTHY' ? (
              <CheckCircle2 className="size-6 text-success" aria-hidden />
            ) : (
              <AlertTriangle className="size-6 text-stop" aria-hidden />
            )}
            <div>
              <p className="font-semibold">{h.status === 'HEALTHY' ? 'Everything is running' : 'Needs attention'}</p>
              <p className="text-sm text-muted">
                {h.worker.healthy
                  ? `${h.worker.instances} worker${h.worker.instances === 1 ? '' : 's'} running, last seen ${h.worker.lastSeenSecondsAgo}s ago.`
                  : `The worker is not running${h.worker.lastSeenSecondsAgo !== null ? ` (last seen ${h.worker.lastSeenSecondsAgo}s ago)` : ''}. In-app delivery still works. Push notifications wait until it returns.`}
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Live delivery, last 24 hours" description={h.live.note} />
          <dl className="grid grid-cols-2 border-t border-line sm:grid-cols-4">
            <Stat label="Median" value={h.live.last24h.p50Ms === null ? 'n/a' : `${h.live.last24h.p50Ms} ms`} />
            <Stat
              label="95th percentile"
              value={p95 === null ? 'n/a' : `${p95} ms`}
              hint={`Target under ${h.live.sloTargetP95Ms} ms`}
              tone={p95 !== null && p95 > h.live.sloTargetP95Ms ? 'stop' : undefined}
            />
            <Stat label="Slowest" value={h.live.last24h.maxMs === null ? 'n/a' : `${h.live.last24h.maxMs} ms`} />
            <Stat label="Samples" value={h.live.last24h.samples} hint="Events with someone connected" />
          </dl>
        </Card>
        <Card>
          <CardHeader
            title="Push, last 24 hours"
            description={h.push.note}
            action={<Badge>{h.push.transport}</Badge>}
          />
          <dl className="grid grid-cols-2 border-t border-line sm:grid-cols-5">
            <Stat label="Accepted" value={h.push.last24h.accepted} />
            <Stat label="In progress" value={h.push.last24h.pending} />
            <Stat label="Failed" value={h.push.last24h.failed} tone={h.push.last24h.failed > 0 ? 'stop' : undefined} />
            <Stat label="Device gone" value={h.push.last24h.invalidated} hint="Removed automatically" />
            <Stat label="Skipped" value={h.push.last24h.skipped} hint="Access ended first" />
          </dl>
        </Card>
        <Card>
          <CardHeader title="Job queue" />
          <dl className="grid grid-cols-2 border-t border-line sm:grid-cols-3">
            <Stat
              label="Waiting"
              value={h.outbox.pending}
              hint={h.outbox.oldestPendingSeconds !== null ? `Oldest ${h.outbox.oldestPendingSeconds}s` : undefined}
            />
            <Stat label="Failed permanently" value={h.outbox.dead} tone={h.outbox.dead > 0 ? 'stop' : undefined} />
          </dl>
        </Card>
        <Card>
          <CardHeader title="Recent failures" />
          {h.recentFailures.length === 0 ? (
            <p className="border-t border-line px-4 py-4 text-sm text-muted sm:px-5">None.</p>
          ) : (
            <ul>
              {h.recentFailures.map((f) => (
                <li key={f.id} className="border-t border-line px-4 py-2.5 text-sm sm:px-5">
                  <div className="flex flex-wrap justify-between gap-x-3">
                    {f.tradeId ? (
                      <Link
                        href={`/admin/trades/${f.tradeId}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {f.title}
                      </Link>
                    ) : (
                      <span className="font-medium">{f.title}</span>
                    )}
                    <time dateTime={f.at} className="text-xs text-subtle">
                      {formatDateTime(f.at)}
                    </time>
                  </div>
                  <p className="text-[13px] text-muted">
                    {f.error} · {f.attempts} attempt{f.attempts === 1 ? '' : 's'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
