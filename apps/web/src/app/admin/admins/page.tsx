'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type AdminAccount, createAdminSchema } from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Crown, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { MasterOnly } from '@/components/admin/master-only';
import { CredentialsCard } from '@/components/admin/subscriber-parts';
import { Badge, Button, Card, Dialog, ErrorState, Field, FormError, Input, Loading, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime, newKey } from '@/lib/format';
import { useMe } from '@/lib/session';

type CreateInput = z.input<typeof createAdminSchema>;

function CreateDialog({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const [key] = useState(newKey);
  const form = useForm<CreateInput>({
    resolver: zodResolver(createAdminSchema),
    defaultValues: { name: '', loginId: '', email: null, idempotencyKey: key },
  });
  const create = useMutation({
    mutationFn: (v: CreateInput) =>
      api.post<{ admin: AdminAccount; temporaryPassword: string | null }>('/admin/admins', {
        ...v,
        email: v.email || null,
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['admin', 'admins'] }),
  });
  const e = form.formState.errors;
  const result = create.data;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={result ? 'Administrator registered' : 'New administrator'}
      description={
        result
          ? 'They must replace this password and set up two-step verification when they first sign in.'
          : 'Administrators publish signals and manage subscribers. Only you can register or manage them.'
      }
    >
      {result ? (
        <div className="flex flex-col gap-3">
          {result.temporaryPassword ? (
            <CredentialsCard loginId={result.admin.loginId} password={result.temporaryPassword} validFor="24 hours" />
          ) : (
            <p className="text-sm text-muted">This administrator was already registered by this same request.</p>
          )}
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <form onSubmit={(ev) => void form.handleSubmit((v) => create.mutate(v))(ev)} className="flex flex-col gap-4">
          <Field label="Name" error={e.name?.message} required>
            {(c) => <Input {...c} autoFocus {...form.register('name')} />}
          </Field>
          <Field label="Login ID" error={e.loginId?.message} required hint="What they type to sign in.">
            {(c) => <Input {...c} autoCapitalize="none" {...form.register('loginId')} />}
          </Field>
          <Field label="Email" error={e.email?.message}>
            {(c) => <Input {...c} type="email" {...form.register('email')} />}
          </Field>
          <FormError error={create.error} />
          <Button type="submit" variant="primary" size="lg" loading={create.isPending}>
            Register administrator
          </Button>
        </form>
      )}
    </Dialog>
  );
}

type Action = { kind: 'suspend' | 'reactivate' | 'disable' | 'grant' | 'revoke' | 'reset'; admin: AdminAccount } | null;

const COPY: Record<NonNullable<Action>['kind'], { title: string; body: string; button: string }> = {
  suspend: {
    title: 'Suspend this administrator?',
    body: 'They are signed out everywhere at once and cannot sign in until you reactivate them.',
    button: 'Suspend',
  },
  disable: {
    title: 'Disable this administrator?',
    body: 'For someone who has left. They are signed out everywhere. You can reactivate them later.',
    button: 'Disable',
  },
  reactivate: { title: 'Reactivate this administrator?', body: 'They can sign in again.', button: 'Reactivate' },
  grant: {
    title: 'Make them a Master Admin?',
    body: 'They will be able to register and manage administrators, change platform rules and remove trades from subscriber screens.',
    button: 'Make Master Admin',
  },
  revoke: {
    title: 'Remove Master Admin?',
    body: 'They stay an administrator. There must always be at least one Master Admin.',
    button: 'Remove Master Admin',
  },
  reset: {
    title: 'Reset their access?',
    body: 'They get a new temporary password, must set up two-step verification again, and are signed out everywhere.',
    button: 'Reset access',
  },
};

function ActionDialog({ action, onClose }: { action: NonNullable<Action>; onClose: () => void }) {
  const client = useQueryClient();
  const { kind, admin } = action;
  const run = useMutation({
    mutationFn: () => {
      const base = `/admin/admins/${admin.id}`;
      switch (kind) {
        case 'suspend':
          return api.post(`${base}/status`, { status: 'SUSPENDED' });
        case 'disable':
          return api.post(`${base}/status`, { status: 'DISABLED' });
        case 'reactivate':
          return api.post(`${base}/status`, { status: 'ACTIVE' });
        case 'grant':
          return api.post(`${base}/master`, { isMasterAdmin: true });
        case 'revoke':
          return api.post(`${base}/master`, { isMasterAdmin: false });
        case 'reset':
          return api.post<{ admin: AdminAccount; temporaryPassword: string }>(`${base}/reset`, {});
      }
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'admins'] });
      if (kind !== 'reset') {
        toast.success('Done');
        onClose();
      }
    },
  });
  const copy = COPY[kind];
  const reset = kind === 'reset' ? (run.data as { temporaryPassword: string } | undefined) : undefined;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={copy.title}
      description={`${admin.name} (${admin.loginId})`}
    >
      {reset ? (
        <div className="flex flex-col gap-3">
          <CredentialsCard loginId={admin.loginId} password={reset.temporaryPassword} validFor="24 hours" />
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">{copy.body}</p>
          <FormError error={run.error} />
          <div className="flex gap-2">
            <Button
              variant={kind === 'suspend' || kind === 'disable' || kind === 'revoke' ? 'danger' : 'primary'}
              loading={run.isPending}
              onClick={() => run.mutate()}
            >
              {copy.button}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function statusBadge(a: AdminAccount) {
  if (a.status === 'SUSPENDED') return <Badge tone="update">Suspended</Badge>;
  if (a.status === 'DISABLED') return <Badge tone="stop">Disabled</Badge>;
  if (a.mustChangePassword || !a.mfaEnabled) return <Badge>Not signed in yet</Badge>;
  return <Badge tone="success">Active</Badge>;
}

export default function AdminsPage() {
  const me = useMe();
  const [creating, setCreating] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const list = useQuery({
    queryKey: ['admin', 'admins'],
    queryFn: () => api.get<{ admins: AdminAccount[] }>('/admin/admins'),
    enabled: me.data?.isMasterAdmin === true,
  });
  return (
    <MasterOnly>
      <PageHeader
        title="Administrators"
        description="Who can run the desk. Every change here is recorded in the audit log."
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <UserPlus className="size-4" aria-hidden /> New administrator
          </Button>
        }
      />
      {list.isPending && <Loading rows={3} label="Loading administrators" />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && (
        <ul className="flex flex-col gap-3">
          {list.data.admins.map((a) => (
            <li key={a.id}>
              <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{a.name}</span>
                    {a.isMasterAdmin && (
                      <Badge tone="update">
                        <Crown className="size-3" aria-hidden /> Master Admin
                      </Badge>
                    )}
                    {statusBadge(a)}
                    {a.isYou && <Badge>You</Badge>}
                  </div>
                  <p className="mt-0.5 text-[13px] text-muted">
                    {a.loginId}
                    {a.email ? ` · ${a.email}` : ''} ·{' '}
                    {a.lastLoginAt ? `last signed in ${formatDateTime(a.lastLoginAt)}` : 'never signed in'}
                    {a.createdBy ? ` · added by ${a.createdBy}` : ''}
                  </p>
                </div>
                {!a.isYou && (
                  <div className="flex flex-wrap gap-2">
                    {a.status === 'ACTIVE' ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => setAction({ kind: a.isMasterAdmin ? 'revoke' : 'grant', admin: a })}
                        >
                          {a.isMasterAdmin ? 'Remove Master Admin' : 'Make Master Admin'}
                        </Button>
                        <Button size="sm" onClick={() => setAction({ kind: 'reset', admin: a })}>
                          Reset access
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'suspend', admin: a })}>
                          Suspend
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'disable', admin: a })}>
                          Disable
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" onClick={() => setAction({ kind: 'reactivate', admin: a })}>
                        Reactivate
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {creating && <CreateDialog onClose={() => setCreating(false)} />}
      {action && <ActionDialog action={action} onClose={() => setAction(null)} />}
    </MasterOnly>
  );
}
