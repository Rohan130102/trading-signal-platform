import {
  type AdminSettings,
  ENTRY_WINDOW_CHOICES,
  entryWindowLabel,
  type HistoryScope,
  type PublicInfo,
  settingsBody,
  type SettingsInput,
  settingsSchema,
  type SignalStartMode,
  type TrailingStopWording,
  TRIAL_DAY_SHORTCUTS,
} from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { EmailSettings } from '@/admin/EmailSettings';
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

const TABS = [
  { id: 'general', label: 'General', icon: 'business-outline' },
  { id: 'contact', label: 'Contact', icon: 'chatbubble-ellipses-outline' },
  { id: 'email', label: 'Email', icon: 'mail-outline' },
  { id: 'signup', label: 'Sign-up & trials', icon: 'person-add-outline' },
  { id: 'signals', label: 'Signals', icon: 'pulse-outline' },
  { id: 'legal', label: 'Legal', icon: 'document-text-outline' },
] as const;
type TabId = (typeof TABS)[number]['id'];

type TextKey = {
  [K in keyof SettingsInput]-?: NonNullable<SettingsInput[K]> extends string ? K : never;
}[keyof SettingsInput];

interface TextSpec {
  key: TextKey;
  label: string;
  hint?: string;
  lines?: number;
  keyboard?: 'default' | 'email-address' | 'phone-pad';
}

/**
 * A group of text settings with one Save button. Checked with the same rules as the server before sending, and
 * sent as the whole set of settings, so nothing else changes.
 */
function TextSettings({
  specs,
  settings,
  canEdit,
  onSave,
  saving,
  testID,
}: {
  specs: TextSpec[];
  settings: AdminSettings;
  canEdit: boolean;
  onSave: (change: Partial<SettingsInput>) => void;
  saving: boolean;
  testID: string;
}) {
  const valuesOf = (from: AdminSettings) =>
    Object.fromEntries(specs.map((s) => [s.key, String(from[s.key] ?? '')])) as Record<TextKey, string>;
  const [draft, setDraft] = useState(() => valuesOf(settings));
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Start again from the saved values only when they change (after a save or a refresh), never while typing.
  const [shown, setShown] = useState(settings);
  if (shown !== settings) {
    setShown(settings);
    setDraft(valuesOf(settings));
  }
  const changed = specs.some((s) => draft[s.key] !== String(settings[s.key] ?? ''));
  const submit = () => {
    const parsed = settingsSchema.safeParse(settingsBody(settings, draft as Partial<SettingsInput>));
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    onSave(draft as Partial<SettingsInput>);
  };
  return (
    <Card style={{ gap: space.md }} testID={testID}>
      {specs.map((s) => (
        <Field
          key={s.key}
          testID={`config-${s.key}`}
          label={s.label}
          hint={s.hint}
          value={draft[s.key]}
          error={errors[s.key]}
          editable={canEdit}
          multiline={Boolean(s.lines)}
          numberOfLines={s.lines}
          style={s.lines ? { minHeight: 22 * s.lines, textAlignVertical: 'top' } : undefined}
          keyboardType={s.keyboard ?? 'default'}
          autoCapitalize={s.keyboard === 'email-address' ? 'none' : 'sentences'}
          onChangeText={(v) => setDraft((d) => ({ ...d, [s.key]: v }))}
        />
      ))}
      {canEdit && (
        <Button
          testID={`${testID}-save`}
          label="Save"
          variant="primary"
          disabled={!changed}
          loading={saving}
          onPress={submit}
        />
      )}
    </Card>
  );
}

/**
 * Everything the Super Admin can change without a code update, in the same tabs as the website. Choices are saved
 * as soon as they are tapped; text has a Save button. Every change is recorded in the audit log.
 */
/** Only the Master Admin has this screen. Anyone else is sent back, as if it did not exist. */
export default function ConfigurationScreen() {
  const { me } = useSession();
  if (me && !me.isMasterAdmin) return <Redirect href="/" />;
  return <Configuration />;
}

function Configuration() {
  const { me } = useSession();
  const canEdit = me?.isMasterAdmin === true;
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<TabId>(() =>
    TABS.some((t) => t.id === params.tab) ? (params.tab as TabId) : 'general',
  );
  const client = useQueryClient();
  const toast = useToast();
  const settings = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.get<AdminSettings>('/admin/settings'),
  });
  const info = useQuery({ queryKey: ['public-info'], queryFn: () => api.get<PublicInfo>('/public/info') });
  const refresh = useCallback(() => Promise.all([settings.refetch(), info.refetch()]), [settings, info]);
  const save = useMutation({
    mutationFn: (change: Partial<SettingsInput>) =>
      api.put<AdminSettings>('/admin/settings', settingsBody(settings.data as AdminSettings, change)),
    onSuccess: (next) => {
      haptics.notify('success');
      client.setQueryData(['admin', 'settings'], next);
      void client.invalidateQueries({ queryKey: ['public-info'] });
      toast({ tone: 'success', title: 'Saved' });
    },
    onError: (error) => toast({ tone: 'error', title: 'Not saved', body: errorMessage(error) }),
  });
  const s = settings.data;
  const set = (change: Partial<SettingsInput>) => {
    if (canEdit && !save.isPending) save.mutate(change);
  };
  const windows = s
    ? [...new Set([0, ...ENTRY_WINDOW_CHOICES, s.entryExpiryMinutesDefault])].sort((a, b) => a - b)
    : [];
  const emailBlocked = info.data ? info.data.signupOpen && !info.data.signupAvailable : false;
  const textProps = { canEdit, onSave: set, saving: save.isPending };

  return (
    <Screen edges={['bottom']} refresh={refresh} testID="platform-settings">
      <ChipRow>
        {TABS.map((t) => (
          <Chip
            key={t.id}
            testID={`config-tab-${t.id}`}
            icon={t.icon}
            label={t.id === 'email' && emailBlocked ? `${t.label} !` : t.label}
            on={tab === t.id}
            onPress={() => setTab(t.id)}
          />
        ))}
      </ChipRow>
      {settings.isPending && <Loading rows={3} label="Loading configuration" />}
      {settings.isError && <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />}

      {s && tab === 'general' && (
        <>
          <SectionTitle>Your service</SectionTitle>
          <TextSettings
            {...textProps}
            testID="config-service"
            settings={s}
            specs={[
              { key: 'serviceName', label: 'Service name' },
              {
                key: 'serviceDescription',
                label: 'Short description',
                hint: 'On the home page. Do not state accuracy, returns or guarantees.',
                lines: 3,
              },
              {
                key: 'businessTimezone',
                label: 'Business time zone',
                hint: 'Decides when a subscription day starts and ends, such as Asia/Kolkata.',
              },
            ]}
          />
          <SectionTitle>About us</SectionTitle>
          <TextSettings
            {...textProps}
            testID="config-about"
            settings={s}
            specs={[
              {
                key: 'aboutBody',
                label: 'About us text',
                hint: 'Shown on the About page of the website and from the app. Leave a blank line between paragraphs.',
                lines: 8,
              },
            ]}
          />
        </>
      )}

      {s && tab === 'contact' && (
        <>
          <SectionTitle>Where enquiries go</SectionTitle>
          <TextSettings
            {...textProps}
            testID="config-enquiries"
            settings={s}
            specs={[
              {
                key: 'supportWhatsapp',
                label: 'Support WhatsApp number',
                hint: 'Include the country code, such as +91.',
                keyboard: 'phone-pad',
              },
              { key: 'supportEmail', label: 'Support email', keyboard: 'email-address' },
            ]}
          />
          <SectionTitle>What people are told</SectionTitle>
          <TextSettings
            {...textProps}
            testID="config-told"
            settings={s}
            specs={[
              { key: 'supportContact', label: 'Support contact line', hint: 'Shown publicly and to members.' },
              {
                key: 'renewalInstructions',
                label: 'Message for members whose access ended',
                hint: 'Optional. Shown with the renewal button.',
                lines: 3,
              },
            ]}
          />
        </>
      )}

      {tab === 'email' && <EmailSettings canEdit={canEdit} defaultTestTo={me?.profile?.email ?? ''} />}

      {s && tab === 'signup' && (
        <>
          <SectionTitle>Sign-up</SectionTitle>
          <Card style={{ gap: space.md }}>
            <ToggleRow
              testID="config-signup-open"
              label="Allow new sign-ups"
              hint={
                s.signupOpen
                  ? 'Anyone can sign up with their email. They get no signals until you start a subscription or trial.'
                  : 'Sign-up is paused. The sign-up screen tells people to contact support.'
              }
              value={s.signupOpen}
              disabled={!canEdit}
              onChange={(v) => set({ signupOpen: v })}
            />
            {emailBlocked && (
              <Notice tone="update" icon="warning" title="Email is not set up">
                Sign-up sends a code by email, so nobody new can join until it is.
              </Notice>
            )}
            {emailBlocked && <Button testID="config-go-email" label="Set up email" onPress={() => setTab('email')} />}
          </Card>
          <SectionTitle>Free trials</SectionTitle>
          <Card style={{ gap: space.md }}>
            <T v="small" c="muted">
              Usual trial length. Filled in when a trial is granted; it can be changed each time, up to 90 days.
            </T>
            <ChipRow>
              {[...new Set([...TRIAL_DAY_SHORTCUTS, 30, s.defaultTrialDays])]
                .sort((a, b) => a - b)
                .map((d) => (
                  <Chip
                    key={d}
                    testID={`config-trial-${d}`}
                    label={`${d} days`}
                    on={s.defaultTrialDays === d}
                    onPress={() => set({ defaultTrialDays: d })}
                  />
                ))}
            </ChipRow>
            <T v="caption" c="subtle">
              Any administrator can give any member free days, from New Registrations or the member’s page.
            </T>
          </Card>
        </>
      )}

      {s && tab === 'signals' && (
        <>
          <SectionTitle>New signals</SectionTitle>
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
                ? 'It waits until it is activated. If its entry window ends first, it is cancelled automatically and members are told not to enter.'
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
          <SectionTitle>What members see</SectionTitle>
          <Card style={{ gap: space.md }}>
            <T v="small" c="muted">
              Each member’s history
            </T>
            <Segmented<HistoryScope>
              label="Each member’s history"
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
                hint="Default for members. Override it for one member on their page."
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
        </>
      )}

      {s && tab === 'legal' && (
        <>
          <SectionTitle>Legal text</SectionTitle>
          <TextSettings
            {...textProps}
            testID="config-legal"
            settings={s}
            specs={[
              { key: 'legalEntityName', label: 'Legal entity name' },
              {
                key: 'regulatoryStatement',
                label: 'Regulatory statement',
                hint: 'Empty until your status is established. Never claim a registration you do not hold.',
                lines: 3,
              },
              { key: 'riskDisclosure', label: 'Risk disclosure', lines: 8 },
              { key: 'privacyNotice', label: 'Privacy notice', lines: 6 },
            ]}
          />
          <T v="caption" c="subtle">
            Approvals for publishing past results are recorded on the website, under Configuration, Legal.
          </T>
        </>
      )}
    </Screen>
  );
}
