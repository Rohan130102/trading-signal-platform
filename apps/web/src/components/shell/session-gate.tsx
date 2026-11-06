'use client';

import type { MeResponse } from '@signaldesk/domain';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { Button, ErrorState, Loading, Logo } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { formatLocalDate } from '@/lib/format';
import { nextStepPath, signOut, useMe } from '@/lib/session';

/** Decides what to show from the server's answer. It hides nothing that the API does not also refuse. */
export function SessionGate({ role, children }: { role: 'ADMIN' | 'ANY'; children: (me: MeResponse) => ReactNode }) {
  const router = useRouter();
  const me = useMe();
  const data = me.data;
  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;

  useEffect(() => {
    if (unauthenticated) {
      router.replace(`/login?expired=1&next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (!data) return;
    if (data.next) router.replace(nextStepPath(data));
    else if (role === 'ADMIN' && data.role !== 'ADMIN') router.replace('/app');
  }, [data, role, router, unauthenticated]);

  if (me.isError && !unauthenticated) {
    return (
      <main className="mx-auto max-w-md p-6">
        <ErrorState error={me.error} title="Cannot reach the server" onRetry={() => void me.refetch()} />
      </main>
    );
  }
  if (!data || data.next || (role === 'ADMIN' && data.role !== 'ADMIN')) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <Loading rows={3} label="Loading your account" />
      </main>
    );
  }
  return <>{children(data)}</>;
}

const DENIAL_COPY: Record<string, { title: string; body: (me: MeResponse) => string }> = {
  SUBSCRIPTION_EXPIRED: {
    title: 'Your subscription has ended',
    body: (me) =>
      `Your access ran through ${me.subscription.lastValidDate ? formatLocalDate(me.subscription.lastValidDate) : 'its last day'}. Signals and history are hidden until it is renewed.`,
  },
  SUBSCRIPTION_SCHEDULED: {
    title: 'Your subscription has not started yet',
    body: (me) =>
      `It starts on ${me.subscription.startsAt ? new Date(me.subscription.startsAt).toLocaleDateString(undefined, { dateStyle: 'long' }) : 'its start date'}. Signals will appear here from then.`,
  },
  SUBSCRIPTION_NONE: {
    title: 'No subscription yet',
    body: () => 'Your account is ready, but no subscription is attached to it.',
  },
  ACCOUNT_DISABLED: {
    title: 'This account is not active',
    body: () => 'Access to this account has been paused.',
  },
};

export function AccessEnded({ me }: { me: MeResponse }) {
  const copy =
    DENIAL_COPY[me.access.reason ?? 'SUBSCRIPTION_NONE'] ??
    (DENIAL_COPY.SUBSCRIPTION_NONE as (typeof DENIAL_COPY)[string]);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md" role="status">
        <Logo className="mb-6 size-8" />
        <h1 className="text-[22px] font-semibold tracking-tight">{copy.title}</h1>
        <p className="mt-2 text-muted">{copy.body(me)}</p>
        {me.support.renewalInstructions && (
          <p className="mt-3 whitespace-pre-line text-muted">{me.support.renewalInstructions}</p>
        )}
        {me.support.contact && (
          <p className="mt-3">
            <span className="text-muted">Contact: </span>
            <span className="font-medium select-all">{me.support.contact}</span>
          </p>
        )}
        <Button className="mt-5" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </main>
  );
}
