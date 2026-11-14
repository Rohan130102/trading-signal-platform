'use client';

import {
  ACTIONS,
  computeInitialWindow,
  computeRenewal,
  ENQUIRY_STATUS_LABELS,
  ENQUIRY_STATUSES,
  type EnquiryStatus,
  lastValidLocalDate,
  localDateToInstant,
  MAX_SUBSCRIPTION_DAYS,
  MAX_TRIAL_DAYS,
  previewStart,
  SUBSCRIPTION_DAY_SHORTCUTS,
  type SubscriberDetail,
  TRIAL_DAY_SHORTCUTS,
} from '@signaldesk/domain';
import { useMutation } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowRight } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button, Dialog, Field, FormError, Input, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { formatLocalDate, newKey } from '@/lib/format';

type Detail = SubscriberDetail;

/** Today's calendar date in the business timezone, as YYYY-MM-DD. */
function todayIn(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

function currentWindow(detail: Detail) {
  const s = detail.subscription;
  return s.startsAt && s.expiresAt ? { startsAt: new Date(s.startsAt), expiresAt: new Date(s.expiresAt) } : null;
}

/** Any whole number of days; the shortcuts only fill the field. */
function DaysField({
  value,
  onChange,
  shortcuts,
  max,
}: {
  value: string;
  onChange: (v: string) => void;
  shortcuts: readonly number[];
  max: number;
}) {
  const n = Number(value);
  const error =
    value.trim() === '' ? null : !Number.isInteger(n) || n < 1 || n > max ? `Use a whole number from 1 to ${max}` : null;
  return (
    <div className="flex flex-col gap-2">
      <Field label="Duration (days)" error={error}>
        {(c) => (
          <Input
            {...c}
            className="num max-w-32 text-base font-semibold"
            inputMode="numeric"
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-1.5" aria-label="Shortcuts">
        {shortcuts.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onChange(String(d))}
            className={clsx(
              'num h-8 rounded-lg border px-2.5 text-[13px] font-medium',
              String(d) === value ? 'border-text bg-raised text-text' : 'border-line text-muted hover:text-text',
            )}
          >
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

function validDays(value: string, max: number): number | null {
  const n = Number(value);
  return value.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= max ? n : null;
}

/** Before and after, in the business timezone, computed with the server's own functions. */
function DatesPreview({ before, after, tz }: { before: string | null; after: string | null; tz: string }) {
  if (!after) return null;
  return (
    <div className="rounded-lg bg-bg p-3 text-sm" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">Access until</span>
        {before && (
          <>
            <span className="num text-muted line-through decoration-1">{formatLocalDate(before)}</span>
            <ArrowRight className="size-3.5 text-subtle" aria-label="becomes" />
          </>
        )}
        <span className="num font-semibold">{formatLocalDate(after)}</span>
      </div>
      <p className="mt-1 text-xs text-subtle">Last day included, {tz}.</p>
    </div>
  );
}

function startInstant(date: string, tz: string, now: Date): Date {
  const instant = localDateToInstant(date, tz);
  return instant.getTime() <= now.getTime() ? now : instant;
}

export function StartDialog({ detail, onClose, onDone }: { detail: Detail; onClose: () => void; onDone: () => void }) {
  const tz = detail.subscription.timezone;
  const [days, setDays] = useState('30');
  const [date, setDate] = useState(() => todayIn(tz));
  const [note, setNote] = useState('');
  const [confirmShorter, setConfirmShorter] = useState(false);
  const [key] = useState(newKey);
  const n = validDays(days, MAX_SUBSCRIPTION_DAYS);
  const preview = useMemo(() => {
    if (!n || !date) return null;
    try {
      const now = new Date();
      return previewStart(currentWindow(detail), startInstant(date, tz, now), n, now, tz);
    } catch {
      return null;
    }
  }, [date, detail, n, tz]);
  const start = useMutation({
    mutationFn: () =>
      api.post<{ subscriber: Detail }>(`/admin/subscribers/${detail.id}/start`, {
        durationDays: n,
        activationDate: date === todayIn(tz) ? undefined : date,
        note: note.trim() || undefined,
        confirmShorter,
        idempotencyKey: key,
      }),
    onSuccess: (r) => {
      onDone();
      toast.success(`Subscription active through ${formatLocalDate(r.subscriber.subscription.lastValidDate as string)}`);
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    start.mutate();
  };
  const trial = detail.subscription.kind === 'TRIAL' && detail.subscription.state === 'ACTIVE';
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={ACTIONS.startSubscription}
      description={trial ? 'This replaces the running free trial from the chosen date.' : undefined}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <DaysField value={days} onChange={setDays} shortcuts={SUBSCRIPTION_DAY_SHORTCUTS} max={MAX_SUBSCRIPTION_DAYS} />
        <Field label="Starts on">
          {(c) => <Input {...c} type="date" min={todayIn(tz)} className="max-w-48" value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <DatesPreview
          before={trial ? detail.subscription.lastValidDate : null}
          after={preview ? lastValidLocalDate(preview.expiresAt, tz) : null}
          tz={tz}
        />
        {preview?.shortensAccess && (
          <label className="flex items-start gap-2 rounded-lg bg-update-soft p-3 text-sm text-update">
            <input type="checkbox" className="mt-0.5" checked={confirmShorter} onChange={(e) => setConfirmShorter(e.target.checked)} />
            This ends before the access they already have. Shorten it anyway.
          </label>
        )}
        <Field label="Internal note" hint="Optional. Never shown to the subscriber.">
          {(c) => <Input {...c} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
        </Field>
        <FormError error={start.error} />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={start.isPending}
          disabled={!preview || (preview.shortensAccess && !confirmShorter)}
        >
          {ACTIONS.startSubscription}
        </Button>
      </form>
    </Dialog>
  );
}

export function TrialDialog({ detail, onClose, onDone }: { detail: Detail; onClose: () => void; onDone: () => void }) {
  const tz = detail.subscription.timezone;
  const [days, setDays] = useState('5');
  const [date, setDate] = useState(() => todayIn(tz));
  const [note, setNote] = useState('');
  const [key] = useState(newKey);
  const hadTrial = detail.trials.length > 0;
  const [allowRepeat, setAllowRepeat] = useState(false);
  const n = validDays(days, MAX_TRIAL_DAYS);
  const trialWindow = useMemo(() => {
    if (!n || !date) return null;
    try {
      return computeInitialWindow(startInstant(date, tz, new Date()), n, tz);
    } catch {
      return null;
    }
  }, [date, n, tz]);
  const grant = useMutation({
    mutationFn: () =>
      api.post<{ subscriber: Detail }>(`/admin/subscribers/${detail.id}/trial`, {
        durationDays: n,
        activationDate: date === todayIn(tz) ? undefined : date,
        note: note.trim() || undefined,
        allowRepeat,
        idempotencyKey: key,
      }),
    onSuccess: (r) => {
      onDone();
      toast.success(`Free trial through ${formatLocalDate(r.subscriber.subscription.lastValidDate as string)}`);
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    grant.mutate();
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={ACTIONS.grantFreeTrial}
      description="Same access as a subscription. They are told by email, in the app and by notification."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <DaysField value={days} onChange={setDays} shortcuts={TRIAL_DAY_SHORTCUTS} max={MAX_TRIAL_DAYS} />
        <Field label="Starts on">
          {(c) => <Input {...c} type="date" min={todayIn(tz)} className="max-w-48" value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <DatesPreview before={null} after={trialWindow ? lastValidLocalDate(trialWindow.expiresAt, tz) : null} tz={tz} />
        {hadTrial && (
          <label className="flex items-start gap-2 rounded-lg bg-update-soft p-3 text-sm text-update">
            <input type="checkbox" className="mt-0.5" checked={allowRepeat} onChange={(e) => setAllowRepeat(e.target.checked)} />
            They already had a free trial. Grant another.
          </label>
        )}
        <Field label="Internal remarks" hint="Optional. Never shown to the subscriber.">
          {(c) => <Input {...c} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
        </Field>
        <FormError error={grant.error} />
        <Button type="submit" variant="primary" size="lg" loading={grant.isPending} disabled={!trialWindow || (hadTrial && !allowRepeat)}>
          {ACTIONS.grantFreeTrial}
        </Button>
      </form>
    </Dialog>
  );
}

export function RenewDialog({ detail, onClose, onDone }: { detail: Detail; onClose: () => void; onDone: () => void }) {
  const tz = detail.subscription.timezone;
  const [days, setDays] = useState('30');
  const [date, setDate] = useState(() => todayIn(tz));
  const [note, setNote] = useState('');
  const [key] = useState(newKey);
  const running = detail.subscription.state === 'ACTIVE' || detail.subscription.state === 'SCHEDULED';
  const n = validDays(days, MAX_SUBSCRIPTION_DAYS);
  const current = currentWindow(detail);
  const result = useMemo(() => {
    if (!n || !current) return null;
    try {
      const now = new Date();
      return computeRenewal(current, n, now, tz, running ? undefined : startInstant(date, tz, now));
    } catch {
      return null;
    }
  }, [current, date, n, running, tz]);
  const renew = useMutation({
    mutationFn: () =>
      api.post<{ subscriber: Detail }>(`/admin/subscribers/${detail.id}/renew`, {
        durationDays: n,
        activationDate: running || date === todayIn(tz) ? undefined : date,
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
      title={ACTIONS.renewSubscription}
      description={running ? 'Still running, so the new days are added after its last day.' : 'Expired, so a new period starts.'}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <DaysField value={days} onChange={setDays} shortcuts={SUBSCRIPTION_DAY_SHORTCUTS} max={MAX_SUBSCRIPTION_DAYS} />
        {!running && (
          <Field label="Starts on">
            {(c) => <Input {...c} type="date" min={todayIn(tz)} className="max-w-48" value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
        )}
        <DatesPreview
          before={detail.subscription.lastValidDate}
          after={result ? lastValidLocalDate(result.expiresAt, tz) : null}
          tz={tz}
        />
        <Field label="Internal note" hint="Optional. Never shown to the subscriber.">
          {(c) => <Input {...c} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
        </Field>
        <FormError error={renew.error} />
        <Button type="submit" variant="primary" size="lg" loading={renew.isPending} disabled={!result}>
          {ACTIONS.renewSubscription}
        </Button>
      </form>
    </Dialog>
  );
}

export function EnquiryStatusField({ detail, onSaved }: { detail: Detail; onSaved: () => void }) {
  const save = useMutation({
    mutationFn: (status: EnquiryStatus) => api.put(`/admin/subscribers/${detail.id}/enquiry`, { status }),
    onSuccess: () => {
      onSaved();
      toast.success('Enquiry status saved');
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Field label={ACTIONS.updateEnquiryStatus}>
      {(c) => (
        <Select
          {...c}
          value={detail.enquiryStatus}
          disabled={save.isPending}
          onChange={(e) => save.mutate(e.target.value as EnquiryStatus)}
        >
          {ENQUIRY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ENQUIRY_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
