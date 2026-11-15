import { ACTIONS, formatDateTime, type PasswordResetRow } from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { CredentialsCard } from '@/admin/parts';
import { api } from '@/lib/api';
import { space } from '@/theme/tokens';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormError,
  Loading,
  Screen,
  Segmented,
  Sheet,
  T,
  useToast,
} from '@/ui';

const STATUS: Record<PasswordResetRow['status'], { label: string; tone: 'update' | 'buy' | 'success' | 'neutral' }> = {
  OPEN: { label: 'Waiting', tone: 'update' },
  PASSWORD_ISSUED: { label: 'Password issued', tone: 'buy' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  DISMISSED: { label: 'Dismissed', tone: 'neutral' },
};

/** Requests from people who proved their email address. The temporary password is shown once, here. */
export default function PasswordResets() {
  const client = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState<'OPEN' | 'ALL'>('OPEN');
  const [issued, setIssued] = useState<{ loginId: string; temporaryPassword: string } | null>(null);
  const list = useQuery({
    queryKey: ['admin', 'password-resets', view],
    queryFn: () => api.get<{ requests: PasswordResetRow[]; open: number }>(`/admin/password-resets?status=${view}`),
    refetchInterval: 30_000,
  });
  const refreshAll = () => void client.invalidateQueries({ queryKey: ['admin'] });
  const issue = useMutation({
    mutationFn: (id: string) =>
      api.post<{ loginId: string; temporaryPassword: string }>(`/admin/password-resets/${id}/issue`),
    onSuccess: (result) => {
      setIssued(result);
      refreshAll();
    },
  });
  const close = useMutation({
    mutationFn: ({ id, how }: { id: string; how: 'complete' | 'dismiss' }) =>
      api.post(`/admin/password-resets/${id}/${how}`),
    onSuccess: () => {
      refreshAll();
      toast({ tone: 'success', title: 'Request closed' });
    },
  });
  const refresh = useCallback(() => list.refetch(), [list]);
  return (
    <Screen edges={['bottom']} refresh={refresh} testID="password-resets">
      <Segmented<'OPEN' | 'ALL'>
        label="Show"
        value={view}
        onChange={setView}
        options={[
          { value: 'OPEN', label: 'Open' },
          { value: 'ALL', label: 'All' },
        ]}
      />
      {list.isPending && <Loading rows={2} label="Loading requests" />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && list.data.requests.length === 0 && <EmptyState icon="key-outline" title="No requests" />}
      {list.data?.requests.map((r) => {
        const open = r.status === 'OPEN' || r.status === 'PASSWORD_ISSUED';
        return (
          <Card key={r.id} style={{ gap: space.sm }} testID={`reset-${r.id}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <T v="strong" style={{ flex: 1 }}>
                {r.name}
              </T>
              <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
            </View>
            <T v="small" c="muted">{`${r.email} · email verified · ${formatDateTime(r.requestedAt)}`}</T>
            {open && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                <Button
                  small
                  variant="primary"
                  label={ACTIONS.generateTemporaryPassword}
                  loading={issue.isPending && issue.variables === r.id}
                  onPress={() => issue.mutate(r.id)}
                />
                <Button
                  small
                  label={ACTIONS.markCompleted}
                  onPress={() => close.mutate({ id: r.id, how: 'complete' })}
                />
                <Button
                  small
                  variant="ghost"
                  label="Dismiss"
                  onPress={() => close.mutate({ id: r.id, how: 'dismiss' })}
                />
              </View>
            )}
          </Card>
        );
      })}
      <FormError error={issue.error ?? close.error} />
      {issued && (
        <Sheet
          title="Temporary password"
          subtitle="They must replace it when they log in."
          onClose={() => setIssued(null)}
        >
          <CredentialsCard loginId={issued.loginId} password={issued.temporaryPassword} validFor="24 hours" />
        </Sheet>
      )}
    </Screen>
  );
}
