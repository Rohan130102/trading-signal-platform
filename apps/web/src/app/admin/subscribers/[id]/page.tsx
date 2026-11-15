'use client';

import { ACTIONS, type DeviceBindingView, ENQUIRY_STATUS_LABELS, type SubscriberDetail } from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BadgeCheck,
  CalendarClock,
  Gift,
  KeyRound,
  LogOut,
  PauseCircle,
  PlayCircle,
  PlusCircle,
  RefreshCw,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AccessBadge, CredentialsCard } from '@/components/admin/subscriber-parts';
import { EnquiryStatusField, RenewDialog, StartDialog, TrialDialog } from '@/components/admin/subscription-dialogs';
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
  Select,
  Stat,
  Textarea,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, formatLocalDate, newKey } from '@/lib/format';
import { useMe } from '@/lib/session';

type Detail = SubscriberDetail;

const EVENT_LABEL = (e: Detail['events'][number]) => {
  if (e.type === 'CREATED') return `Subscription started for ${e.durationDays} days`;
  if (e.type === 'STARTED') return `Subscription started for ${e.durationDays} days`;
  if (e.type === 'TRIAL_GRANTED') return `Free trial for ${e.durationDays} days`;
  if (e.type === 'ADJUSTED') return 'Dates adjusted';
  const how =
    e.mode === 'EXTENDED_FROM_EXPIRY'
      ? ', extended from expiry'
      : e.mode === 'RESTARTED_FROM_DATE'
        ? ', from a set date'
        : ', started fresh';
  return `Renewed for ${e.durationDays} days${how}`;
};

export default function SubscriberPage() {
  const { id } = useParams<{ id: string }>();
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ['admin', 'subscriber', id],
    queryFn: () => api.get<Detail>(`/admin/subscribers/${id}`),
  });
  const [dialog, setDialog] = useState<'start' | 'trial' | 'renew' | 'adjust' | 'reset' | 'suspend' | null>(null);
  const refresh = () => void client.invalidateQueries({ queryKey: ['admin'] });
  // Opening a new registration takes it off the badge for every administrator.
  const selfRegistered = detail.data?.selfRegistered === true;
  useEffect(() => {
    if (selfRegistered) {
      void api
        .post(`/admin/subscribers/${id}/seen`)
        .then(() => client.invalidateQueries({ queryKey: ['admin', 'inbox'] }));
    }
  }, [client, id, selfRegistered]);
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
          {s.selfRegistered && <Registration detail={s} />}
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
          <BoundPhones subscriberId={s.id} />
        </div>
        <aside aria-label="Actions" className="lg:sticky lg:top-7 lg:self-start">
          <Card>
            <CardHeader title="Actions" />
            <div className="flex flex-col gap-1.5 border-t border-line p-3">
              {s.actions.includes('START') && (
                <Button variant="primary" className="w-full justify-start" onClick={() => setDialog('start')}>
                  <PlusCircle className="size-4" aria-hidden /> {ACTIONS.startSubscription}
                </Button>
              )}
              {s.actions.includes('GRANT_TRIAL') && (
                <Button className="w-full justify-start" onClick={() => setDialog('trial')}>
                  <Gift className="size-4" aria-hidden /> {ACTIONS.grantFreeTrial}
                </Button>
              )}
              {s.actions.includes('RENEW') && (
                <Button variant="primary" className="w-full justify-start" onClick={() => setDialog('renew')}>
                  <RefreshCw className="size-4" aria-hidden /> {ACTIONS.renewSubscription}
                </Button>
              )}
              {s.subscription.state !== 'NONE' && (
                <Button className="w-full justify-start" onClick={() => setDialog('adjust')}>
                  <CalendarClock className="size-4" aria-hidden /> Change dates
                </Button>
              )}
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
                  <PauseCircle className="size-4" aria-hidden /> {ACTIONS.suspendAccount}
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
          <Card className="mt-4 p-4">
            <EnquiryStatusField detail={s} onSaved={refresh} />
          </Card>
          <Screenshots detail={s} onSaved={refresh} />
        </aside>
      </div>
      {dialog === 'start' && <StartDialog detail={s} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'trial' && <TrialDialog detail={s} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'renew' && <RenewDialog detail={s} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'adjust' && <AdjustDialog detail={s} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'reset' && <ResetDialog detail={s} onClose={() => setDialog(null)} />}
      {dialog === 'suspend' && <SuspendDialog detail={s} onClose={() => setDialog(null)} onDone={refresh} />}
    </>
  );
}

/** What they entered at sign-up, and how their enquiries went. */
function Registration({ detail }: { detail: Detail }) {
  const outcome = {
    LINK_OPENED: 'WhatsApp opened',
    EMAIL_QUEUED: 'Email sending',
    EMAIL_SENT: 'Email sent to support',
    EMAIL_FAILED: 'Email failed',
  } as const;
  return (
    <Card>
      <CardHeader
        title="Registration"
        action={
          detail.emailVerifiedAt ? (
            <span className="flex items-center gap-1 text-[13px] text-success">
              <BadgeCheck className="size-4" aria-hidden /> Email verified
            </span>
          ) : undefined
        }
      />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line px-4 py-3 text-sm sm:grid-cols-4 sm:px-5">
        <div>
          <dt className="text-xs text-muted">First name</dt>
          <dd>{detail.firstName}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Last name</dt>
          <dd>{detail.lastName}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Age</dt>
          <dd className="num">{detail.age}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Enquiry</dt>
          <dd>{ENQUIRY_STATUS_LABELS[detail.enquiryStatus]}</dd>
        </div>
      </dl>
      {detail.enquiries.length > 0 && (
        <ul className="border-t border-line">
          {detail.enquiries.map((e) => (
            <li key={e.id} className="flex justify-between gap-3 px-4 py-2 text-[13px] sm:px-5">
              <span>{outcome[e.outcome]}</span>
              <time dateTime={e.createdAt} className="text-subtle">
                {formatDateTime(e.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The Master Admin's choice for this subscriber. Nobody else sees it. */
function Screenshots({ detail, onSaved }: { detail: Detail; onSaved: () => void }) {
  const master = useMe().data?.isMasterAdmin === true;
  const save = useMutation({
    mutationFn: (value: boolean | null) =>
      api.put(`/admin/subscribers/${detail.id}/screenshots`, { screenshotsAllowed: value }),
    onSuccess: () => {
      onSaved();
      toast.success('Screenshot permission saved. Their app applies it straight away.');
    },
    onError: (e) => toast.error((e as ApiError).message),
  });
  const value = detail.screenshotsAllowed === null ? 'DEFAULT' : detail.screenshotsAllowed ? 'ALLOW' : 'BLOCK';
  if (!master) return null;
  return (
    <Card className="mt-4">
      <CardHeader
        title="Screenshots"
        description={detail.screenshotsEffective ? 'Allowed for this subscriber.' : 'Blocked for this subscriber.'}
      />
      <div className="flex flex-col gap-2 border-t border-line p-3">
        <Field label="Permission">
          {(c) => (
            <Select
              {...c}
              value={value}
              disabled={save.isPending}
              onChange={(e) => save.mutate(e.target.value === 'DEFAULT' ? null : e.target.value === 'ALLOW')}
            >
              <option value="DEFAULT">Platform default</option>
              <option value="BLOCK">Block</option>
              <option value="ALLOW">Allow</option>
            </Select>
          )}
        </Field>
        <p className="text-xs text-subtle">iPhone and web browsers cannot fully block screenshots.</p>
      </div>
    </Card>
  );
}

/**
 * App installations bound to this subscriber: one account per phone. Releasing one frees the phone for
 * another account and signs this subscriber out of it. The reason goes into the audit log.
 */
function BoundPhones({ subscriberId }: { subscriberId: string }) {
  const client = useQueryClient();
  const [releasing, setReleasing] = useState<DeviceBindingView | null>(null);
  const [reason, setReason] = useState('');
  const phones = useQuery({
    queryKey: ['admin', 'subscriber', subscriberId, 'devices'],
    queryFn: () => api.get<{ devices: DeviceBindingView[] }>(`/admin/subscribers/${subscriberId}/devices`),
  });
  const release = useMutation({
    mutationFn: () => api.post(`/admin/devices/${releasing?.id}/release`, { reason: reason.trim() }),
    onSuccess: () => {
      toast.success('Phone released. Another account can now sign in on it.');
      setReleasing(null);
      setReason('');
      void client.invalidateQueries({ queryKey: ['admin', 'subscriber', subscriberId] });
    },
  });
  const devices = phones.data?.devices ?? [];
  const current = devices.filter((d) => !d.releasedAt);
  const past = devices.filter((d) => d.releasedAt);
  return (
    <Card>
      <CardHeader
        title="Registered phones"
        description="One account per phone. A new phone registers when they sign in on it."
      />
      {phones.isPending && <Loading rows={1} label="Loading phones" />}
      {phones.data && current.length === 0 && (
        <p className="border-t border-line px-4 py-3 text-[13px] text-muted sm:px-5">No phone registered yet.</p>
      )}
      <ul>
        {current.map((d) => (
          <li
            key={d.id}
            className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[13px] sm:px-5"
          >
            <span className="min-w-0">
              <span className="block font-medium">
                {d.deviceLabel ?? (d.platform === 'ios' ? 'iPhone' : 'Android phone')}
              </span>
              <span className="text-muted">
                Registered {formatDateTime(d.boundAt)} · seen {formatDateTime(d.lastSeenAt)} · {d.activeSessions} signed
                in
              </span>
            </span>
            <Button size="sm" onClick={() => setReleasing(d)}>
              Release
            </Button>
          </li>
        ))}
        {past.slice(0, 5).map((d) => (
          <li key={d.id} className="border-t border-line px-4 py-2 text-[12px] text-subtle sm:px-5">
            Released {formatDateTime(d.releasedAt as string)}
            {d.releasedByName ? ` by ${d.releasedByName}` : ''}: {d.releaseReason}
          </li>
        ))}
      </ul>
      {releasing && (
        <Dialog
          open
          onOpenChange={(o) => !o && setReleasing(null)}
          title="Release this phone?"
          description="They are signed out of it, and another account will be able to sign in on it. Their subscription is not affected."
        >
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              release.mutate();
            }}
          >
            <Field label="Reason, for the audit log" required>
              {(c) => (
                <Input {...c} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
              )}
            </Field>
            <FormError error={release.error} />
            <Button type="submit" variant="danger" loading={release.isPending} disabled={reason.trim().length < 3}>
              Release phone
            </Button>
          </form>
        </Dialog>
      )}
    </Card>
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
