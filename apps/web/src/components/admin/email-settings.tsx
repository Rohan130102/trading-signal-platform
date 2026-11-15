'use client';

import {
  EMAIL_PRESETS,
  EMAIL_SECURITY,
  EMAIL_SECURITY_LABELS,
  EMAIL_STATUS_COPY,
  type EmailPreset,
  type EmailSecurity,
  type EmailSettingsView,
  type EmailStatus,
  emailPresetFor,
  emailSettingsSchema,
} from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Info, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button, Card, ErrorState, Field, FormError, Input, Loading, Segmented, Select, Switch } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface Draft {
  enabled: boolean;
  preset: EmailPreset['id'];
  host: string;
  port: string;
  security: EmailSecurity;
  username: string;
  password: string;
  fromName: string;
  fromAddress: string;
}

const STATUS_TONE: Record<EmailStatus, string> = {
  READY: 'border-success/30 bg-success-soft text-success',
  SERVER: 'border-line bg-neutral-soft text-muted',
  NOT_SET_UP: 'border-update/30 bg-update-soft text-update',
};

function toDraft(view: EmailSettingsView): Draft {
  return {
    enabled: view.enabled,
    preset: view.host ? emailPresetFor(view.host) : 'GMAIL',
    host: view.host || EMAIL_PRESETS[0]!.host,
    port: String(view.port),
    security: view.security,
    username: view.username,
    password: '',
    fromName: view.fromName,
    fromAddress: view.fromAddress,
  };
}

function StatusBanner({ status, testedAt }: { status: EmailStatus; testedAt: string | null }) {
  const copy = EMAIL_STATUS_COPY[status];
  const Icon = status === 'READY' ? CheckCircle2 : status === 'NOT_SET_UP' ? AlertTriangle : Info;
  return (
    <div className={clsx('flex items-start gap-3 rounded-xl border p-4', STATUS_TONE[status])} role="status">
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{copy.title}</p>
        <p className="mt-0.5 text-[13px]">{copy.body}</p>
        {testedAt && status === 'READY' && (
          <p className="mt-1 text-[13px]">Last test accepted {formatDateTime(testedAt)}.</p>
        )}
      </div>
    </div>
  );
}

/**
 * The email account that sends sign-up codes and account emails, set by the Super Admin from here instead of on
 * the server. The password is write-only: the screen only ever learns whether one is saved.
 */
export function EmailSettings({ canEdit, defaultTestTo }: { canEdit: boolean; defaultTestTo: string }) {
  const client = useQueryClient();
  const view = useQuery({
    queryKey: ['admin', 'settings', 'email'],
    queryFn: () => api.get<EmailSettingsView>('/admin/settings/email'),
    enabled: canEdit,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [testTo, setTestTo] = useState(defaultTestTo);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (view.data && !dirty) setDraft(toDraft(view.data));
  }, [view.data, dirty]);

  const save = useMutation({
    mutationFn: (body: unknown) => api.put<EmailSettingsView>('/admin/settings/email', body),
    onSuccess: (next) => {
      client.setQueryData(['admin', 'settings', 'email'], next);
      void client.invalidateQueries({ queryKey: ['public-info'] });
      setDirty(false);
      setDraft(toDraft(next));
      setTestResult(null);
      toast.success(next.enabled ? 'Email saved. Send a test to check it.' : 'Email saved');
    },
    onError: (error) => {
      const list = (
        error instanceof ApiError ? (error.details as { issues?: { field: string; message: string }[] }) : null
      )?.issues;
      if (list) setIssues(Object.fromEntries(list.map((i) => [i.field, i.message])));
    },
  });
  const test = useMutation({
    mutationFn: () => api.post('/admin/settings/email/test', { to: testTo.trim() }),
    onSuccess: () => {
      setTestResult({
        ok: true,
        message: `Test email sent to ${testTo.trim()}. Check the inbox, and the spam folder.`,
      });
      void client.invalidateQueries({ queryKey: ['admin', 'settings', 'email'] });
    },
    onError: (error) => setTestResult({ ok: false, message: (error as Error).message }),
  });

  if (!canEdit) return null;
  if (view.isPending || !draft) return <Loading rows={3} label="Loading email settings" />;
  if (view.isError) return <ErrorState error={view.error} onRetry={() => void view.refetch()} />;

  const preset = EMAIL_PRESETS.find((p) => p.id === draft.preset) ?? EMAIL_PRESETS[2]!;
  const known = draft.preset !== 'OTHER';
  const update = (change: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...change } : d));
    setDirty(true);
    setIssues({});
  };
  const pickPreset = (id: EmailPreset['id']) => {
    const p = EMAIL_PRESETS.find((x) => x.id === id) ?? EMAIL_PRESETS[2]!;
    update({
      preset: id,
      host: p.host || (draft.preset === 'OTHER' ? draft.host : ''),
      port: String(p.port),
      security: p.security,
    });
    setAdvanced(id === 'OTHER');
  };
  const submit = () => {
    // A known provider signs in with the sending address itself.
    const body = {
      enabled: draft.enabled,
      host: draft.host,
      port: Number(draft.port),
      security: draft.security,
      username: known && !advanced ? draft.fromAddress : draft.username,
      password: draft.password || undefined,
      fromName: draft.fromName,
      fromAddress: draft.fromAddress,
    };
    const parsed = emailSettingsSchema.safeParse(body);
    if (!parsed.success) {
      setIssues(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    save.mutate(body);
  };
  const v = view.data;

  return (
    <div className="flex flex-col gap-4">
      <StatusBanner status={v.status} testedAt={v.testedAt} />
      <Card className="flex flex-col gap-5 p-4 sm:p-5">
        <div className="rounded-lg border border-line px-3">
          <Switch
            label="Send email from this account"
            description="Sign-up codes, enquiry emails to support, and messages about subscriptions and trials."
            checked={draft.enabled}
            onChange={(enabled) => update({ enabled })}
          />
        </div>
        <Field label="Email provider">
          {() => (
            <Segmented<EmailPreset['id']>
              label="Email provider"
              value={draft.preset}
              onChange={pickPreset}
              options={EMAIL_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
            />
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Sender name" hint="Shown as who the email is from." error={issues.fromName}>
            {(c) => (
              <Input
                {...c}
                value={draft.fromName}
                placeholder="SignalDesk"
                onChange={(e) => update({ fromName: e.target.value })}
              />
            )}
          </Field>
          <Field label="Email address" hint="The address emails are sent from." error={issues.fromAddress}>
            {(c) => (
              <Input
                {...c}
                type="email"
                inputMode="email"
                autoComplete="off"
                value={draft.fromAddress}
                placeholder="desk@gmail.com"
                onChange={(e) => update({ fromAddress: e.target.value })}
              />
            )}
          </Field>
        </div>
        <Field
          label={draft.preset === 'GMAIL' ? 'App password' : 'Password'}
          hint={v.passwordSet && !draft.password ? `A password is saved. ${preset.passwordHint}` : preset.passwordHint}
          error={issues.password}
        >
          {(c) => (
            <div className="relative">
              <Input
                {...c}
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={draft.password}
                placeholder={v.passwordSet ? 'Saved. Leave empty to keep it' : ''}
                onChange={(e) => update({ password: e.target.value })}
                className="pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-muted hover:text-text"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
              </button>
            </div>
          )}
        </Field>

        {known && !advanced ? (
          <p className="text-[13px] text-muted">
            Server <span className="num">{draft.host}</span>, port <span className="num">{draft.port}</span>,{' '}
            {draft.security === 'TLS' ? 'SSL/TLS' : 'STARTTLS'}.{' '}
            <button
              type="button"
              className="font-medium text-text underline underline-offset-2"
              onClick={() => setAdvanced(true)}
            >
              Change
            </button>
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[1fr_7rem_14rem]">
            <Field label="SMTP server" error={issues.host}>
              {(c) => (
                <Input
                  {...c}
                  value={draft.host}
                  placeholder="smtp.example.com"
                  autoCapitalize="none"
                  onChange={(e) => update({ host: e.target.value, preset: emailPresetFor(e.target.value) })}
                />
              )}
            </Field>
            <Field label="Port" error={issues.port}>
              {(c) => (
                <Input
                  {...c}
                  inputMode="numeric"
                  value={draft.port}
                  onChange={(e) => update({ port: e.target.value.replace(/\D/g, '') })}
                />
              )}
            </Field>
            <Field label="Security">
              {(c) => (
                <Select
                  {...c}
                  value={draft.security}
                  onChange={(e) => update({ security: e.target.value as EmailSecurity })}
                >
                  {EMAIL_SECURITY.map((s) => (
                    <option key={s} value={s}>
                      {EMAIL_SECURITY_LABELS[s]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Username" hint="Usually the email address." error={issues.username} className="sm:col-span-3">
              {(c) => (
                <Input
                  {...c}
                  autoComplete="off"
                  value={draft.username}
                  onChange={(e) => update({ username: e.target.value })}
                />
              )}
            </Field>
          </div>
        )}
        <FormError error={save.error} />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={submit} loading={save.isPending} disabled={!dirty}>
            Save email settings
          </Button>
          {dirty && <span className="text-[13px] text-muted">Unsaved changes</span>}
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-4 sm:p-5">
        <div>
          <h3 className="text-sm font-semibold">Send a test email</h3>
          <p className="mt-0.5 text-[13px] text-muted">Uses the saved details, whether or not they are switched on.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label="Send the test to"
            type="email"
            inputMode="email"
            value={testTo}
            placeholder="you@example.com"
            onChange={(e) => setTestTo(e.target.value)}
            className="sm:max-w-xs"
          />
          <Button
            onClick={() => {
              setTestResult(null);
              test.mutate();
            }}
            loading={test.isPending}
            disabled={dirty || !testTo.trim() || !v.host}
          >
            <Send className="size-4" aria-hidden />
            Send test email
          </Button>
        </div>
        {dirty && <p className="text-[13px] text-muted">Save your changes first.</p>}
        {testResult && (
          <p
            role="status"
            className={clsx('flex items-start gap-2 text-[13px]', testResult.ok ? 'text-success' : 'text-stop')}
          >
            {testResult.ok ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            ) : (
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            )}
            {testResult.message}
          </p>
        )}
      </Card>
    </div>
  );
}
