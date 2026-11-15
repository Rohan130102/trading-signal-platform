'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { useMe } from '@/lib/session';

/**
 * A page only the Master Admin uses. Anyone else is taken to the dashboard, as if the page did not exist: no lock,
 * no explanation. The API refuses these actions on its own as well.
 */
export function MasterOnly({ children }: { children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const allowed = me.data?.isMasterAdmin === true;
  useEffect(() => {
    if (me.data && !allowed) router.replace('/admin');
  }, [allowed, me.data, router]);
  return allowed ? <>{children}</> : null;
}
