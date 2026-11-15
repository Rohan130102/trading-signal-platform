import {
  EMAIL_PRESETS,
  EMAIL_STATUS_COPY,
  type EmailPreset,
  type EmailSecurity,
  type EmailSettingsView,
  emailPresetFor,
  emailSettingsSchema,
  formatDateTime,
} from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { space } from '@/theme/tokens';
import { Button, Card, ErrorState, Field, Loading, Notice, Segmented, T, ToggleRow, useToast } from '@/ui';

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

function toDraft(view: EmailSettingsView): Draft {
  return {
    enabled: view.enabled,
    preset: view.host ? emailPresetFor(view.host) : 'GMAIL',
    host: view.host || (EMAIL_PRESETS[0]?.host ?? ''),
    port: String(view.port),
    security: view.security,
    username: view.username,
    password: '',
    fromName: view.fromName,
    fromAddress: view.fromAddress,
  };
}

/**
 * The email account that sends sign-up codes and account emails, as on the website's configuration screen. The
 * password can be replaced but never read back.
 */
export function EmailSettings({ canEdit, defaultTestTo }: { canEdit: boolean; defaultTestTo: string }) {
  const client = useQueryClient();
  const toast = useToast();
  const view = useQuery({
    queryKey: ['admin', 'settings', 'email'],
    queryFn: () => api.get<EmailSettingsView>('/admin/settings/email'),
    enabled: canEdit,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [testTo, setTestTo] = useState(defaultTestTo);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (view.data && !dirty) setDraft(toDraft(view.data));
  }, [view.data, dirty]);

  const save = useMutation({
    mutationFn: (body: unknown) => api.put<EmailSettingsView>('/admin/settings/email', body),
    onSuccess: (next) => {
      haptics.notify('success');
      client.setQueryData(['admin', 'settings', 'email'], next);
      void client.invalidateQueries({ queryKey: ['public-info'] });
      setDirty(false);
      setDraft(toDraft(next));
      setResult(null);
      toast({ tone: 'success', title: next.enabled ? 'Email saved. Send a test to check it.' : 'Email saved' });
    },
    onError: (error) => {
      const list = error instanceof ApiError ? error.details?.issues : undefined;
      if (list) setIssues(Object.fromEntries(list.map((i) => [i.field, i.message])));
      else toast({ tone: 'error', title: 'Not saved', body: (error as Error).message });
    },
  });
  const test = useMutation({
    mutationFn: () => api.post('/admin/settings/email/test', { to: testTo.trim() }),
    onSuccess: () => {
      setResult({ ok: true, message: `Test email sent to ${testTo.trim()}. Check the inbox, and the spam folder.` });
      void client.invalidateQueries({ queryKey: ['admin', 'settings', 'email'] });
    },
    onError: (error) => setResult({ ok: false, message: (error as Error).message }),
  });

  if (!canEdit) return null;
  if (view.isError) return <ErrorState error={view.error} onRetry={() => void view.refetch()} />;
  if (!view.data || !draft) return <Loading rows={3} label="Loading email settings" />;

  const v = view.data;
  const preset = EMAIL_PRESETS.find((p) => p.id === draft.preset) ?? EMAIL_PRESETS[2];
  const known = draft.preset !== 'OTHER';
  const update = (change: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...change } : d));
    setDirty(true);
    setIssues({});
  };
  const pickPreset = (id: EmailPreset['id']) => {
    const p = EMAIL_PRESETS.find((x) => x.id === id);
    update({ preset: id, host: p?.host || '', port: String(p?.port ?? 587), security: p?.security ?? 'STARTTLS' });
    setAdvanced(id === 'OTHER');
  };
  const submit = () => {
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
  const status = EMAIL_STATUS_COPY[v.status];

  return (
    <View style={{ gap: space.md }} testID="config-email">
      <Notice
        tone={v.status === 'READY' ? 'success' : v.status === 'NOT_SET_UP' ? 'update' : 'neutral'}
        icon={v.status === 'READY' ? 'checkmark-circle' : v.status === 'NOT_SET_UP' ? 'warning' : 'information-circle'}
        title={status.title}
      >
        {status.body}
        {v.status === 'READY' && v.testedAt ? `\nLast test accepted ${formatDateTime(v.testedAt)}.` : ''}
      </Notice>
      <Card style={{ gap: space.md }}>
        <ToggleRow
          testID="email-enabled"
          label="Send email from this account"
          hint="Sign-up codes, enquiry emails and messages about subscriptions and trials."
          value={draft.enabled}
          onChange={(enabled) => update({ enabled })}
        />
        <T v="small" c="muted">
          Email provider
        </T>
        <Segmented<EmailPreset['id']>
          label="Email provider"
          value={draft.preset}
          onChange={pickPreset}
          options={EMAIL_PRESETS.map((p) => ({ value: p.id, label: p.label, testID: `email-preset-${p.id}` }))}
        />
        <Field
          testID="email-from-name"
          label="Sender name"
          placeholder="SignalDesk"
          value={draft.fromName}
          error={issues.fromName}
          onChangeText={(fromName) => update({ fromName })}
        />
        <Field
          testID="email-from-address"
          label="Email address"
          hint="The address emails are sent from."
          placeholder="desk@gmail.com"
          value={draft.fromAddress}
          error={issues.fromAddress}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={(fromAddress) => update({ fromAddress })}
        />
        <Field
          testID="email-password"
          label={draft.preset === 'GMAIL' ? 'App password' : 'Password'}
          hint={
            v.passwordSet && !draft.password
              ? `A password is saved. ${preset?.passwordHint ?? ''}`
              : preset?.passwordHint
          }
          placeholder={v.passwordSet ? 'Saved. Leave empty to keep it' : undefined}
          value={draft.password}
          error={issues.password}
          secret
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={(password) => update({ password })}
        />
        {known && !advanced ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
            <T v="small" c="muted" num>
              {`${draft.host}, port ${draft.port}, ${draft.security === 'TLS' ? 'SSL/TLS' : 'STARTTLS'}`}
            </T>
            <Button small variant="ghost" label="Change" testID="email-advanced" onPress={() => setAdvanced(true)} />
          </View>
        ) : (
          <>
            <Field
              testID="email-host"
              label="SMTP server"
              placeholder="smtp.example.com"
              value={draft.host}
              error={issues.host}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(host) => update({ host, preset: emailPresetFor(host) })}
            />
            <Field
              testID="email-port"
              label="Port"
              value={draft.port}
              error={issues.port}
              keyboardType="number-pad"
              onChangeText={(port) => update({ port: port.replace(/\D/g, '') })}
            />
            <Segmented<EmailSecurity>
              label="Security"
              value={draft.security}
              onChange={(security) => update({ security })}
              options={[
                { value: 'STARTTLS', label: 'STARTTLS (587)', testID: 'email-security-starttls' },
                { value: 'TLS', label: 'SSL/TLS (465)', testID: 'email-security-tls' },
              ]}
            />
            <Field
              testID="email-username"
              label="Username"
              hint="Usually the email address."
              value={draft.username}
              error={issues.username}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(username) => update({ username })}
            />
          </>
        )}
        <Button
          testID="email-save"
          label="Save email settings"
          variant="primary"
          disabled={!dirty}
          loading={save.isPending}
          onPress={submit}
        />
      </Card>
      <Card style={{ gap: space.md }}>
        <T v="strong">Send a test email</T>
        <T v="small" c="muted">
          Uses the saved details, whether or not they are switched on.
        </T>
        <Field
          testID="email-test-to"
          label="Send the test to"
          placeholder="you@example.com"
          value={testTo}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setTestTo}
        />
        <Button
          testID="email-test"
          label="Send test email"
          icon="send-outline"
          disabled={dirty || !testTo.trim() || !v.host}
          loading={test.isPending}
          onPress={() => {
            setResult(null);
            test.mutate();
          }}
        />
        {dirty && (
          <T v="small" c="muted">
            Save your changes first.
          </T>
        )}
        {result && (
          <Notice tone={result.ok ? 'success' : 'stop'} icon={result.ok ? 'checkmark-circle' : 'warning'}>
            {result.message}
          </Notice>
        )}
      </Card>
    </View>
  );
}
