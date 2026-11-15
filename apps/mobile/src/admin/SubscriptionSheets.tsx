import {
  ACTIONS,
  type AdminSettings,
  computeRenewal,
  ENQUIRY_STATUS_LABELS,
  ENQUIRY_STATUSES,
  type EnquiryStatus,
  formatLocalDate,
  grantTrialWindow,
  lastValidLocalDate,
  localDateToInstant,
  MAX_SUBSCRIPTION_DAYS,
  MAX_TRIAL_DAYS,
  previewStart,
  SUBSCRIPTION_DAY_SHORTCUTS,
  type SubscriberDetail,
  TRIAL_DAY_SHORTCUTS,
} from '@signaldesk/domain';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { newKey } from '@/lib/ids';
import { space } from '@/theme/tokens';
import { Button, Card, Chip, ChipRow, Field, FormError, Notice, Sheet, T, ToggleRow, useToast } from '@/ui';

type Detail = SubscriberDetail;
interface SheetProps {
  detail: Detail;
  onClose: () => void;
  onDone: () => void;
}

/** Today's calendar date in the business timezone, as YYYY-MM-DD. */
function todayIn(tz: string, plusDays = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(Date.now() + plusDays * 86_400_000));
}

function validDays(value: string, max: number): number | null {
  const n = Number(value);
  return value.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= max ? n : null;
}

function startInstant(date: string, tz: string, now: Date): Date {
  const instant = localDateToInstant(date, tz);
  return instant.getTime() <= now.getTime() ? now : instant;
}

function currentWindow(detail: Detail) {
  const s = detail.subscription;
  return s.startsAt && s.expiresAt ? { startsAt: new Date(s.startsAt), expiresAt: new Date(s.expiresAt) } : null;
}

/** Any whole number of days; the chips only fill the field. */
function Days({
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
    value.trim() === ''
      ? null
      : !Number.isInteger(n) || n < 1 || n > max
        ? `Use a whole number from 1 to ${max}`
        : null;
  return (
    <View style={{ gap: space.sm }}>
      <Field
        testID="days"
        label="Duration (days)"
        num
        big
        value={value}
        error={error}
        onChangeText={(v) => onChange(v.replace(/\D/g, ''))}
        keyboardType="number-pad"
        autoFocus
      />
      <ChipRow>
        {shortcuts.map((d) => (
          <Chip
            key={d}
            testID={`days-${d}`}
            label={String(d)}
            on={value === String(d)}
            onPress={() => onChange(String(d))}
          />
        ))}
      </ChipRow>
    </View>
  );
}

function StartsOn({ value, onChange, tz }: { value: string; onChange: (v: string) => void; tz: string }) {
  return (
    <View style={{ gap: space.sm }}>
      <ChipRow>
        <Chip label="Today" on={value === todayIn(tz)} onPress={() => onChange(todayIn(tz))} />
        <Chip label="Tomorrow" on={value === todayIn(tz, 1)} onPress={() => onChange(todayIn(tz, 1))} />
      </ChipRow>
      <Field
        testID="starts-on"
        label="Starts on"
        hint="YYYY-MM-DD"
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
      />
    </View>
  );
}

/** Before and after, computed with the server's own functions. */
function Preview({ before, after }: { before: string | null; after: string | null }) {
  if (!after) return null;
  return (
    <Card style={{ gap: 2 }} testID="dates-preview">
      <T v="small" c="muted">
        Access until
      </T>
      {before && (
        <T c="muted" strike num>
          {formatLocalDate(before)}
        </T>
      )}
      <T v="heading" num>
        {formatLocalDate(after)}
      </T>
    </Card>
  );
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

export function StartSheet({ detail, onClose, onDone }: SheetProps) {
  const toast = useToast();
  const tz = detail.subscription.timezone;
  const [days, setDays] = useState('30');
  const [date, setDate] = useState(() => todayIn(tz));
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [key] = useState(newKey);
  const n = validDays(days, MAX_SUBSCRIPTION_DAYS);
  const preview = useMemo(
    () =>
      n ? safe(() => previewStart(currentWindow(detail), startInstant(date, tz, new Date()), n, new Date(), tz)) : null,
    [date, detail, n, tz],
  );
  const trial = detail.subscription.kind === 'TRIAL' && detail.subscription.state === 'ACTIVE';
  const start = useMutation({
    mutationFn: () =>
      api.post<{ subscriber: Detail }>(`/admin/subscribers/${detail.id}/start`, {
        durationDays: n,
        activationDate: date === todayIn(tz) ? undefined : date,
        note: note.trim() || undefined,
        confirmShorter: confirm,
        idempotencyKey: key,
      }),
    onSuccess: (r) => {
      onDone();
      toast({
        tone: 'success',
        title: `Active through ${formatLocalDate(r.subscriber.subscription.lastValidDate as string)}`,
      });
      onClose();
    },
  });
  return (
    <Sheet
      title={ACTIONS.startSubscription}
      subtitle={trial ? 'Replaces the running free trial from the chosen date.' : detail.name}
      onClose={onClose}
      testID="start-sheet"
      footer={
        <Button
          testID="start-submit"
          label={ACTIONS.startSubscription}
          variant="primary"
          large
          disabled={!preview || (preview.shortensAccess && !confirm)}
          loading={start.isPending}
          onPress={() => start.mutate()}
        />
      }
    >
      <Days value={days} onChange={setDays} shortcuts={SUBSCRIPTION_DAY_SHORTCUTS} max={MAX_SUBSCRIPTION_DAYS} />
      <StartsOn value={date} onChange={setDate} tz={tz} />
      <Preview
        before={trial ? detail.subscription.lastValidDate : null}
        after={preview ? lastValidLocalDate(preview.expiresAt, tz) : null}
      />
      {preview?.shortensAccess && (
        <ToggleRow
          label="This ends before the access they already have. Shorten it anyway."
          value={confirm}
          onChange={setConfirm}
        />
      )}
      <Field
        label="Internal note"
        hint="Optional. Never shown to the subscriber."
        value={note}
        onChangeText={setNote}
        maxLength={500}
      />
      <FormError error={start.error} />
    </Sheet>
  );
}

export function TrialSheet({ detail, onClose, onDone }: SheetProps) {
  const toast = useToast();
  const tz = detail.subscription.timezone;
  const settings = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.get<AdminSettings>('/admin/settings'),
  });
  const [chosen, setChosen] = useState<string | null>(null);
  const days = chosen ?? String(settings.data?.defaultTrialDays ?? 7);
  const [date, setDate] = useState(() => todayIn(tz));
  const [note, setNote] = useState('');
  const [key] = useState(newKey);
  // Running access, paid or trial, gets the days added after its last day; otherwise a trial starts.
  const running = detail.subscription.state === 'ACTIVE' || detail.subscription.state === 'SCHEDULED';
  const n = validDays(days, MAX_TRIAL_DAYS);
  const current = currentWindow(detail);
  const kind = detail.subscription.kind ?? 'PAID';
  const preview = useMemo(
    () =>
      n
        ? safe(() => {
            const now = new Date();
            return grantTrialWindow(
              current ? { ...current, kind } : null,
              n,
              now,
              tz,
              running ? undefined : startInstant(date, tz, now),
            );
          })
        : null,
    [current, date, kind, n, running, tz],
  );
  const grant = useMutation({
    mutationFn: () =>
      api.post<{ subscriber: Detail }>(`/admin/subscribers/${detail.id}/trial`, {
        durationDays: n,
        activationDate: running || date === todayIn(tz) ? undefined : date,
        note: note.trim() || undefined,
        idempotencyKey: key,
      }),
    onSuccess: (r) => {
      onDone();
      toast({
        tone: 'success',
        title: `${running ? 'Free days added' : 'Free trial started'}. Access until ${formatLocalDate(r.subscriber.subscription.lastValidDate as string)}.`,
      });
      onClose();
    },
  });
  const earlier = detail.trials.length;
  return (
    <Sheet
      title={ACTIONS.grantFreeTrial}
      subtitle={
        running
          ? 'They already have access. The free days are added after their last day, so nothing is lost.'
          : 'Same access as a subscription. They are told by email, in the app and by notification.'
      }
      onClose={onClose}
      testID="trial-sheet"
      footer={
        <Button
          testID="trial-submit"
          label={!running ? ACTIONS.grantFreeTrial : n ? `Add ${n} free ${n === 1 ? 'day' : 'days'}` : 'Add free days'}
          variant="primary"
          large
          disabled={!preview}
          loading={grant.isPending}
          onPress={() => grant.mutate()}
        />
      }
    >
      <Days value={days} onChange={setChosen} shortcuts={TRIAL_DAY_SHORTCUTS} max={MAX_TRIAL_DAYS} />
      {!running && <StartsOn value={date} onChange={setDate} tz={tz} />}
      <Preview
        before={running ? detail.subscription.lastValidDate : null}
        after={preview ? lastValidLocalDate(preview.expiresAt, tz) : null}
      />
      {earlier > 0 && (
        <T v="small" c="muted">
          {earlier === 1 ? 'They had one free trial before.' : `They had ${earlier} free trials before.`}
        </T>
      )}
      <Field
        label="Internal remarks"
        hint="Optional. Never shown to the member."
        value={note}
        onChangeText={setNote}
        maxLength={500}
      />
      <FormError error={grant.error} />
    </Sheet>
  );
}

export function RenewSheet({ detail, onClose, onDone }: SheetProps) {
  const toast = useToast();
  const tz = detail.subscription.timezone;
  const [days, setDays] = useState('30');
  const [date, setDate] = useState(() => todayIn(tz));
  const [note, setNote] = useState('');
  const [key] = useState(newKey);
  const running = detail.subscription.state === 'ACTIVE' || detail.subscription.state === 'SCHEDULED';
  const n = validDays(days, MAX_SUBSCRIPTION_DAYS);
  const current = currentWindow(detail);
  const result = useMemo(
    () =>
      n && current
        ? safe(() =>
            computeRenewal(current, n, new Date(), tz, running ? undefined : startInstant(date, tz, new Date())),
          )
        : null,
    [current, date, n, running, tz],
  );
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
      toast({
        tone: 'success',
        title: `Renewed through ${formatLocalDate(r.subscriber.subscription.lastValidDate as string)}`,
      });
      onClose();
    },
  });
  return (
    <Sheet
      title={ACTIONS.renewSubscription}
      subtitle={running ? 'Still running: the new days are added after its last day.' : 'Expired: a new period starts.'}
      onClose={onClose}
      testID="renew-sheet"
      footer={
        <Button
          testID="renew-submit"
          label={ACTIONS.renewSubscription}
          variant="primary"
          large
          disabled={!result}
          loading={renew.isPending}
          onPress={() => renew.mutate()}
        />
      }
    >
      <Days value={days} onChange={setDays} shortcuts={SUBSCRIPTION_DAY_SHORTCUTS} max={MAX_SUBSCRIPTION_DAYS} />
      {!running && <StartsOn value={date} onChange={setDate} tz={tz} />}
      <Preview
        before={detail.subscription.lastValidDate}
        after={result ? lastValidLocalDate(result.expiresAt, tz) : null}
      />
      <Field
        label="Internal note"
        hint="Optional. Never shown to the subscriber."
        value={note}
        onChangeText={setNote}
        maxLength={500}
      />
      <FormError error={renew.error} />
    </Sheet>
  );
}

/** Where the person's subscription enquiry stands, set by an administrator. */
export function EnquiryStatusChips({ detail, onSaved }: { detail: Detail; onSaved: () => void }) {
  const toast = useToast();
  const save = useMutation({
    mutationFn: (status: EnquiryStatus) => api.put(`/admin/subscribers/${detail.id}/enquiry`, { status }),
    onSuccess: () => {
      onSaved();
      toast({ tone: 'success', title: 'Enquiry status saved' });
    },
    onError: (error) => toast({ tone: 'error', title: 'Not saved', body: (error as Error).message }),
  });
  return (
    <View style={{ gap: space.sm }} testID="enquiry-status">
      <T v="small" c="muted">
        {ACTIONS.updateEnquiryStatus}
      </T>
      <ChipRow>
        {ENQUIRY_STATUSES.map((status) => (
          <Chip
            key={status}
            testID={`enquiry-${status}`}
            label={ENQUIRY_STATUS_LABELS[status]}
            on={detail.enquiryStatus === status}
            onPress={() => !save.isPending && status !== detail.enquiryStatus && save.mutate(status)}
          />
        ))}
      </ChipRow>
      {save.error ? <Notice tone="stop">{(save.error as Error).message}</Notice> : null}
    </View>
  );
}
