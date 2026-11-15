'use client';

import type { MeResponse } from '@signaldesk/domain';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { ErrorState, Loading } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { nextStepPath, useMe } from '@/lib/session';

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
