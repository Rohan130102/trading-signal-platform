'use client';

import type { MeResponse } from '@signaldesk/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';

export function useMe() {
  return useQuery<MeResponse, ApiError>({
    queryKey: ['me'],
    queryFn: () => api.get<MeResponse>('/auth/me'),
    retry: (count, error) => error.isNetwork && count < 2,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function nextStepPath(me: Pick<MeResponse, 'next' | 'role'>, requested?: string | null): string {
  switch (me.next) {
    case 'CHANGE_PASSWORD':
      return '/setup/password';
    case 'MFA_SETUP':
      return '/setup/mfa';
    case 'MFA_VERIFY':
      return '/verify';
    default: {
      const home = me.role === 'ADMIN' ? '/admin' : '/app';
      // Same-site paths only, so a crafted link cannot send someone elsewhere after signing in.
      const safe = requested && requested.startsWith('/') && !requested.startsWith('//') ? requested : null;
      if (safe && (me.role === 'ADMIN' || !safe.startsWith('/admin'))) return safe;
      return home;
    }
  }
}

/** Removes this device from notifications, ends the session, and leaves nothing in memory. */
export async function signOut(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    if (subscription) {
      await api.delete('/push/subscriptions', { endpoint: subscription.endpoint }).catch(() => undefined);
      await subscription.unsubscribe().catch(() => undefined);
    }
  } catch {
    // Signing out must still work if notifications are unavailable.
  }
  await api.post('/auth/logout').catch(() => undefined);
  window.location.assign('/login');
}

export function useRefreshMe() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ['me'] });
}
