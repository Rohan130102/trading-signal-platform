'use client';

import type { DashboardResponse, TradeSummary } from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CheckCircle2, CircleAlert, FileEdit, Megaphone, Plus } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { DispatchStatus } from '@/components/admin/dispatch';
import { DirectionBadge, StatusBadge } from '@/components/trade';
import {
  Button,
  buttonClass,
  Card,
  CardHeader,
  Dialog,
  ErrorState,
  Field,
  FormError,
  Input,
  Loading,
  PageHeader,
  Stat,
  Switch,
  Textarea,
} from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime, formatRelative, newKey, signedPoints } from '@/lib/format';
import { formatPrice } from '@signaldesk/domain';

function TradeRow({ trade }: { trade: TradeSummary }) {
  return (
    <li>
      <Link
        href={`/admin/trades/${trade.id}`}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2.5 transition-colors hover:bg-neutral-soft sm:px-5"
      >
        <DirectionBadge direction={trade.direction} />
        <span className="font-semibold">{trade.symbol}</span>
        <span className="num text-xs text-subtle">{trade.ref}</span>
        <StatusBadge status={trade.status} />
        <span className="num ml-auto text-[13px] text-muted">
          {trade.stopLoss === null ? (
            'Upcoming'
          ) : (
            <>
              SL <span className="text-stop">{formatPrice(trade, trade.stopLoss)}</span>
            </>
          )}
        </span>
      </Link>
    </li>
  );
}

function TradeList({ title, trades, empty }: { title: string; trades: TradeSummary[]; empty: string }) {
  return (
    <Card>
      <CardHeader title={`${title} (${trades.length})`} />
      {trades.length === 0 ? (
        <p className="border-t border-line px-4 py-4 text-sm text-muted sm:px-5">{empty}</p>
      ) : (
        <ul>
          {trades.map((t) => (
            <TradeRow key={t.id} trade={t} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function AnnouncementDialog({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState(false);
  const [key] = useState(newKey);
  const send = useMutation({
    mutationFn: () =>
      api.post('/admin/announcements', {
        title: title.trim() || undefined,
        message: message.trim(),
        priority: priority ? 'PRIORITY' : 'NORMAL',
        idempotencyKey: key,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin'] });
      toast.success('Announcement sent to subscribers');
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send.mutate();
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Send an announcement"
      description="A general update, not tied to any trade. It goes to every active subscriber straight away."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Title" hint="Optional. Defaults to “Market update”.">
          {(c) => <Input {...c} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field label="Message">
          {(c) => (
            <Textarea
              {...c}
              rows={4}
              maxLength={2000}
              autoFocus
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          )}
        </Field>
        <div className="rounded-lg border border-line px-3">
          <Switch
            label="Priority"
            description="Time-critical: louder alerts for subscribers."
            checked={priority}
            onChange={setPriority}
          />
        </div>
        <FormError error={send.error} />
        <Button type="submit" variant="primary" size="lg" loading={send.isPending} disabled={!message.trim()}>
          Send to subscribers
        </Button>
      </form>
    </Dialog>
  );
}

export default function AdminDashboard() {
  const [announcing, setAnnouncing] = useState(false);
  const dash = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: () => api.get<DashboardResponse>('/admin/dashboard'),
    refetchInterval: 15_000,
  });
  const publish = (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="lg" onClick={() => setAnnouncing(true)}>
        <Megaphone className="size-4" aria-hidden /> Announcement
      </Button>
      <Link href="/admin/compose" className={buttonClass('primary', 'lg')}>
        <Plus className="size-5" aria-hidden /> Publish new signal
      </Link>
      {announcing && <AnnouncementDialog onClose={() => setAnnouncing(false)} />}
    </div>
  );
  if (dash.isPending) {
    return (
      <>
        <PageHeader title="Dashboard" action={publish} />
        <Loading rows={3} label="Loading the dashboard" />
      </>
    );
  }
  if (dash.isError) {
    return (
      <>
        <PageHeader title="Dashboard" action={publish} />
        <ErrorState error={dash.error} onRetry={() => void dash.refetch()} />
      </>
    );
  }
  const d = dash.data;
  return (
    <>
      <PageHeader title="Dashboard" action={publish} />
      {d.alerts.length > 0 && (
        <ul className="mb-4 flex flex-col gap-2">
          {d.alerts.map((alert) => (
            <li key={alert.message}>
              <Link
                href={alert.href}
                className={`flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm font-medium ${alert.level === 'CRITICAL' ? 'bg-stop-soft text-stop' : 'bg-update-soft text-update'}`}
              >
                {alert.level === 'CRITICAL' ? (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                ) : (
                  <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                )}
                {alert.message}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Card className="mb-4">
        <dl className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
          <Stat label="Active trades" value={d.active.length} />
          <Stat label="Awaiting entry" value={d.awaitingEntry.length} />
          <Stat
            label="Active subscribers"
            value={d.subscribers.active}
            hint={`of ${d.subscribers.total}, ${d.subscribers.expired} expired`}
          />
          <Stat
            label="Expiring in 7 days"
            value={d.subscribers.expiringSoon}
            tone={d.subscribers.expiringSoon > 0 ? 'update' : undefined}
          />
        </dl>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <TradeList title="Active" trades={d.active} empty="No trades are active." />
          <TradeList title="Awaiting entry" trades={d.awaitingEntry} empty="No signals are waiting for entry." />
          {d.drafts > 0 && (
            <Link
              href="/admin/compose"
              className="flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm font-medium hover:border-line-strong"
            >
              <FileEdit className="size-4 text-muted" aria-hidden /> {d.drafts} saved{' '}
              {d.drafts === 1 ? 'draft' : 'drafts'}
              <ArrowRight className="ml-auto size-4 text-muted" aria-hidden />
            </Link>
          )}
          <Card>
            <CardHeader
              title="Recently closed"
              action={
                <Link
                  href="/admin/performance"
                  className="text-[13px] text-muted underline underline-offset-2 hover:text-text"
                >
                  Performance
                </Link>
              }
            />
            {d.recentlyClosed.length === 0 ? (
              <p className="border-t border-line px-4 py-4 text-sm text-muted sm:px-5">Nothing has closed yet.</p>
            ) : (
              <ul>
                {d.recentlyClosed.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/admin/trades/${t.id}`}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2.5 hover:bg-neutral-soft sm:px-5"
                    >
                      <DirectionBadge direction={t.direction} />
                      <span className="font-semibold">{t.symbol}</span>
                      <span className="num text-xs text-subtle">{t.ref}</span>
                      <span className="num ml-auto text-[13px]">
                        {t.aggregate?.weightedPoints ? (
                          signedPoints(t.aggregate.weightedPoints)
                        ) : (
                          <span className="text-muted">Not measured</span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Notification system"
              action={
                <Link
                  href="/admin/notifications"
                  className="text-[13px] text-muted underline underline-offset-2 hover:text-text"
                >
                  Details
                </Link>
              }
            />
            <div className="flex flex-col gap-1.5 border-t border-line px-4 py-3 text-sm sm:px-5">
              <p className="flex items-center gap-2">
                {d.health.worker.healthy ? (
                  <CheckCircle2 className="size-4 text-success" aria-hidden />
                ) : (
                  <AlertTriangle className="size-4 text-stop" aria-hidden />
                )}
                {d.health.worker.healthy ? 'Worker running' : 'Worker not running'}
              </p>
              <p className="text-muted">
                {d.health.outbox.pending} queued · {d.health.outbox.dead} failed permanently · push{' '}
                {d.health.push.transport === 'webpush' ? 'configured' : d.health.push.transport}
              </p>
            </div>
          </Card>
          <Card>
            <CardHeader title="Recent signals and updates" />
            {d.recentEvents.length === 0 ? (
              <p className="border-t border-line px-4 py-4 text-sm text-muted sm:px-5">
                Nothing has been published yet.
              </p>
            ) : (
              <ul>
                {d.recentEvents.map((e) => {
                  const inner = (
                    <>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-sm font-medium">{e.title}</span>
                        <time
                          dateTime={e.createdAt}
                          title={formatDateTime(e.createdAt)}
                          className="shrink-0 text-xs text-subtle"
                        >
                          {formatRelative(e.createdAt)}
                        </time>
                      </div>
                      <div className="mt-1">
                        <DispatchStatus dispatch={e.dispatch} detailed={false} />
                      </div>
                    </>
                  );
                  return (
                    <li key={e.seq} className="border-t border-line">
                      {e.tradeId ? (
                        <Link
                          href={`/admin/trades/${e.tradeId}`}
                          className="block px-4 py-2.5 hover:bg-neutral-soft sm:px-5"
                        >
                          {inner}
                        </Link>
                      ) : (
                        <div className="px-4 py-2.5 sm:px-5">{inner}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          {d.expiring.length > 0 && (
            <Card>
              <CardHeader
                title="Expiring soon"
                action={
                  <Link
                    href="/admin/subscribers?access=EXPIRING"
                    className="text-[13px] text-muted underline underline-offset-2 hover:text-text"
                  >
                    All
                  </Link>
                }
              />
              <ul>
                {d.expiring.map((u) => (
                  <li key={u.id}>
                    <Link
                      href={`/admin/subscribers/${u.id}`}
                      className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-sm hover:bg-neutral-soft sm:px-5"
                    >
                      <span className="min-w-0 truncate font-medium">{u.name}</span>
                      {u.expiresAt && (
                        <span className="shrink-0 text-[13px] text-update">{formatRelativeFuture(u.expiresAt)}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function formatRelativeFuture(iso: string): string {
  const hours = (new Date(iso).getTime() - Date.now()) / 3_600_000;
  if (hours < 24) return `in ${Math.max(1, Math.round(hours))}h`;
  return `in ${Math.round(hours / 24)}d`;
}
