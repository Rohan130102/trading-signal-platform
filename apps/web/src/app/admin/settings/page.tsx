'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { approvalSchema, settingsSchema } from '@signaldesk/domain';
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
  Textarea,
} from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

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

function SettingsForm({ initial }: { initial: SettingsValues }) {
  const client = useQueryClient();
  const form = useForm<SettingsValues>({ resolver: zodResolver(settingsSchema), defaultValues: initial });
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
          <Field
            label="Default entry deadline (hours)"
            error={e.entryExpiryHoursDefault?.message}
            hint="0 means signals do not expire on their own."
          >
            {(c) => (
              <Input
                {...c}
                className="num"
                type="number"
                min={0}
                {...form.register('entryExpiryHoursDefault', { valueAsNumber: true })}
              />
            )}
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
      <FormError error={save.error} />
      <Button type="submit" variant="primary" size="lg" className="self-start" loading={save.isPending}>
        Save settings
      </Button>
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

function ComplianceGate() {
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
                {!a.revokedAt && (
                  <Button size="sm" variant="ghost" className="mt-1" onClick={() => revoke.mutate(a.id)}>
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <Button className="self-start" onClick={() => setAdding(true)}>
          Record an approval
        </Button>
      </div>
      {adding && <ApprovalDialog onClose={() => setAdding(false)} />}
    </Card>
  );
}

export default function SettingsPage() {
  const settings = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.get<SettingsValues & { id: number; updatedAt: string }>('/admin/settings'),
  });
  const [initial, setInitial] = useState<SettingsValues | null>(null);
  useEffect(() => {
    if (settings.data && !initial) {
      const { id: _id, updatedAt: _u, ...values } = settings.data;
      setInitial(values);
    }
  }, [initial, settings.data]);
  return (
    <>
      <PageHeader title="Settings" />
      {settings.isPending && <Loading rows={3} label="Loading settings" />}
      {settings.isError && <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />}
      {initial && <SettingsForm initial={initial} />}
      <ComplianceGate />
    </>
  );
}
