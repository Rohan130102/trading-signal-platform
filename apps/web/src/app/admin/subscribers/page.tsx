'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createSubscriberSchema } from '@signaldesk/domain';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { AccessBadge, CredentialsCard, type SubscriberRow } from '@/components/admin/subscriber-parts';
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  Input,
  Loading,
  PageHeader,
  Pagination,
  Select,
  Textarea,
} from '@/components/ui';
import { api, queryString } from '@/lib/api';
import { formatDateTime, formatLocalDate, newKey } from '@/lib/format';

type CreateInput = z.input<typeof createSubscriberSchema>;

function CreateDialog({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const router = useRouter();
  const [key] = useState(newKey);
  const form = useForm<CreateInput>({
    resolver: zodResolver(createSubscriberSchema),
    defaultValues: {
      name: '',
      loginId: '',
      email: null,
      phone: null,
      durationDays: 30,
      idempotencyKey: key,
      notes: null,
    },
  });
  const create = useMutation({
    mutationFn: (values: CreateInput) =>
      api.post<{ subscriber: SubscriberRow; temporaryPassword: string | null; replayed: boolean }>(
        '/admin/subscribers',
        {
          ...values,
          email: values.email || null,
          phone: values.phone || null,
          notes: values.notes || null,
          activationDate: values.activationDate || undefined,
        },
      ),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['admin'] }),
  });
  const errors = form.formState.errors;
  const result = create.data;
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={result ? 'Subscriber created' : 'New subscriber'}
      description={
        result
          ? `${result.subscriber.name}, active through ${result.subscriber.subscription.lastValidDate ? formatLocalDate(result.subscriber.subscription.lastValidDate) : ''}.`
          : 'Record payment outside this app first. It collects nothing.'
      }
    >
      {result ? (
        <div className="flex flex-col gap-3">
          {result.temporaryPassword ? (
            <CredentialsCard loginId={result.subscriber.loginId} password={result.temporaryPassword} />
          ) : (
            <p className="text-sm text-muted">
              This account was already created by an earlier attempt. Reset the password from their page to issue a new
              one.
            </p>
          )}
          <Button variant="primary" onClick={() => router.push(`/admin/subscribers/${result.subscriber.id}`)}>
            Open subscriber
          </Button>
        </div>
      ) : (
        <form
          onSubmit={(e) => void form.handleSubmit((values) => create.mutate(values))(e)}
          className="flex flex-col gap-4"
          noValidate
        >
          <Field label="Name" required error={errors.name?.message}>
            {(c) => <Input {...c} autoFocus {...form.register('name')} />}
          </Field>
          <Field
            label="Login ID"
            required
            error={errors.loginId?.message}
            hint="What they will sign in with. Their phone number or email works well."
          >
            {(c) => (
              <Input {...c} autoCapitalize="none" autoCorrect="off" spellCheck={false} {...form.register('loginId')} />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone" error={errors.phone?.message}>
              {(c) => <Input {...c} inputMode="tel" {...form.register('phone')} />}
            </Field>
            <Field label="Email" error={errors.email?.message}>
              {(c) => <Input {...c} type="email" {...form.register('email')} />}
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Duration (days)"
              required
              error={errors.durationDays?.message}
              hint="Counts calendar days, including the first."
            >
              {(c) => (
                <Input
                  {...c}
                  className="num"
                  type="number"
                  min={1}
                  {...form.register('durationDays', { valueAsNumber: true })}
                />
              )}
            </Field>
            <Field label="Starts on" error={errors.activationDate?.message} hint="Leave empty to start now.">
              {(c) => (
                <Input
                  {...c}
                  type="date"
                  {...form.register('activationDate', { setValueAs: (v: string) => v || undefined })}
                />
              )}
            </Field>
          </div>
          <Field label="Notes" hint="Only administrators see this.">
            {(c) => <Textarea {...c} rows={2} {...form.register('notes')} />}
          </Field>
          <FormError error={create.error} />
          <Button type="submit" variant="primary" size="lg" loading={create.isPending}>
            Create subscriber
          </Button>
        </form>
      )}
    </Dialog>
  );
}

function SubscribersList() {
  const params = useSearchParams();
  const [q, setQ] = useState('');
  const [access, setAccess] = useState(params.get('access') ?? '');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const list = useQuery({
    queryKey: ['admin', 'subscribers', q, access, page],
    queryFn: () =>
      api.get<{ subscribers: SubscriberRow[]; total: number; page: number; pageSize: number }>(
        `/admin/subscribers${queryString({ q, access, page })}`,
      ),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader
        title="Subscribers"
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <UserPlus className="size-4" aria-hidden /> New subscriber
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-[1fr_auto] gap-3">
        <Field label="Search">
          {(c) => (
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle"
                aria-hidden
              />
              <Input
                {...c}
                type="search"
                className="pl-9"
                placeholder="Name, login, phone, email"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          )}
        </Field>
        <Field label="Access">
          {(c) => (
            <Select
              {...c}
              value={access}
              onChange={(e) => {
                setAccess(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="ACTIVE">Active</option>
              <option value="EXPIRING">Expiring in 7 days</option>
              <option value="EXPIRED">Expired</option>
              <option value="SCHEDULED">Scheduled</option>
              <option value="SUSPENDED">Suspended or disabled</option>
            </Select>
          )}
        </Field>
      </div>
      {list.isPending && <Loading rows={4} label="Loading subscribers" />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.isSuccess && list.data.subscribers.length === 0 && (
        <EmptyState
          icon={<Users className="size-5" aria-hidden />}
          title={q || access ? 'No one matches' : 'No subscribers yet'}
          action={
            !q && !access ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                Create the first one
              </Button>
            ) : undefined
          }
        >
          {q || access ? 'Try a different search or filter.' : 'After payment is arranged, create their account here.'}
        </EmptyState>
      )}
      {list.isSuccess && list.data.subscribers.length > 0 && (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">Subscribers</caption>
              <thead className="text-xs text-muted">
                <tr>
                  {['Name', 'Access', 'Last valid day', 'Last sign-in', 'Login ID'].map((h) => (
                    <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.data.subscribers.map((s) => (
                  <tr key={s.id} className="border-t border-line hover:bg-neutral-soft">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/admin/subscribers/${s.id}`}
                        className="rounded font-semibold underline-offset-2 hover:underline"
                      >
                        {s.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <AccessBadge row={s} />
                    </td>
                    <td className="px-4 py-2.5 text-[13px]">
                      {s.subscription.lastValidDate ? formatLocalDate(s.subscription.lastValidDate) : 'n/a'}
                    </td>
                    <td className="px-4 py-2.5 text-[13px] text-muted">
                      {s.lastLoginAt ? formatDateTime(s.lastLoginAt) : 'Never'}
                    </td>
                    <td className="num px-4 py-2.5 text-[13px] text-muted">{s.loginId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={setPage} />
        </>
      )}
      {creating && <CreateDialog onClose={() => setCreating(false)} />}
    </>
  );
}

export default function SubscribersPage() {
  return (
    <Suspense>
      <SubscribersList />
    </Suspense>
  );
}
