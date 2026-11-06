'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Toaster } from 'sonner';
import { ApiError } from '@/lib/api';

function handleSessionError(error: unknown, client: () => QueryClient) {
  if (!(error instanceof ApiError)) return;
  const path = window.location.pathname;
  const isPrivate = path.startsWith('/app') || path.startsWith('/admin');
  if (error.status === 401 && isPrivate && error.code === 'UNAUTHENTICATED') {
    window.location.assign(`/login?expired=1&next=${encodeURIComponent(path)}`);
    return;
  }
  // The session or subscription changed under us: the gate re-reads who we are and shows the right screen.
  if (error.status === 403 && error.code !== 'FORBIDDEN') void client().invalidateQueries({ queryKey: ['me'] });
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const qc: QueryClient = new QueryClient({
      queryCache: new QueryCache({ onError: (e) => handleSessionError(e, () => qc) }),
      mutationCache: new MutationCache({ onError: (e) => handleSessionError(e, () => qc) }),
      defaultOptions: {
        queries: {
          staleTime: 10_000,
          retry: (count, error) =>
            error instanceof ApiError && !error.isNetwork && error.status < 500 ? false : count < 2,
          refetchOnReconnect: true,
          refetchOnWindowFocus: true,
        },
      },
    });
    return qc;
  });
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster
        position="top-center"
        toastOptions={{
          style: { background: 'var(--raised)', border: '1px solid var(--line-strong)', color: 'var(--text)' },
        }}
      />
    </QueryClientProvider>
  );
}
