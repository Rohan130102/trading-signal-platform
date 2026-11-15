import { Redirect } from 'expo-router';
import type { AdminAccount } from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { CredentialsCard } from '@/admin/parts';
import { api } from '@/lib/api';
import { newKey } from '@/lib/ids';
import { useSession } from '@/lib/session';
import { space } from '@/theme/tokens';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  errorMessage,
  Field,
  FormError,
  Loading,
  Screen,
  Sheet,
  T,
  useToast,
} from '@/ui';

function NewAdminSheet({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const [key] = useState(newKey);
  const [name, setName] = useState('');
  const [loginId, setLoginId] = useState('');
  const [email, setEmail] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api.post<{ admin: AdminAccount; temporaryPassword: string | null }>('/admin/admins', {
        name: name.trim(),
        loginId: loginId.trim(),
        email: email.trim() || null,
        idempotencyKey: key,
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['admin', 'admins'] }),
  });
  const result = create.data;
  return (
    <Sheet
      testID="new-admin"
      title={result ? 'Administrator registered' : 'New administrator'}
      subtitle={
        result
          ? 'They replace this password and set up two-step verification when they first sign in.'
          : 'Only you can register or manage administrators.'
      }
      onClose={onClose}
      footer={
        result ? (
          <Button label="Done" variant="primary" large onPress={onClose} />
        ) : (
          <View style={{ gap: space.sm }}>
            <FormError error={create.error} />
            <Button
              testID="new-admin-save"
              label="Register administrator"
              variant="primary"
              large
              disabled={!name.trim() || loginId.trim().length < 3}
              loading={create.isPending}
              onPress={() => create.mutate()}
            />
          </View>
        )
      }
    >
      {result ? (
        result.temporaryPassword ? (
          <CredentialsCard loginId={result.admin.loginId} password={result.temporaryPassword} validFor="24 hours" />
        ) : (
          <T c="muted">This administrator was already registered by this same request.</T>
        )
      ) : (
        <>
          <Field testID="new-admin-name" label="Name" value={name} onChangeText={setName} autoFocus />
          <Field
            testID="new-admin-login"
            label="Login ID"
            hint="What they type to sign in."
            value={loginId}
            onChangeText={setLoginId}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Field
            testID="new-admin-email"
            label="Email (optional)"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </>
      )}
    </Sheet>
  );
}

function ResetSheet({ admin, password, onClose }: { admin: AdminAccount; password: string; onClose: () => void }) {
  return (
    <Sheet
      title="New temporary password"
      subtitle={`${admin.name} must set up two-step verification again.`}
      onClose={onClose}
      footer={<Button label="Done" variant="primary" large onPress={onClose} />}
    >
      <CredentialsCard loginId={admin.loginId} password={password} validFor="24 hours" />
    </Sheet>
  );
}

/** The Master Admin's list of administrators. Every change is recorded in the audit log. */
export default function Admins() {
  const { me } = useSession();
  const client = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [reset, setReset] = useState<{ admin: AdminAccount; password: string } | null>(null);
  const master = me?.isMasterAdmin === true;
  const list = useQuery({
    queryKey: ['admin', 'admins'],
    queryFn: () => api.get<{ admins: AdminAccount[] }>('/admin/admins'),
    enabled: master,
  });
  const refresh = useCallback(() => list.refetch(), [list]);
  const act = useMutation({
    mutationFn: async ({ admin, kind }: { admin: AdminAccount; kind: string }) => {
      const base = `/admin/admins/${admin.id}`;
      if (kind === 'reset') {
        const r = await api.post<{ temporaryPassword: string }>(`${base}/reset`, {});
        setReset({ admin, password: r.temporaryPassword });
        return;
      }
      if (kind === 'grant' || kind === 'revoke') {
        await api.post(`${base}/master`, { isMasterAdmin: kind === 'grant' });
        return;
      }
      await api.post(`${base}/status`, { status: kind });
    },
    onSuccess: (_r, { kind }) => {
      void client.invalidateQueries({ queryKey: ['admin', 'admins'] });
      if (kind !== 'reset') toast({ tone: 'success', title: 'Done' });
    },
    onError: (error) => toast({ tone: 'error', title: 'That did not work', body: errorMessage(error) }),
  });
  const confirm = (admin: AdminAccount, kind: string, title: string, body: string, button: string) =>
    Alert.alert(title, body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: button,
        style: kind === 'SUSPENDED' || kind === 'revoke' ? 'destructive' : 'default',
        onPress: () => act.mutate({ admin, kind }),
      },
    ]);

  // Only the Master Admin has this screen. Anyone else is sent back, as if it did not exist.
  if (!master) return <Redirect href="/" />;
  return (
    <Screen edges={['bottom']} refresh={refresh} testID="admins">
      <Button
        testID="admins-new"
        label="New administrator"
        icon="person-add-outline"
        variant="primary"
        onPress={() => setCreating(true)}
      />
      {list.isPending && <Loading rows={3} label="Loading administrators" />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data?.admins.map((a) => (
        <Card key={a.id} style={{ gap: space.sm }} testID={`admin-${a.loginId}`}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' }}>
            <T v="strong">{a.name}</T>
            {a.isMasterAdmin && (
              <Badge tone="update" icon="star">
                Master Admin
              </Badge>
            )}
            {a.status !== 'ACTIVE' ? (
              <Badge tone="stop">{a.status === 'SUSPENDED' ? 'Suspended' : 'Disabled'}</Badge>
            ) : a.mustChangePassword || !a.mfaEnabled ? (
              <Badge>Not signed in yet</Badge>
            ) : null}
            {a.isYou && <Badge>You</Badge>}
          </View>
          <T v="small" c="muted">
            {[a.loginId, a.email, a.createdBy ? `added by ${a.createdBy}` : null].filter(Boolean).join(' · ')}
          </T>
          {!a.isYou && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {a.status === 'ACTIVE' ? (
                <>
                  <Button
                    small
                    label={a.isMasterAdmin ? 'Remove Master Admin' : 'Make Master Admin'}
                    onPress={() =>
                      a.isMasterAdmin
                        ? confirm(a, 'revoke', 'Remove Master Admin?', 'They stay an administrator.', 'Remove')
                        : confirm(
                            a,
                            'grant',
                            'Make them a Master Admin?',
                            'They will manage administrators, platform rules and trade removals.',
                            'Make Master Admin',
                          )
                    }
                  />
                  <Button
                    small
                    label="Reset access"
                    onPress={() =>
                      confirm(
                        a,
                        'reset',
                        'Reset their access?',
                        'New temporary password, two-step verification again, signed out everywhere.',
                        'Reset',
                      )
                    }
                  />
                  <Button
                    small
                    variant="danger"
                    label="Suspend"
                    onPress={() =>
                      confirm(
                        a,
                        'SUSPENDED',
                        'Suspend this administrator?',
                        'They are signed out everywhere at once.',
                        'Suspend',
                      )
                    }
                  />
                </>
              ) : (
                <Button small label="Reactivate" onPress={() => act.mutate({ admin: a, kind: 'ACTIVE' })} />
              )}
            </View>
          )}
        </Card>
      ))}
      {creating && <NewAdminSheet onClose={() => setCreating(false)} />}
      {reset && <ResetSheet admin={reset.admin} password={reset.password} onClose={() => setReset(null)} />}
    </Screen>
  );
}
