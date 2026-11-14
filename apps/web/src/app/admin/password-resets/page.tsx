'use client';

import { ACTIONS, type PasswordResetRow, TITLES } from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { CredentialsCard } from '@/components/admin/subscriber-parts';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  FormError,
  Loading,
  PageHeader,
  Segmented,
} from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

const STATUS: Record<PasswordResetRow['status'], { label: string; tone: 'update' | 'buy' | 'success' | 'neutral' }> = {
  OPEN: { label: 'Waiting', tone: 'update' },
  PASSWORD_ISSUED: { label: 'Password issued', tone: 'buy' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  DISMISSED: { label: 'Dismissed', tone: 'neutral' },
};

/** Requests from people who proved their email address. The temporary password is shown once, here. */
export default function PasswordResetsPage() {
  const client = useQueryClient();
  const [view, setView] = useState<'OPEN' | 'ALL'>('OPEN');
  const [issued, setIssued] = useState<{ loginId: string; temporaryPassword: string } | null>(null);
  const list = useQuery({
    queryKey: ['admin', 'password-resets', view],
    queryFn: () => api.get<{ requests: PasswordResetRow[]; open: number }>(`/admin/password-resets?status=${view}`),
    refetchInterval: 30_000,
  });
  const refresh = () => void client.invalidateQueries({ queryKey: ['admin'] });
  const issue = useMutation({
    mutationFn: (id: string) =>
      api.post<{ loginId: string; temporaryPassword: string }>(`/admin/password-resets/${id}/issue`),
    onSuccess: (result) => {
      setIssued(result);
      refresh();
    },
  });
  const close = useMutation({
    mutationFn: ({ id, how }: { id: string; how: 'complete' | 'dismiss' }) =>
      api.post(`/admin/password-resets/${id}/${how}`),
    onSuccess: () => {
      refresh();
      toast.success('Request closed');
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <>
      <PageHeader
        title={TITLES.passwordResetRequests}
        description={list.data ? `${list.data.open} waiting` : undefined}
        action={
          <Segmented<'OPEN' | 'ALL'>
            label="Show"
            value={view}
            onChange={setView}
            options={[
              { value: 'OPEN', label: 'Open' },
              { value: 'ALL', label: 'All' },
            ]}
          />
        }
      />
      {list.isPending ? (
        <Loading rows={3} label="Loading requests" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.requests.length === 0 ? (
        <Card>
          <EmptyState icon={<KeyRound className="size-5" aria-hidden />} title="No requests" />
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.data.requests.map((r) => {
            const open = r.status === 'OPEN' || r.status === 'PASSWORD_ISSUED';
            return (
              <li key={r.id}>
                <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/subscribers/${r.userId}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                    <p className="text-[13px] text-muted">
                      {r.email} · email verified · requested {formatDateTime(r.requestedAt)}
                    </p>
                  </div>
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                  {open && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        loading={issue.isPending && issue.variables === r.id}
                        onClick={() => issue.mutate(r.id)}
                      >
                        {ACTIONS.generateTemporaryPassword}
                      </Button>
                      <Button size="sm" onClick={() => close.mutate({ id: r.id, how: 'complete' })}>
                        {ACTIONS.markCompleted}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => close.mutate({ id: r.id, how: 'dismiss' })}>
                        Dismiss
                      </Button>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <FormError error={issue.error} />
      {issued && (
        <Dialog
          open
          onOpenChange={(o) => !o && setIssued(null)}
          title="Temporary password"
          description="They must replace it when they log in. Their old password and every session have stopped working."
        >
          <CredentialsCard loginId={issued.loginId} password={issued.temporaryPassword} validFor="24 hours" />
        </Dialog>
      )}
    </>
  );
}
