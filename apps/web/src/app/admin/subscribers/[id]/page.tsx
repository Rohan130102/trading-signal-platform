'use client';

import type { SubscriberDetail } from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, KeyRound, LogOut, PauseCircle, PlayCircle, RefreshCw, CalendarClock } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { AccessBadge, CredentialsCard } from '@/components/admin/subscriber-parts';
import {
  Button,
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
  Textarea,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, formatLocalDate, newKey } from '@/lib/format';

type Detail = SubscriberDetail;

const EVENT_LABEL = (e: Detail['events'][number]) => {
  if (e.type === 'CREATED') return `Created for ${e.durationDays} days`;
  if (e.type === 'ADJUSTED') return 'Dates adjusted';
  return `Renewed for ${e.durationDays} days${e.mode === 'EXTENDED_FROM_EXPIRY' ? ', extended from expiry' : ', started fresh'}`;
};

export default function SubscriberPage() {
  const { id } = useParams<{ id: string }>();
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ['admin', 'subscriber', id],
    queryFn: () => api.get<Detail>(`/admin/subscribers/${id}`),
  });
  const [dialog, setDialog] = useState<'renew' | 'adjust' | 'reset' | 'suspend' | null>(null);
  const refresh = () => void client.invalidateQueries({ queryKey: ['admin'] });
  const act = useMutation({
    mutationFn: (path: string) => api.post(`/admin/subscribers/${id}/${path}`),
    onSuccess: (_r, path) => {
      refresh();
      toast.success(
        path === 'reactivate' ? 'Account reactivated. They need to sign in again.' : 'Signed out everywhere.',
      );
    },
    onError: (e) => toast.error((e as ApiError).message),
  });
  const back = (
    <Link
      href="/admin/subscribers"
      className="-ml-1 inline-flex items-center gap-1 rounded px-1 text-[13px] text-muted hover:text-text"
    >
      <ArrowLeft className="size-3.5" aria-hidden /> Subscribers
    </Link>
  );
  if (detail.isPending) return <Loading rows={3} label="Loading subscriber" />;
  if (detail.isError) {
    return (
      <>
        {back}
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      </>
    );
  }
  const s = detail.data;
  return (
    <>
      <PageHeader
        back={back}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {s.name} <AccessBadge row={s} />
          </span>
        }
        description={<span className="num">{s.loginId}</span>}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,19rem)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <dl className="grid grid-cols-2 sm:grid-cols-3">
              <Stat
                label="Last valid day"
                value={s.subscription.lastValidDate ? formatLocalDate(s.subscription.lastValidDate) : 'None'}
                hint={s.subscription.timezone}
              />
              <Stat label="Days left" value={s.subscription.daysRemaining} hint="Including today" />
              <Stat
                label="Last sign-in"
                value={s.lastLoginAt ? formatDateTime(s.lastLoginAt) : 'Never'}
                hint={s.mustChangePassword ? 'Has not set a password yet' : undefined}
              />
            </dl>
          </Card>
          <Contact detail={s} onSaved={refresh} />
          <Card>
            <CardHeader title="Subscription history" />
            <ul>
              {s.events.map((e) => (
                <li key={e.id} className="border-t border-line px-4 py-2.5 text-sm sm:px-5">
                  <div className="flex flex-wrap justify-between gap-x-3">
                    <span className="font-medium">{EVENT_LABEL(e)}</span>
                    <time dateTime={e.createdAt} className="text-xs text-subtle">
                      {formatDateTime(e.createdAt)}
                    </time>
                  </div>
                  <p className="text-[13px] text-muted">
                    Through {formatLocalDate(e.lastValidDate)} · By {e.actorName}
                    {e.note && ` · ${e.note}`}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader
              title="Devices"
              description={`${s.sessions.length} signed in · ${s.devices.length} with notifications`}
            />
            {s.sessions.length > 0 && (
              <ul>
                {s.sessions.map((session) => (
                  <li
                    key={session.id}
                    className="flex flex-wrap justify-between gap-x-3 border-t border-line px-4 py-2 text-[13px] sm:px-5"
                  >
                    <span className="min-w-0 truncate">{session.deviceLabel ?? 'Unknown device'}</span>
                    <span className="text-muted">Seen {formatDateTime(session.lastSeenAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <aside aria-label="Actions" className="lg:sticky lg:top-7 lg:self-start">
          <Card>
            <CardHeader title="Actions" />
            <div className="flex flex-col gap-1.5 border-t border-line p-3">
              <Button variant="primary" className="w-full justify-start" onClick={() => setDialog('renew')}>
                <RefreshCw className="size-4" aria-hidden /> Renew
              </Button>
              <Button className="w-full justify-start" onClick={() => setDialog('adjust')}>
                <CalendarClock className="size-4" aria-hidden /> Change dates
              </Button>
              <Button className="w-full justify-start" onClick={() => setDialog('reset')}>
                <KeyRound className="size-4" aria-hidden /> Reset password
              </Button>
              <Button
                className="w-full justify-start"
                loading={act.isPending && act.variables === 'revoke-sessions'}
                onClick={() => act.mutate('revoke-sessions')}
              >
                <LogOut className="size-4" aria-hidden /> Sign out everywhere
              </Button>
              {s.status === 'ACTIVE' ? (
                <Button variant="danger" className="w-full justify-start" onClick={() => setDialog('suspend')}>
                  <PauseCircle className="size-4" aria-hidden /> Suspend account
                </Button>
              ) : (
                <Button
                  className="w-full justify-start"
                  loading={act.isPending && act.variables === 'reactivate'}
                  onClick={() => act.mutate('reactivate')}
                >
                  <PlayCircle className="size-4" aria-hidden /> Reactivate account
                </Button>
              )}
            </div>
          </Card>
        </aside>
      </div>
      {dialog === 'renew' && <RenewDialog detail={s} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'adjust' && <AdjustDialog detail={s} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'reset' && <ResetDialog detail={s} onClose={() => setDialog(null)} />}
      {dialog === 'suspend' && <SuspendDialog detail={s} onClose={() => setDialog(null)} onDone={refresh} />}
    </>
  );
}

function Contact({ detail, onSaved }: { detail: Detail; onSaved: () => void }) {
  const [phone, setPhone] = useState(detail.phone ?? '');
  const [email, setEmail] = useState(detail.email ?? '');
  const [notes, setNotes] = useState(detail.notes ?? '');
  const save = useMutation({
    mutationFn: () =>
      api.put(`/admin/subscribers/${detail.id}`, {
        phone: phone.trim() || null,
        email: email.trim() || null,
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      onSaved();
      toast.success('Saved');
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <Card>
      <CardHeader title="Contact and notes" />
      <form onSubmit={submit} className="flex flex-col gap-3 border-t border-line p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone">
            {(c) => <Input {...c} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />}
          </Field>
          <Field label="Email">
            {(c) => <Input {...c} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
        </div>
        <Field label="Notes" hint="Only administrators see this.">
          {(c) => <Textarea {...c} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        <FormError error={save.error} />
        <Button type="submit" className="self-start" loading={save.isPending}>
          Save
        </Button>
      </form>
    </Card>
  );
}

function RenewDialog({ detail, onClose, onDone }: { detail: Detail; onClose: () => void; onDone: () => void }) {
  const [days, setDays] = useState('30');
  const [note, setNote] = useState('');
  const [key] = useState(newKey);
  const running = detail.subscription.state === 'ACTIVE' || detail.subscription.state === 'SCHEDULED';
  const renew = useMutation({
    mutationFn: () =>
      api.post<{ subscriber: Detail }>(`/admin/subscribers/${detail.id}/renew`, {
        durationDays: Number(days),
        idempotencyKey: key,
        note: note.trim() || undefined,
      }),
    onSuccess: (r) => {
      onDone();
      toast.success(`Renewed through ${formatLocalDate(r.subscriber.subscription.lastValidDate as string)}`);
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    renew.mutate();
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Renew ${detail.name}`}
      description={
        running
          ? `Still active, so the new days are added after ${formatLocalDate(detail.subscription.lastValidDate as string)}. Nothing already paid for is lost.`
          : 'Expired, so the new period starts today.'
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Days to add">
          {(c) => (
            <Input
              {...c}
              className="num"
              type="number"
              min={1}
              autoFocus
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          )}
        </Field>
        <Field label="Note" hint="Optional, for your records.">
          {(c) => <Input {...c} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <FormError error={renew.error} />
        <Button type="submit" variant="primary" size="lg" loading={renew.isPending} disabled={!(Number(days) >= 1)}>
          Renew
        </Button>
      </form>
    </Dialog>
  );
}

function AdjustDialog({ detail, onClose, onDone }: { detail: Detail; onClose: () => void; onDone: () => void }) {
  const [lastValid, setLastValid] = useState(detail.subscription.lastValidDate ?? '');
  const [note, setNote] = useState('');
  const [key] = useState(newKey);
  const adjust = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscribers/${detail.id}/adjust`, {
        lastValidDate: lastValid,
        note: note.trim(),
        idempotencyKey: key,
      }),
    onSuccess: () => {
      onDone();
      toast.success('Dates changed');
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    adjust.mutate();
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Change subscription dates"
      description={`Takes effect at once. Dates are in ${detail.subscription.timezone} time.`}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label="Last valid day"
          hint="Access ends at the end of this day. Choose an earlier date to end access straight away."
        >
          {(c) => (
            <Input {...c} type="date" autoFocus value={lastValid} onChange={(e) => setLastValid(e.target.value)} />
          )}
        </Field>
        <Field label="Reason" required hint="Kept in the subscription history.">
          {(c) => <Input {...c} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <FormError error={adjust.error} />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={adjust.isPending}
          disabled={!lastValid || note.trim().length < 3}
        >
          Change dates
        </Button>
      </form>
    </Dialog>
  );
}

function ResetDialog({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  const reset = useMutation({
    mutationFn: () =>
      api.post<{ loginId: string; temporaryPassword: string }>(`/admin/subscribers/${detail.id}/reset-password`),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Reset password"
      description={reset.data ? undefined : 'This signs them out everywhere and issues a new temporary password.'}
    >
      {reset.data ? (
        <CredentialsCard loginId={reset.data.loginId} password={reset.data.temporaryPassword} />
      ) : (
        <div className="flex flex-col gap-3">
          <FormError error={reset.error} />
          <Button variant="primary" size="lg" loading={reset.isPending} onClick={() => reset.mutate()}>
            Reset password
          </Button>
        </div>
      )}
    </Dialog>
  );
}

function SuspendDialog({ detail, onClose, onDone }: { detail: Detail; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const suspend = useMutation({
    mutationFn: () => api.post(`/admin/subscribers/${detail.id}/suspend`, { note: note.trim() || undefined }),
    onSuccess: () => {
      onDone();
      toast.success('Account suspended');
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    suspend.mutate();
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Suspend ${detail.name}?`}
      description="They are signed out at once and cannot sign in until you reactivate the account. Their subscription dates do not change."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Reason" hint="Optional, for your records.">
          {(c) => <Input {...c} autoFocus value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <FormError error={suspend.error} />
        <Button type="submit" variant="danger" size="lg" loading={suspend.isPending}>
          Suspend account
        </Button>
      </form>
    </Dialog>
  );
}
