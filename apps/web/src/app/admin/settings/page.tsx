'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  approvalSchema,
  ENTRY_WINDOW_CHOICES,
  entryWindowLabel,
  type HistoryScope,
  settingsSchema,
  type SignalStartMode,
  type TrailingStopWording,
} from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, ShieldAlert, Unlock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import {
  Badge,
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
  Labeled,
  Segmented,
  Select,
  Switch,
  Textarea,
} from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useMe } from '@/lib/session';

type SettingsValues = z.input<typeof settingsSchema>;

interface Gate {
  flagEnabled: boolean;
  enabled: boolean;
  currentApprovalId: string | null;
  deploymentFlag: string;
  approvals: {
    id: string;
    jurisdiction: string;
    scope: string;
    reviewerName: string;
    documentReference: string;
    effectiveFrom: string;
    expiresAt: string;
    revokedAt: string | null;
    createdBy: string;
  }[];
}

const WINDOW_OPTIONS = [...new Set([0, ...ENTRY_WINDOW_CHOICES, 480, 720, 2880, 10080])].sort((a, b) => a - b);

function SettingsForm({ initial, canEdit }: { initial: SettingsValues; canEdit: boolean }) {
  const client = useQueryClient();
  const form = useForm<SettingsValues>({ resolver: zodResolver(settingsSchema), defaultValues: initial });
  const startMode = form.watch('signalStartMode');
  const windowMinutes = form.watch('entryExpiryMinutesDefault');
  const wording = form.watch('trailingStopWording');
  const historyScope = form.watch('historyScope');
  const screenshots = form.watch('screenshotsAllowedDefault');
  const setRule = <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) =>
    form.setValue(key, value as never, { shouldDirty: true, shouldValidate: true });
  const windowChoices = WINDOW_OPTIONS.includes(windowMinutes) ? WINDOW_OPTIONS : [...WINDOW_OPTIONS, windowMinutes];
  const save = useMutation({
    mutationFn: (v: SettingsValues) => api.put('/admin/settings', v),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'settings'] });
      void client.invalidateQueries({ queryKey: ['me'] });
      toast.success('Settings saved');
    },
  });
  const e = form.formState.errors;
  return (
    <form
      onSubmit={(ev) => void form.handleSubmit((v) => save.mutate(v))(ev)}
      className="flex flex-col gap-4"
      noValidate
    >
      {!canEdit && (
        <p className="flex items-start gap-2 rounded-lg bg-neutral-soft p-3 text-[13px] text-muted" role="note">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          Only the Master Admin can change settings. You can see what is in force.
        </p>
      )}
      <fieldset disabled={!canEdit} className="flex min-w-0 flex-col gap-4">
        <Card className="flex flex-col gap-4 p-4 sm:p-5">
          <div>
            <h2 className="text-sm font-semibold">Signals</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              Defaults for every new signal. Administrators can still choose differently when they publish one.
            </p>
          </div>
          <Labeled
            label="A new signal starts as"
            hint={
              startMode === 'AWAITING_ENTRY'
                ? 'It waits until an administrator activates it. If its entry window ends first, it is cancelled automatically and subscribers are told not to enter.'
                : 'It is active as soon as it is published. Activation is recorded separately and is never a fill.'
            }
          >
            <Segmented<SignalStartMode>
              label="A new signal starts as"
              value={startMode}
              onChange={(v) => setRule('signalStartMode', v)}
              options={[
                { value: 'AWAITING_ENTRY', label: 'Awaiting entry' },
                { value: 'ACTIVE', label: 'Active immediately' },
              ]}
            />
          </Labeled>
          <Field
            label="Entry window"
            error={e.entryExpiryMinutesDefault?.message}
            hint="How long a new signal may wait for entry before it is cancelled automatically."
          >
            {(c) => (
              <Select
                {...c}
                value={String(windowMinutes)}
                onChange={(ev) => setRule('entryExpiryMinutesDefault', Number(ev.target.value))}
              >
                {windowChoices.map((m) => (
                  <option key={m} value={m}>
                    {m === 0 ? 'No limit (never cancelled automatically)' : entryWindowLabel(m)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Labeled
            label="Trailing stop-loss alerts"
            hint={
              wording === 'GENERAL'
                ? 'Example: “Trail the stop-loss on trade T-0012 to 3,350.00.”'
                : 'Example: “Stop-loss on trade T-0012 trailed from 3,300.00 to 3,350.00 (50 pts from 3,400.00).”'
            }
          >
            <Segmented<TrailingStopWording>
              label="Trailing stop-loss alerts"
              value={wording}
              onChange={(v) => setRule('trailingStopWording', v)}
              options={[
                { value: 'GENERAL', label: 'General message' },
                { value: 'DETAILED', label: 'Show distance in points' },
              ]}
            />
          </Labeled>
        </Card>
        <Card className="flex flex-col gap-4 p-4 sm:p-5">
          <div>
            <h2 className="text-sm font-semibold">Subscribers</h2>
            <p className="mt-0.5 text-[13px] text-muted">What subscribers see and may do. Applied straight away.</p>
          </div>
          <Labeled
            label="Each subscriber’s history"
            hint={
              historyScope === 'MEMBERSHIP'
                ? 'Signals published or still live during their membership. Live signals are always shown.'
                : 'Every published signal, including those from before they joined.'
            }
          >
            <Segmented<HistoryScope>
              label="Each subscriber’s history"
              value={historyScope}
              onChange={(v) => setRule('historyScope', v)}
              options={[
                { value: 'MEMBERSHIP', label: 'From their membership' },
                { value: 'ALL', label: 'Everything' },
              ]}
            />
          </Labeled>
          <div className="rounded-lg border border-line px-3">
            <Switch
              label="Allow screenshots"
              description="The default for subscribers. You can override it for one subscriber on their page."
              checked={screenshots}
              disabled={!canEdit}
              onChange={(v) => setRule('screenshotsAllowedDefault', v)}
            />
          </div>
          <p className="text-xs leading-relaxed text-subtle">
            When screenshots are blocked: Android blocks screenshots, screen recording and the recent-apps preview.
            iPhone has no supported way to block them; the app hides content from captures where iOS allows it, blurs
            the app switcher and records a screenshot when it notices one. A web browser cannot block screenshots at
            all.
          </p>
        </Card>
        <Card className="flex flex-col gap-4 p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Service</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Service name" error={e.serviceName?.message}>
              {(c) => <Input {...c} {...form.register('serviceName')} />}
            </Field>
            <Field
              label="Business timezone"
              error={e.businessTimezone?.message}
              hint="Decides when a subscription day starts and ends. IANA name, such as Asia/Kolkata."
            >
              {(c) => <Input {...c} {...form.register('businessTimezone')} />}
            </Field>
            <Field label="Support contact" error={e.supportContact?.message} hint="Shown publicly and to subscribers.">
              {(c) => <Input {...c} {...form.register('supportContact')} />}
            </Field>
          </div>
          <Field
            label="Service description"
            error={e.serviceDescription?.message}
            hint="Public. Do not state accuracy, returns or guarantees."
          >
            {(c) => <Textarea {...c} rows={2} {...form.register('serviceDescription')} />}
          </Field>
          <Field label="What an expired subscriber is told" error={e.renewalInstructions?.message}>
            {(c) => <Textarea {...c} rows={2} {...form.register('renewalInstructions')} />}
          </Field>
          <Field
            label="About us (public page)"
            error={e.aboutBody?.message}
            hint="Who you are and how the desk works. Public. Do not state accuracy, returns or guarantees."
          >
            {(c) => <Textarea {...c} rows={5} {...form.register('aboutBody')} />}
          </Field>
        </Card>
        <Card className="flex flex-col gap-4 p-4 sm:p-5">
          <div>
            <h2 className="text-sm font-semibold">Legal text</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              Have this reviewed by qualified counsel before opening to the public. See the compliance checklist.
            </p>
          </div>
          <Field label="Legal entity name" error={e.legalEntityName?.message}>
            {(c) => <Input {...c} {...form.register('legalEntityName')} />}
          </Field>
          <Field
            label="Regulatory statement"
            error={e.regulatoryStatement?.message}
            hint="Empty until your status is established. Never claim a registration or authorisation you do not hold."
          >
            {(c) => <Textarea {...c} rows={3} {...form.register('regulatoryStatement')} />}
          </Field>
          <Field label="Risk disclosure" error={e.riskDisclosure?.message}>
            {(c) => <Textarea {...c} rows={7} {...form.register('riskDisclosure')} />}
          </Field>
          <Field label="Privacy notice" error={e.privacyNotice?.message}>
            {(c) => <Textarea {...c} rows={5} {...form.register('privacyNotice')} />}
          </Field>
        </Card>
      </fieldset>
      <FormError error={save.error} />
      {canEdit && (
        <Button type="submit" variant="primary" size="lg" className="self-start" loading={save.isPending}>
          Save settings
        </Button>
      )}
    </form>
  );
}

type ApprovalValues = z.input<typeof approvalSchema>;

function ApprovalDialog({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const form =
    useForm<Pick<ApprovalValues, 'jurisdiction' | 'scope' | 'reviewerName' | 'documentReference' | 'notes'>>();
  const add = useMutation({
    mutationFn: (v: Partial<ApprovalValues>) => {
      const parsed = approvalSchema.parse({
        ...v,
        notes: v.notes || undefined,
        effectiveFrom: from ? new Date(from).toISOString() : '',
        expiresAt: until ? new Date(until).toISOString() : '',
      });
      return api.post('/admin/compliance/public-performance/approvals', parsed);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'gate'] });
      toast.success('Approval recorded');
      onClose();
    },
  });
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title="Record a compliance approval"
      description="This records a sign-off that already happened. Recording it here does not itself make anything compliant."
    >
      <form onSubmit={(e) => void form.handleSubmit((v) => add.mutate(v))(e)} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Jurisdiction">{(c) => <Input {...c} autoFocus {...form.register('jurisdiction')} />}</Field>
          <Field label="Reviewer (name and role)">{(c) => <Input {...c} {...form.register('reviewerName')} />}</Field>
        </div>
        <Field label="What exactly was approved?">
          {(c) => <Textarea {...c} rows={2} {...form.register('scope')} />}
        </Field>
        <Field label="Document reference" hint="Where the signed review is kept.">
          {(c) => <Input {...c} {...form.register('documentReference')} />}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Effective from">
            {(c) => <Input {...c} type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />}
          </Field>
          <Field label="Expires">
            {(c) => <Input {...c} type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />}
          </Field>
        </div>
        <Field label="Notes">{(c) => <Textarea {...c} rows={2} {...form.register('notes')} />}</Field>
        <FormError error={add.error} />
        <Button type="submit" variant="primary" size="lg" loading={add.isPending}>
          Record approval
        </Button>
      </form>
    </Dialog>
  );
}

function ComplianceGate({ canEdit }: { canEdit: boolean }) {
  const client = useQueryClient();
  const gate = useQuery({
    queryKey: ['admin', 'gate'],
    queryFn: () => api.get<Gate>('/admin/compliance/public-performance'),
  });
  const [adding, setAdding] = useState(false);
  const revoke = useMutation({
    mutationFn: (id: string) => api.post(`/admin/compliance/public-performance/approvals/${id}/revoke`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['admin', 'gate'] }),
  });
  if (!gate.data) return null;
  const g = gate.data;
  return (
    <Card className="mt-4">
      <CardHeader
        title="Public performance section"
        description="Showing past results publicly is regulated. It stays closed until both keys below are turned."
        action={
          g.enabled ? (
            <Badge tone="update">
              <Unlock className="size-3" aria-hidden /> Open
            </Badge>
          ) : (
            <Badge>
              <Lock className="size-3" aria-hidden /> Closed
            </Badge>
          )
        }
      />
      <div className="flex flex-col gap-3 border-t border-line p-4 sm:p-5">
        <ol className="flex flex-col gap-2 text-sm">
          <li className="flex items-start gap-2">
            {g.flagEnabled ? (
              <Unlock className="mt-0.5 size-4 text-update" aria-hidden />
            ) : (
              <Lock className="mt-0.5 size-4 text-muted" aria-hidden />
            )}
            <span>
              <span className="font-medium">Deployment setting:</span>{' '}
              <code className="num text-[13px]">{g.deploymentFlag}</code> is {g.flagEnabled ? 'on' : 'off'}. It can only
              be changed on the server.
            </span>
          </li>
          <li className="flex items-start gap-2">
            {g.currentApprovalId ? (
              <Unlock className="mt-0.5 size-4 text-update" aria-hidden />
            ) : (
              <Lock className="mt-0.5 size-4 text-muted" aria-hidden />
            )}
            <span>
              <span className="font-medium">Compliance approval:</span>{' '}
              {g.currentApprovalId ? 'a current approval is on record.' : 'no current approval on record.'}
            </span>
          </li>
        </ol>
        <p className="flex items-start gap-2 rounded-lg bg-update-soft p-3 text-[13px] text-update">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />A disclaimer alone does not make a performance
          claim compliant. In India, past performance claims by research analysts and investment advisers have specific
          rules, so get this reviewed for every jurisdiction you serve.
        </p>
        {g.approvals.length > 0 && (
          <ul className="flex flex-col gap-2">
            {g.approvals.map((a) => (
              <li key={a.id} className="rounded-lg border border-line p-3 text-[13px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{a.jurisdiction}</span>
                  {a.revokedAt ? (
                    <Badge tone="stop">Revoked</Badge>
                  ) : a.id === g.currentApprovalId ? (
                    <Badge tone="success">Current</Badge>
                  ) : (
                    <Badge>Not in effect</Badge>
                  )}
                </div>
                <p className="mt-1 text-muted">{a.scope}</p>
                <p className="mt-1 text-muted">
                  {a.reviewerName} · {a.documentReference} · {formatDateTime(a.effectiveFrom)} to{' '}
                  {formatDateTime(a.expiresAt)}
                </p>
                {!a.revokedAt && canEdit && (
                  <Button size="sm" variant="ghost" className="mt-1" onClick={() => revoke.mutate(a.id)}>
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <Button className="self-start" onClick={() => setAdding(true)}>
            Record an approval
          </Button>
        )}
      </div>
      {adding && <ApprovalDialog onClose={() => setAdding(false)} />}
    </Card>
  );
}

export default function SettingsPage() {
  const me = useMe();
  const canEdit = me.data?.isMasterAdmin === true;
  const settings = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () =>
      api.get<SettingsValues & { id: number; updatedAt: string; dataResetAt: string | null }>('/admin/settings'),
  });
  const [initial, setInitial] = useState<SettingsValues | null>(null);
  useEffect(() => {
    if (settings.data && !initial) {
      const { id: _id, updatedAt: _u, dataResetAt: _r, ...values } = settings.data;
      setInitial(values);
    }
  }, [initial, settings.data]);
  return (
    <>
      <PageHeader
        title="Settings"
        description="Platform rules and service text. Changes are recorded in the audit log with their old and new values."
      />
      {settings.isPending && <Loading rows={3} label="Loading settings" />}
      {settings.isError && <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />}
      {initial && me.data && <SettingsForm initial={initial} canEdit={canEdit} />}
      {settings.data?.dataResetAt && (
        <p className="mt-3 text-[13px] text-muted">
          Demonstration data was cleared on {formatDateTime(settings.data.dataResetAt)}.
        </p>
      )}
      <ComplianceGate canEdit={canEdit} />
    </>
  );
}
