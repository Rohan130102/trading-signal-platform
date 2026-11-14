import {
  ENTRY_WINDOW_CHOICES,
  entryWindowLabel,
  supportSettingsSchema,
  type HistoryScope,
  type PlatformSettings,
  type SignalStartMode,
  type TrailingStopWording,
} from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { useSession } from '@/lib/session';
import { space } from '@/theme/tokens';
import {
  Button,
  Card,
  Chip,
  ChipRow,
  ErrorState,
  Field,
  errorMessage,
  Loading,
  Notice,
  Screen,
  SectionTitle,
  Segmented,
  T,
  ToggleRow,
  useToast,
} from '@/ui';

type Settings = PlatformSettings & Record<string, unknown>;

/**
 * Platform rules, changed by the Master Admin without touching code. Each change is saved at once, recorded
 * in the audit log with its old and new value, and reaches open apps straight away.
 */
export default function PlatformSettingsScreen() {
  const { me } = useSession();
  const canEdit = me?.isMasterAdmin === true;
  const client = useQueryClient();
  const toast = useToast();
  const settings = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.get<Settings>('/admin/settings'),
  });
  const refresh = useCallback(() => settings.refetch(), [settings]);
  const save = useMutation({
    mutationFn: async (change: Partial<PlatformSettings>) => {
      const { id: _id, updatedAt: _u, dataResetAt: _r, ...current } = settings.data as Settings;
      return api.put<Settings>('/admin/settings', { ...current, ...change });
    },
    onSuccess: (next) => {
      haptics.notify('success');
      client.setQueryData(['admin', 'settings'], next);
      toast({ tone: 'success', title: 'Saved' });
    },
    onError: (error) => toast({ tone: 'error', title: 'Not saved', body: errorMessage(error) }),
  });
  const s = settings.data;
  const set = (change: Partial<PlatformSettings>) => {
    if (canEdit && !save.isPending) save.mutate(change);
  };
  const windows = s
    ? [...new Set([0, ...ENTRY_WINDOW_CHOICES, s.entryExpiryMinutesDefault])].sort((a, b) => a - b)
    : [];
  return (
    <Screen edges={['bottom']} refresh={refresh} testID="platform-settings">
      {!canEdit && (
        <Notice tone="neutral" icon="lock-closed-outline">
          Only the Master Admin can change these. You can see what is in force.
        </Notice>
      )}
      {settings.isPending && <Loading rows={3} label="Loading settings" />}
      {settings.isError && <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />}
      {s && (
        <>
          <SectionTitle>Signals</SectionTitle>
          <Card style={{ gap: space.md }}>
            <T v="small" c="muted">
              A new signal starts as
            </T>
            <Segmented<SignalStartMode>
              label="A new signal starts as"
              value={s.signalStartMode}
              onChange={(v) => set({ signalStartMode: v })}
              options={[
                { value: 'AWAITING_ENTRY', label: 'Awaiting entry', testID: 'rule-start-waiting' },
                { value: 'ACTIVE', label: 'Active now', testID: 'rule-start-active' },
              ]}
            />
            <T v="caption" c="subtle">
              {s.signalStartMode === 'AWAITING_ENTRY'
                ? 'It waits until it is activated. If its entry window ends first, it is cancelled automatically and subscribers are told not to enter.'
                : 'It is active as soon as it is published. That is never a fill.'}
            </T>
            <T v="small" c="muted">
              Entry window
            </T>
            <ChipRow>
              {windows.map((m) => (
                <Chip
                  key={m}
                  testID={`rule-window-${m}`}
                  label={entryWindowLabel(m)}
                  on={s.entryExpiryMinutesDefault === m}
                  onPress={() => set({ entryExpiryMinutesDefault: m })}
                />
              ))}
            </ChipRow>
            <T v="small" c="muted">
              Trailing stop-loss alerts
            </T>
            <Segmented<TrailingStopWording>
              label="Trailing stop-loss alerts"
              value={s.trailingStopWording}
              onChange={(v) => set({ trailingStopWording: v })}
              options={[
                { value: 'GENERAL', label: 'General', testID: 'rule-trail-general' },
                { value: 'DETAILED', label: 'Show points', testID: 'rule-trail-detailed' },
              ]}
            />
            <T v="caption" c="subtle">
              {s.trailingStopWording === 'GENERAL'
                ? '“Trail the stop-loss on trade T-0012 to 3,350.00.”'
                : '“Stop-loss on trade T-0012 trailed from 3,300.00 to 3,350.00 (50 pts from 3,400.00).”'}
            </T>
          </Card>
          <SectionTitle>Subscribers</SectionTitle>
          <Card style={{ gap: space.md }}>
            <T v="small" c="muted">
              Each subscriber’s history
            </T>
            <Segmented<HistoryScope>
              label="Each subscriber’s history"
              value={s.historyScope}
              onChange={(v) => set({ historyScope: v })}
              options={[
                { value: 'MEMBERSHIP', label: 'From their membership', testID: 'rule-history-membership' },
                { value: 'ALL', label: 'Everything', testID: 'rule-history-all' },
              ]}
            />
            <View>
              <ToggleRow
                testID="rule-screenshots"
                label="Allow screenshots"
                hint="Default for subscribers. Override it for one subscriber on their page."
                value={s.screenshotsAllowedDefault}
                disabled={!canEdit}
                onChange={(v) => set({ screenshotsAllowedDefault: v })}
              />
            </View>
            <T v="caption" c="subtle">
              When blocked, Android blocks screenshots, recordings and the recent-apps preview. iPhone has no supported
              way to block them: the app hides content where iOS allows, blurs the app switcher and notes screenshots it
              sees. Web browsers cannot block them.
            </T>
          </Card>
          <SupportContact
            canEdit={canEdit}
            whatsapp={String(s.supportWhatsapp ?? '')}
            email={String(s.supportEmail ?? '')}
            onSaved={(next) => client.setQueryData(['admin', 'settings'], next)}
          />
          <T v="caption" c="subtle">
            Service texts, legal disclosures and public-results approvals are edited in the web admin.
          </T>
        </>
      )}
    </Screen>
  );
}

/** Where subscription enquiries go. Master Admin only; the change is audited and applies to every screen at once. */
function SupportContact({
  canEdit,
  whatsapp,
  email,
  onSaved,
}: {
  canEdit: boolean;
  whatsapp: string;
  email: string;
  onSaved: (next: Settings) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ supportWhatsapp: whatsapp, supportEmail: email });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => setForm({ supportWhatsapp: whatsapp, supportEmail: email }), [whatsapp, email]);
  const save = useMutation({
    mutationFn: (body: { supportWhatsapp: string; supportEmail: string }) =>
      api.put<Settings>('/admin/settings/support', body),
    onSuccess: (next) => {
      onSaved(next);
      toast({ tone: 'success', title: 'Support contact saved' });
    },
    onError: (error) => toast({ tone: 'error', title: 'Not saved', body: errorMessage(error) }),
  });
  const submit = () => {
    const parsed = supportSettingsSchema.safeParse(form);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };
  const changed = form.supportWhatsapp !== whatsapp || form.supportEmail !== email;
  return (
    <>
      <SectionTitle>Support contact</SectionTitle>
      <Card style={{ gap: space.md }} testID="support-contact-settings">
        <Field
          testID="support-whatsapp"
          label="WhatsApp number"
          hint="Subscription enquiries open WhatsApp to this number."
          value={form.supportWhatsapp}
          error={errors.supportWhatsapp}
          editable={canEdit}
          keyboardType="phone-pad"
          onChangeText={(v) => setForm((f) => ({ ...f, supportWhatsapp: v }))}
        />
        <Field
          testID="support-email"
          label="Support email"
          hint="Enquiries sent by email go here, from the server."
          value={form.supportEmail}
          error={errors.supportEmail}
          editable={canEdit}
          keyboardType="email-address"
          autoCapitalize="none"
          onChangeText={(v) => setForm((f) => ({ ...f, supportEmail: v }))}
        />
        {canEdit && (
          <Button
            testID="support-save"
            label="Save"
            variant="primary"
            disabled={!changed}
            loading={save.isPending}
            onPress={submit}
          />
        )}
      </Card>
    </>
  );
}
