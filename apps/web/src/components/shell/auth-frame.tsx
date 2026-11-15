'use client';

import type { PublicInfo } from '@signaldesk/domain';
import { useQuery } from '@tanstack/react-query';
import { BellRing, Layers, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SignalPreview } from '@/components/marketing/signal-preview';
import { Logo } from '@/components/ui';
import { api } from '@/lib/api';

const POINTS = [
  { icon: Layers, text: 'Clear entries, targets and stop-losses' },
  { icon: BellRing, text: 'Live updates, with alerts on your phone' },
  { icon: ShieldCheck, text: 'Signals only: we never place trades for you' },
];

/** The public facts these screens show. Cached with the rest of the app, so it is fetched once. */
export function usePublicInfo() {
  return useQuery({
    queryKey: ['public-info'],
    queryFn: () => api.get<PublicInfo>('/public/info'),
    staleTime: 60_000,
  });
}

/**
 * Log in, sign up and recovery. On a wide screen a calm brand panel sits beside the form; on a phone the form has
 * the whole screen and nothing else to scroll past.
 */
export function AuthFrame({
  title,
  description,
  children,
  focused = false,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Security steps (a new password, two-step verification): the form alone, with nothing else to read. */
  focused?: boolean;
}) {
  const info = usePublicInfo();
  const name = info.data?.serviceName ?? 'SignalDesk';
  if (focused) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm">
          <Link
            href="/"
            aria-label="Start page"
            className="mb-6 inline-flex items-center gap-2.5 rounded font-semibold"
          >
            <Logo className="size-8" />
            {name}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <div className="mt-1.5 text-sm text-muted">{description}</div>}
          <div className="mt-6">{children}</div>
        </div>
      </main>
    );
  }
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden border-r border-line bg-surface lg:flex lg:flex-col lg:justify-between lg:p-10 xl:p-14">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(60% 45% at 10% 0%, var(--buy-soft), transparent 70%), radial-gradient(55% 45% at 100% 100%, var(--success-soft), transparent 70%)',
          }}
        />
        <Link href="/" className="relative flex w-fit items-center gap-2.5 rounded text-lg font-semibold">
          <Logo className="size-8" />
          {name}
        </Link>
        <div className="relative mx-auto w-full max-w-md">
          <p className="text-3xl font-semibold leading-tight tracking-tight">
            Every signal, and every change to it, in one place.
          </p>
          <ul className="mt-6 flex flex-col gap-3">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-[15px] text-muted">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-bg">
                  <Icon className="size-4 text-text" aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
          <SignalPreview className="mt-12" />
        </div>
        <nav
          aria-label="About this service"
          className="relative flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-subtle"
        >
          <Link href="/about" className="hover:text-text">
            About us
          </Link>
          <Link href="/disclosures" className="hover:text-text">
            Risk disclosure and privacy
          </Link>
        </nav>
      </aside>

      <main className="flex min-h-dvh flex-col px-4 py-6 sm:px-8">
        <Link href="/" className="flex w-fit items-center gap-2.5 rounded font-semibold lg:hidden">
          <Logo className="size-7" />
          {name}
        </Link>
        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-sm">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description && <div className="mt-1.5 text-sm text-muted">{description}</div>}
            <div className="mt-6">{children}</div>
          </div>
        </div>
        <nav
          aria-label="About this service"
          className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-[13px] text-subtle lg:hidden"
        >
          <Link href="/about" className="hover:text-text">
            About us
          </Link>
          <Link href="/disclosures" className="hover:text-text">
            Risk disclosure and privacy
          </Link>
        </nav>
      </main>
    </div>
  );
}
