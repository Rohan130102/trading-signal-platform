import {
  ACTIONS,
  type DeviceBindingView,
  ENQUIRY_STATUS_LABELS,
  formatDateTime,
  formatLocalDate,
  type SubscriberDetail,
} from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { AccessBadge, CredentialsCard } from '@/admin/parts';
import { EnquiryStatusChips, RenewSheet, StartSheet, TrialSheet } from '@/admin/SubscriptionSheets';
import { api } from '@/lib/api';
import { newKey } from '@/lib/ids';
import { useSession } from '@/lib/session';
import { space } from '@/theme/tokens';
import {
  Button,
  Card,
  Divider,
  ErrorState,
  errorMessage,
  Field,
  FormError,
  ListRow,
  Loading,
  Screen,
  SectionTitle,
  Segmented,
  Sheet,
  Stat,
  T,
  useToast,
} from '@/ui';

type Detail = SubscriberDetail;

const eventLabel = (e: Detail['events'][number]) => {
  if (e.type === 'CREATED' || e.type === 'STARTED') return `Subscription started for ${e.durationDays} days`;
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

export default function SubscriberScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const client = useQueryClient();
  const toast = useToast();
  const detail = useQuery({
    queryKey: ['admin', 'subscriber', id],
    queryFn: () => api.get<Detail>(`/admin/subscribers/${id}`),
  });
  const [dialog, setDialog] = useState<'start' | 'trial' | 'renew' | 'adjust' | 'reset' | 'suspend' | 'contact' | null>(
    null,
  );
  // Opening a new registration takes it off the badge for every administrator.
  const selfRegistered = detail.data?.selfRegistered === true;
  useEffect(() => {
    if (selfRegistered) {
      void api
        .post(`/admin/subscribers/${id}/seen`)
        .then(() => client.invalidateQueries({ queryKey: ['admin', 'inbox'] }));
    }
  }, [client, id, selfRegistered]);
  const refetchAll = useCallback(() => void client.invalidateQueries({ queryKey: ['admin'] }), [client]);
  const act = useMutation({
    mutationFn: (path: string) => api.post(`/admin/subscribers/${id}/${path}`),
    onSuccess: (_r, path) => {
      refetchAll();
      toast({
        title: path === 'reactivate' ? 'Account reactivated. They need to sign in again.' : 'Signed out everywhere.',
        tone: 'success',
      });
    },
    onError: (error) => toast({ title: 'That did not work', body: errorMessage(error), tone: 'error' }),
  });
  const refresh = useCallback(() => detail.refetch(), [detail]);
  const s = detail.data;
  return (
    <Screen edges={['bottom']} refresh={refresh} testID="subscriber-detail">
      <Stack.Screen options={{ title: s?.name ?? 'Subscriber' }} />
      {detail.isPending && <Loading rows={3} label="Loading subscriber" />}
      {detail.isError && !s && <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />}
      {s && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <T v="small" c="muted" num style={{ flex: 1 }} numberOfLines={1}>
              {s.loginId}
            </T>
            <AccessBadge row={s} />
          </View>
          <Card style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
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
          </Card>
          {s.selfRegistered && (
            <Card style={{ gap: space.xs }} testID="registration">
              <T v="strong">{`${s.firstName ?? ''} ${s.lastName ?? ''}`.trim()}</T>
              <T v="small" c="muted">
                {[
                  s.age ? `Age ${s.age}` : null,
                  s.emailVerifiedAt ? 'Email verified' : 'Email not verified',
                  ENQUIRY_STATUS_LABELS[s.enquiryStatus],
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </T>
            </Card>
          )}
          {s.actions.includes('START') && (
            <Button
              testID="subscriber-start"
              label={ACTIONS.startSubscription}
              icon="add-circle-outline"
              variant="primary"
              large
              onPress={() => setDialog('start')}
            />
          )}
          {s.actions.includes('GRANT_TRIAL') && (
            <Button
              testID="subscriber-trial"
              label={ACTIONS.grantFreeTrial}
              icon="gift-outline"
              large
              onPress={() => setDialog('trial')}
            />
          )}
          {s.actions.includes('RENEW') && (
            <Button
              testID="subscriber-renew"
              label={ACTIONS.renewSubscription}
              icon="refresh"
              variant="primary"
              large
              onPress={() => setDialog('renew')}
            />
          )}
          <Card>
            <EnquiryStatusChips detail={s} onSaved={refetchAll} />
          </Card>
          <Card padded={false} style={{ paddingHorizontal: space.lg }}>
            {s.subscription.state !== 'NONE' && (
              <>
                <ListRow
                  testID="subscriber-adjust"
                  icon="calendar-outline"
                  title="Change dates"
                  onPress={() => setDialog('adjust')}
                />
                <Divider />
              </>
            )}
            <ListRow
              testID="subscriber-contact"
              icon="create-outline"
              title="Contact and notes"
              subtitle={[s.phone, s.email].filter(Boolean).join(' · ') || 'None saved'}
              onPress={() => setDialog('contact')}
            />
            <Divider />
            <ListRow
              testID="subscriber-reset"
              icon="key-outline"
              title="Reset password"
              onPress={() => setDialog('reset')}
            />
            <Divider />
            <ListRow
              testID="subscriber-revoke"
              icon="log-out-outline"
              title="Sign out everywhere"
              onPress={() => act.mutate('revoke-sessions')}
            />
            <Divider />
            {s.status === 'ACTIVE' ? (
              <ListRow
                testID="subscriber-suspend"
                danger
                icon="pause-circle-outline"
                title={ACTIONS.suspendAccount}
                onPress={() => setDialog('suspend')}
              />
            ) : (
              <ListRow
                testID="subscriber-reactivate"
                icon="play-circle-outline"
                title="Reactivate account"
                onPress={() => act.mutate('reactivate')}
              />
            )}
          </Card>
          <SectionTitle>Subscription history</SectionTitle>
          <Card style={{ gap: space.md }}>
            {s.events.map((e, i) => (
              <View key={e.id} style={{ gap: 2 }}>
                {i > 0 && <Divider style={{ marginBottom: space.sm }} />}
                <T v="strong">{eventLabel(e)}</T>
                <T v="small" c="muted">
                  Through {formatLocalDate(e.lastValidDate)} · By {e.actorName}
                  {e.note ? ` · ${e.note}` : ''}
                </T>
                <T v="caption" c="subtle" num>
                  {formatDateTime(e.createdAt)}
                </T>
              </View>
            ))}
          </Card>
          <SectionTitle>{`Devices: ${s.sessions.length} signed in, ${s.devices.length} with notifications`}</SectionTitle>
          {s.sessions.length > 0 && (
            <Card padded={false} style={{ paddingHorizontal: space.lg }}>
              {s.sessions.map((session, i) => (
                <View key={session.id}>
                  {i > 0 && <Divider />}
                  <ListRow
                    title={session.deviceLabel ?? 'Unknown device'}
                    subtitle={`Seen ${formatDateTime(session.lastSeenAt)}`}
                  />
                </View>
              ))}
            </Card>
          )}
          <BoundPhones subscriberId={s.id} />
          <Screenshots detail={s} onSaved={refetchAll} />
          {dialog === 'start' && <StartSheet detail={s} onClose={() => setDialog(null)} onDone={refetchAll} />}
          {dialog === 'trial' && <TrialSheet detail={s} onClose={() => setDialog(null)} onDone={refetchAll} />}
          {dialog === 'renew' && <RenewSheet detail={s} onClose={() => setDialog(null)} onDone={refetchAll} />}
          {dialog === 'adjust' && <AdjustSheet detail={s} onClose={() => setDialog(null)} onDone={refetchAll} />}
          {dialog === 'contact' && <ContactSheet detail={s} onClose={() => setDialog(null)} onDone={refetchAll} />}
          {dialog === 'reset' && <ResetSheet detail={s} onClose={() => setDialog(null)} />}
          {dialog === 'suspend' && <SuspendSheet detail={s} onClose={() => setDialog(null)} onDone={refetchAll} />}
        </>
      )}
    </Screen>
  );
}

/**
 * The app installations bound to this subscriber. Releasing one lets another account sign in on that phone
 * and signs this subscriber out of it. Every release is in the audit log with its reason.
 */
/** Screenshot permission for this subscriber. Only the Master Admin sees and changes it; their app applies it at once. */
function Screenshots({ detail, onSaved }: { detail: Detail; onSaved: () => void }) {
  const master = useSession().me?.isMasterAdmin === true;
  const toast = useToast();
  const save = useMutation({
    mutationFn: (value: boolean | null) =>
      api.put(`/admin/subscribers/${detail.id}/screenshots`, { screenshotsAllowed: value }),
    onSuccess: () => {
      onSaved();
      toast({ tone: 'success', title: 'Saved. Their app applies it straight away.' });
    },
    onError: (error) => toast({ tone: 'error', title: 'Not saved', body: errorMessage(error) }),
  });
  const value = detail.screenshotsAllowed === null ? 'DEFAULT' : detail.screenshotsAllowed ? 'ALLOW' : 'BLOCK';
  if (!master) return null;
  return (
    <>
      <SectionTitle>Screenshots</SectionTitle>
      <Card style={{ gap: space.md }} testID="subscriber-screenshots">
        <T v="small" c="muted">
          {detail.screenshotsEffective ? 'Allowed for this subscriber now.' : 'Blocked for this subscriber now.'}
        </T>
        <Segmented<'DEFAULT' | 'BLOCK' | 'ALLOW'>
          label="Screenshot permission"
          value={value}
          onChange={(v) => !save.isPending && save.mutate(v === 'DEFAULT' ? null : v === 'ALLOW')}
          options={[
            { value: 'DEFAULT', label: 'Default', testID: 'screens-default' },
            { value: 'BLOCK', label: 'Block', testID: 'screens-block' },
            { value: 'ALLOW', label: 'Allow', testID: 'screens-allow' },
          ]}
        />
        <T v="caption" c="subtle">
          iPhone cannot fully block screenshots.
        </T>
      </Card>
    </>
  );
}

function BoundPhones({ subscriberId }: { subscriberId: string }) {
  const client = useQueryClient();
  const toast = useToast();
  const [releasing, setReleasing] = useState<DeviceBindingView | null>(null);
  const [reason, setReason] = useState('');
  const devices = useQuery({
    queryKey: ['admin', 'subscriber', subscriberId, 'devices'],
    queryFn: () => api.get<{ devices: DeviceBindingView[] }>(`/admin/subscribers/${subscriberId}/devices`),
    select: (data) => data.devices,
  });
  const release = useMutation({
    mutationFn: ({ device, why }: { device: DeviceBindingView; why: string }) =>
      api.post<{ sessionsRevoked: number }>(`/admin/devices/${device.id}/release`, { reason: why }),
    onSuccess: (result) => {
      toast({
        tone: 'success',
        title: 'Phone released',
        body: result.sessionsRevoked > 0 ? 'They were signed out of it.' : 'Another account can now sign in on it.',
      });
      setReleasing(null);
      setReason('');
      void client.invalidateQueries({ queryKey: ['admin', 'subscriber', subscriberId] });
    },
  });
  const current = devices.data?.filter((d) => !d.releasedAt) ?? [];
  const past = devices.data?.filter((d) => d.releasedAt) ?? [];
  return (
    <>
      <SectionTitle>Registered phones</SectionTitle>
      <Card padded={false} style={{ paddingHorizontal: space.lg }} testID="bound-phones">
        {devices.isPending && <Loading rows={1} label="Loading phones" />}
        {devices.data && current.length === 0 && (
          <ListRow
            title="No phone registered"
            subtitle="The next phone they sign in on registers to them."
            chevron={false}
          />
        )}
        {current.map((d, i) => (
          <View key={d.id}>
            {i > 0 && <Divider />}
            <ListRow
              testID={`bound-${d.id}`}
              icon="phone-portrait-outline"
              title={d.deviceLabel ?? (d.platform === 'ios' ? 'iPhone' : 'Android phone')}
              subtitle={`Registered ${formatDateTime(d.boundAt)} · seen ${formatDateTime(d.lastSeenAt)} · ${d.activeSessions} signed in`}
              right={
                <Button
                  label="Release"
                  small
                  variant="secondary"
                  testID={`release-${d.id}`}
                  onPress={() => setReleasing(d)}
                />
              }
              chevron={false}
            />
          </View>
        ))}
        {past.length > 0 && (
          <>
            <Divider />
            <ListRow
              title={`${past.length} released earlier`}
              subtitle={past
                .slice(0, 3)
                .map(
                  (d) =>
                    `${formatDateTime(d.releasedAt as string)}${d.releasedByName ? ` by ${d.releasedByName}` : ''}: ${d.releaseReason ?? ''}`,
                )
                .join('\n')}
              chevron={false}
            />
          </>
        )}
      </Card>
      <T v="caption" c="subtle">
        One account per phone. A new phone registers when they sign in on it; release an old one when it is handed to
        someone else, lost, or registered by mistake.
      </T>
      {releasing && (
        <Sheet
          title="Release this phone?"
          subtitle={releasing.deviceLabel ?? undefined}
          onClose={() => setReleasing(null)}
          footer={
            <Button
              label="Release phone"
              variant="danger"
              testID="release-confirm"
              loading={release.isPending}
              disabled={reason.trim().length < 3}
              onPress={() => release.mutate({ device: releasing, why: reason.trim() })}
            />
          }
        >
          <T c="muted">
            This subscriber is signed out of that phone, and another account will be able to sign in on it. Their
            subscription is not affected.
          </T>
          <Field
            label="Reason, for the audit log"
            value={reason}
            onChangeText={setReason}
            testID="release-reason"
            maxLength={300}
          />
          <FormError error={release.error} />
        </Sheet>
      )}
    </>
  );
}

interface SheetProps {
  detail: Detail;
  onClose: () => void;
  onDone: () => void;
}

function AdjustSheet({ detail, onClose, onDone }: SheetProps) {
  const toast = useToast();
  const [lastValid, setLastValid] = useState(detail.subscription.lastValidDate ?? '');
  const [note, setNote] = useState('');
  const [key] = useState(newKey);
  const adjust = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscribers/${detail.id}/adjust`, {
        lastValidDate: lastValid.trim(),
        note: note.trim(),
        idempotencyKey: key,
      }),
    onSuccess: () => {
      onDone();
      toast({ title: 'Dates changed', tone: 'success' });
      onClose();
    },
  });
  return (
    <Sheet
      title="Change dates"
      subtitle={`Timezone: ${detail.subscription.timezone}`}
      onClose={onClose}
      footer={
        <Button
          testID="adjust-submit"
          label="Change dates"
          variant="primary"
          large
          disabled={note.trim().length < 3 || !lastValid.trim()}
          loading={adjust.isPending}
          onPress={() => adjust.mutate()}
        />
      }
    >
      <Field
        testID="adjust-date"
        label="Last valid day"
        hint="YYYY-MM-DD. Access ends when that day ends. Setting it in the past ends access now."
        num
        value={lastValid}
        onChangeText={setLastValid}
        keyboardType="numbers-and-punctuation"
      />
      <Field
        testID="adjust-note"
        label="Why are the dates changing?"
        hint="Kept in the record."
        value={note}
        onChangeText={setNote}
      />
      <FormError error={adjust.error} />
    </Sheet>
  );
}

function ContactSheet({ detail, onClose, onDone }: SheetProps) {
  const toast = useToast();
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
      onDone();
      toast({ title: 'Saved', tone: 'success' });
      onClose();
    },
  });
  return (
    <Sheet
      title="Contact and notes"
      onClose={onClose}
      footer={<Button label="Save" variant="primary" large loading={save.isPending} onPress={() => save.mutate()} />}
    >
      <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <Field label="Notes" hint="Only administrators see this." value={notes} onChangeText={setNotes} multiline />
      <FormError error={save.error} />
    </Sheet>
  );
}

function ResetSheet({ detail, onClose }: Omit<SheetProps, 'onDone'>) {
  const reset = useMutation({
    mutationFn: () =>
      api.post<{ loginId: string; temporaryPassword: string }>(`/admin/subscribers/${detail.id}/reset-password`),
  });
  return (
    <Sheet
      title="Reset password"
      onClose={onClose}
      footer={
        !reset.data ? (
          <Button
            testID="reset-submit"
            label="Reset password"
            variant="danger"
            large
            loading={reset.isPending}
            onPress={() => reset.mutate()}
          />
        ) : undefined
      }
    >
      {reset.data ? (
        <CredentialsCard loginId={reset.data.loginId} password={reset.data.temporaryPassword} />
      ) : (
        <T c="muted">{`${detail.name} will be signed out everywhere and given a new temporary password. Their subscription is not affected.`}</T>
      )}
      <FormError error={reset.error} />
    </Sheet>
  );
}

function SuspendSheet({ detail, onClose, onDone }: SheetProps) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const suspend = useMutation({
    mutationFn: () => api.post(`/admin/subscribers/${detail.id}/suspend`, { note: note.trim() || undefined }),
    onSuccess: () => {
      onDone();
      toast({ title: 'Suspended. They were signed out everywhere.', tone: 'success' });
      onClose();
    },
  });
  return (
    <Sheet
      title={`Suspend ${detail.name}?`}
      onClose={onClose}
      footer={
        <Button
          testID="suspend-submit"
          label="Suspend account"
          variant="danger"
          large
          loading={suspend.isPending}
          onPress={() => suspend.mutate()}
        />
      }
    >
      <T c="muted">
        They are signed out at once and receive nothing until reactivated. Their subscription dates do not change.
      </T>
      <Field label="Note" hint="Optional. Only administrators see this." value={note} onChangeText={setNote} />
      <FormError error={suspend.error} />
    </Sheet>
  );
}
