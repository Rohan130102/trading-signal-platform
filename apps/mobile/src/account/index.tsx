import {
  changePasswordSchema,
  type DeviceBindingView,
  formatDateTime,
  formatLocalDate,
  type NotificationPreferences,
  type PushDevice,
} from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Linking, View } from 'react-native';
import { api } from '@/lib/api';
import { APP_VERSION, IN_EXPO_GO, websiteUrl } from '@/lib/config';
import { hapticsEnabled, onHapticsChange, setHapticsEnabled } from '@/lib/haptics';
import { disablePush, enablePush, openSystemSettings, type PushStatus, readPushStatus } from '@/lib/push';
import { useMe, useSession } from '@/lib/session';
import { type ThemeChoice, useTheme } from '@/theme';
import { space } from '@/theme/tokens';
import {
  Badge,
  Button,
  Card,
  Divider,
  errorMessage,
  Field,
  FormError,
  ListRow,
  Notice,
  SectionTitle,
  Segmented,
  Sheet,
  Stat,
  T,
  ToggleRow,
  useToast,
} from '@/ui';

export function SubscriptionCard() {
  const me = useMe();
  const { subscription: s } = me;
  const ending = s.state === 'ACTIVE' && s.daysRemaining <= 7;
  return (
    <Card testID="subscription" style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <T v="heading" numberOfLines={1}>
            {me.name}
          </T>
          <T v="small" c="muted" num numberOfLines={1}>
            {me.loginId}
          </T>
        </View>
        <Badge tone={ending ? 'update' : s.state === 'ACTIVE' ? 'success' : 'stop'}>
          {s.state === 'ACTIVE' ? (ending ? 'Ending soon' : 'Active') : 'Not active'}
        </Badge>
      </View>
      <Divider />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
        <Stat
          label="Last valid day"
          value={s.lastValidDate ? formatLocalDate(s.lastValidDate) : 'None'}
          hint={s.timezone}
        />
        <Stat label="Days left" value={s.daysRemaining} hint="Including today" tone={ending ? 'update' : undefined} />
      </View>
      {ending && me.support.renewalInstructions ? (
        <Notice tone="update" title="Renew to keep receiving signals">
          {me.support.renewalInstructions}
        </Notice>
      ) : null}
    </Card>
  );
}

function usePushStatus() {
  const [status, setStatus] = useState<PushStatus>('checking');
  const check = useCallback(() => {
    void readPushStatus()
      .then(setStatus)
      .catch(() => setStatus('checking'));
  }, []);
  useEffect(() => {
    check();
    // Permission may have been changed in system settings while away.
    const listener = AppState.addEventListener('change', (next) => {
      if (next === 'active') check();
    });
    return () => listener.remove();
  }, [check]);
  return { status, setStatus, check };
}

const PREFERENCES: { key: keyof NotificationPreferences; label: string; hint?: string }[] = [
  { key: 'pushNewSignals', label: 'New signals' },
  { key: 'pushUpdates', label: 'Stop-loss, target and profit updates' },
  { key: 'pushClosures', label: 'Trade closures' },
  { key: 'pushAnnouncements', label: 'Announcements' },
  {
    key: 'hidePreview',
    label: 'Hide details on the lock screen',
    hint: 'Alerts say only "New update". Open the app for prices.',
  },
];

function NotificationSettings() {
  const client = useQueryClient();
  const toast = useToast();
  const push = usePushStatus();
  const [busy, setBusy] = useState(false);
  const prefs = useQuery({
    queryKey: ['prefs'],
    queryFn: () => api.get<NotificationPreferences>('/me/notification-preferences'),
  });
  const devices = useQuery({
    queryKey: ['devices', push.status],
    queryFn: () => api.get<{ devices: PushDevice[] }>('/push/devices'),
  });
  const save = useMutation({
    mutationFn: (next: NotificationPreferences) =>
      api.put<NotificationPreferences>('/me/notification-preferences', next),
    onMutate: (next) => client.setQueryData(['prefs'], next),
    onError: (error) => {
      toast({ title: 'Not saved', body: errorMessage(error), tone: 'error' });
      void client.invalidateQueries({ queryKey: ['prefs'] });
    },
  });
  const test = useMutation({
    mutationFn: () => api.post<{ accepted: number; attempted: number }>('/push/test'),
    onSuccess: (result) =>
      toast({
        title: result.accepted > 0 ? 'Sent' : 'Nothing was accepted',
        body:
          result.accepted > 0
            ? 'The push service accepted it. It should arrive shortly, but arrival cannot be confirmed.'
            : 'No device could be reached. Try turning notifications off and on again.',
        tone: result.accepted > 0 ? 'success' : 'warning',
      }),
    onError: (error) => toast({ title: 'Could not send', body: errorMessage(error), tone: 'error' }),
  });
  const turnOn = async () => {
    setBusy(true);
    try {
      push.setStatus(await enablePush());
    } catch (error) {
      toast({ title: 'Could not turn on notifications', body: errorMessage(error), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    setBusy(true);
    await disablePush().catch(() => undefined);
    setBusy(false);
    push.check();
    void client.invalidateQueries({ queryKey: ['devices'] });
  };

  return (
    <>
      <SectionTitle>Notifications</SectionTitle>
      <Card testID="notifications" style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <T v="strong">This phone</T>
          <Badge
            tone={push.status === 'on' ? 'success' : 'neutral'}
            icon={push.status === 'on' ? 'notifications' : 'notifications-off'}
          >
            {push.status === 'on' ? 'On' : 'Off'}
          </Badge>
        </View>
        {push.status === 'ready' && (
          <>
            <T v="small" c="muted">
              Get alerts about new signals and changes, even when the app is closed.
            </T>
            <Button
              testID="push-enable"
              label="Turn on notifications"
              variant="primary"
              loading={busy}
              onPress={() => void turnOn()}
            />
          </>
        )}
        {push.status === 'on' && (
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button
              style={{ flex: 1 }}
              testID="push-test"
              label="Send a test"
              small
              icon="paper-plane-outline"
              loading={test.isPending}
              onPress={() => test.mutate()}
            />
            <Button
              style={{ flex: 1 }}
              testID="push-disable"
              label="Turn off"
              small
              loading={busy}
              onPress={() => void turnOff()}
            />
          </View>
        )}
        {push.status === 'denied' && (
          <>
            <T v="small" c="muted">
              Notifications are blocked for this app. Allow them in your phone's settings. Until then, updates still
              appear in the feed while the app is open.
            </T>
            <Button label="Open settings" icon="settings-outline" onPress={openSystemSettings} />
          </>
        )}
        {push.status === 'needs-real-build' && (
          <Notice tone="neutral" title="Not available here">
            {IN_EXPO_GO
              ? 'Expo Go cannot receive alerts. They need a real build of this app, on a real phone.'
              : 'Simulators cannot receive alerts. They need a real phone.'}{' '}
            Updates still appear in the feed while the app is open.
          </Notice>
        )}
        {push.status === 'not-configured' && (
          <Notice tone="neutral" title="Not set up in this build">
            This build has no notification project. Updates still appear in the feed while the app is open.
          </Notice>
        )}
        {push.status === 'server-off' && (
          <Notice tone="neutral" title="Not available right now">
            The service is not sending notifications. Updates still appear in the feed while the app is open.
          </Notice>
        )}
        <T v="caption" c="subtle">
          Alerts depend on your phone, your network and the push service. They can be delayed or missed, so check the
          app before acting.
        </T>
        {prefs.data && (
          <View style={{ marginTop: space.sm }}>
            <Divider />
            {PREFERENCES.map(({ key, label, hint }) => (
              <ToggleRow
                key={key}
                testID={`pref-${key}`}
                label={label}
                hint={hint}
                value={prefs.data[key]}
                onChange={(value) => save.mutate({ ...prefs.data, [key]: value })}
              />
            ))}
          </View>
        )}
        {(devices.data?.devices.length ?? 0) > 0 && (
          <View style={{ marginTop: space.sm }}>
            <Divider />
            <T v="small" c="muted" style={{ marginTop: space.sm }}>
              Devices receiving alerts
            </T>
            {devices.data?.devices.map((device) => (
              <ListRow
                key={device.id}
                icon={device.channel === 'EXPO' ? 'phone-portrait-outline' : 'globe-outline'}
                title={device.deviceLabel ?? 'Unknown device'}
                subtitle={device.thisDevice ? 'This device' : undefined}
              />
            ))}
          </View>
        )}
      </Card>
    </>
  );
}

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
];

function AppearanceSettings() {
  const { choice, setChoice } = useTheme();
  return (
    <>
      <SectionTitle>Appearance</SectionTitle>
      <Segmented
        label="Theme"
        options={THEMES.map((t) => ({ ...t, testID: `theme-${t.value}` }))}
        value={choice}
        onChange={setChoice}
      />
    </>
  );
}

function ChangePassword({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [problem, setProblem] = useState<string | undefined>();
  const change = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) => api.post('/auth/change-password', body),
    onSuccess: () => {
      toast({ title: 'Password changed', body: 'Other devices were signed out.', tone: 'success' });
      onClose();
    },
  });
  const submit = () => {
    const parsed = changePasswordSchema.safeParse({ currentPassword: current, newPassword: next });
    if (!parsed.success) {
      setProblem(parsed.error.flatten().fieldErrors.newPassword?.[0] ?? 'Fill in both fields.');
      return;
    }
    setProblem(undefined);
    change.mutate(parsed.data);
  };
  return (
    <Sheet
      title="Change password"
      onClose={onClose}
      footer={
        <Button
          testID="change-password-submit"
          label="Change password"
          variant="primary"
          large
          loading={change.isPending}
          onPress={submit}
        />
      }
    >
      <Field
        testID="change-current"
        label="Current password"
        value={current}
        onChangeText={setCurrent}
        secret
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
      />
      <Field
        testID="change-new"
        label="New password"
        hint="At least 10 characters."
        value={next}
        onChangeText={setNext}
        error={problem}
        secret
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <FormError error={change.error} />
    </Sheet>
  );
}

function FeedbackSettings() {
  const [on, setOn] = useState(hapticsEnabled());
  useEffect(() => onHapticsChange(setOn), []);
  return (
    <>
      <SectionTitle>Feedback</SectionTitle>
      <Card padded={false} style={{ paddingHorizontal: space.lg }}>
        <ToggleRow
          testID="haptics-toggle"
          label="Haptic feedback"
          hint="Gentle taps for new alerts and completed actions. Your phone's own vibration settings still apply."
          value={on}
          onChange={(value) => {
            setOn(value);
            void setHapticsEnabled(value);
          }}
        />
      </Card>
    </>
  );
}

/** Explains the one-account-per-phone rule in plain words, without any identifiers. */
function ThisPhone() {
  const device = useQuery({
    queryKey: ['device'],
    queryFn: () => api.get<{ device: DeviceBindingView | null }>('/me/device'),
    select: (data) => data.device,
  });
  return (
    <>
      <SectionTitle>This phone</SectionTitle>
      <Card style={{ gap: space.sm }} testID="this-phone">
        <T v="strong">{device.data ? 'Registered to your account' : 'Not registered yet'}</T>
        <T v="small" c="muted">
          {device.data
            ? `Since ${formatDateTime(device.data.boundAt)}. Only your account can sign in on this phone, even after signing out.`
            : 'This phone registers to your account the next time you sign in.'}
        </T>
        <T v="small" c="muted">
          Changing phones? The new one registers when you sign in. To hand this phone to someone else, ask your
          administrator to release it.
        </T>
      </Card>
    </>
  );
}

export function AccountSections() {
  const me = useMe();
  const router = useRouter();
  const { signOut } = useSession();
  const toast = useToast();
  const [changing, setChanging] = useState(false);
  const everywhere = useMutation({
    mutationFn: () => api.post('/auth/logout-all'),
    onSuccess: () => void signOut(),
    onError: (error) => toast({ title: 'Could not sign out everywhere', body: errorMessage(error), tone: 'error' }),
  });
  return (
    <>
      <NotificationSettings />
      <AppearanceSettings />
      <FeedbackSettings />
      {me.role === 'SUBSCRIBER' && <ThisPhone />}
      <SectionTitle>Security</SectionTitle>
      <Card padded={false} style={{ paddingHorizontal: space.lg }}>
        <ListRow
          testID="change-password"
          icon="key-outline"
          title="Change password"
          onPress={() => setChanging(true)}
        />
        <Divider />
        <ListRow
          testID="sign-out-everywhere"
          icon="phone-portrait-outline"
          title="Sign out everywhere"
          subtitle="Ends your session on every device."
          onPress={() =>
            Alert.alert('Sign out everywhere?', 'You will need to sign in again on every device.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out everywhere', style: 'destructive', onPress: () => everywhere.mutate() },
            ])
          }
        />
      </Card>
      <SectionTitle>About</SectionTitle>
      <Card padded={false} style={{ paddingHorizontal: space.lg }}>
        {me.role === 'SUBSCRIBER' && (
          <>
            <ListRow
              testID="replay-tour"
              icon="play-circle-outline"
              title="Take the tour again"
              subtitle="How signals, updates, alerts and filters work."
              onPress={() => router.push('/onboarding?replay=1')}
            />
            <Divider />
          </>
        )}
        <ListRow
          testID="account-disclosures"
          icon="document-text-outline"
          title="Risk disclosure and privacy"
          onPress={() => router.push('/disclosures')}
        />
        {websiteUrl() ? (
          <>
            <Divider />
            <ListRow
              testID="account-about"
              icon="information-circle-outline"
              title="About us and performance"
              subtitle="Opens in your browser"
              onPress={() => void Linking.openURL(`${websiteUrl()}/about`)}
            />
          </>
        ) : null}
        {me.support.contact ? (
          <>
            <Divider />
            <ListRow icon="help-circle-outline" title="Support" subtitle={me.support.contact} />
          </>
        ) : null}
      </Card>
      <Button
        testID="sign-out"
        label="Sign out"
        variant="danger"
        style={{ marginTop: space.lg }}
        onPress={() => void signOut()}
      />
      <T v="caption" c="subtle" center style={{ marginTop: space.sm }}>
        Signals are information, not advice. Version {APP_VERSION}
      </T>
      {changing && <ChangePassword onClose={() => setChanging(false)} />}
    </>
  );
}
