'use client';

import type { PublicInfo } from '@signaldesk/domain';
import { useQuery } from '@tanstack/react-query';
import { BellRing, Layers, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SignalPreview } from '@/components/marketing/signal-preview';
import { Logo } from '@/components/ui';
import { api } from '@/lib/api';

const TAGLINE = 'Every signal, and every change to it, in one place.';

const POINTS = [
  { icon: Layers, short: 'Clear levels', text: 'Clear entries, targets and stop-losses' },
  { icon: BellRing, short: 'Live alerts', text: 'Live updates, with alerts on your phone' },
  { icon: ShieldCheck, short: 'Signals only', text: 'Signals only: we never place trades for you' },
];

/** A soft light behind the brand, in the buy and success colours, so it suits both themes. */
const GLOW =
  'radial-gradient(70% 55% at 12% 0%, var(--buy-soft), transparent 72%), radial-gradient(60% 50% at 100% 8%, var(--success-soft), transparent 72%)';

/** The public facts these screens show. Cached with the rest of the app, so it is fetched once. */
export function usePublicInfo() {
  return useQuery({
    queryKey: ['public-info'],
    queryFn: () => api.get<PublicInfo>('/public/info'),
    staleTime: 60_000,
  });
}

function FooterLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="About this service" className={className}>
      <Link href="/about" className="rounded hover:text-text">
        About us
      </Link>
      <Link href="/disclosures" className="rounded hover:text-text">
        Risk disclosure and privacy
      </Link>
    </nav>
  );
}

/**
 * Log in, sign up and recovery. The form sits on a card under the brand, with a soft light behind it. On a wide
 * screen a brand panel with what the service does sits beside it. Security steps (`focused`) show the form alone.
 */
export function AuthFrame({
  title,
  description,
  eyebrow,
  children,
  focused = false,
}: {
  title: string;
  description?: ReactNode;
  /** Above the title, such as how far through sign-up the person is. */
  eyebrow?: ReactNode;
  children: ReactNode;
  /** Security steps (a new password, two-step verification): the form alone, with nothing else to read. */
  focused?: boolean;
}) {
  const info = usePublicInfo();
  const name = info.data?.serviceName ?? 'SignalDesk';

  const card = (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-float sm:p-7">
      {eyebrow}
      <h1 className="text-[22px] font-semibold leading-tight tracking-tight sm:text-2xl">{title}</h1>
      {description && <div className="mt-1.5 text-sm leading-relaxed text-muted">{description}</div>}
      <div className="mt-6">{children}</div>
    </section>
  );

  if (focused) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-[26rem]">
          <Link
            href="/"
            aria-label="Start page"
            className="mb-6 inline-flex items-center gap-2.5 rounded font-semibold"
          >
            <Logo className="size-8" />
            {name}
          </Link>
          {card}
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
          <p className="text-3xl font-semibold leading-tight tracking-tight">{TAGLINE}</p>
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
        <FooterLinks className="relative flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-subtle" />
      </aside>

      <main className="relative flex min-h-dvh flex-col overflow-hidden px-4 pb-6 pt-10 sm:px-8 lg:pt-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] lg:hidden"
          style={{ background: GLOW }}
        />
        <div className="relative mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center">
          {/* The brand, on a phone or tablet. On a wide screen the panel beside the form carries it. */}
          <div className="mb-7 flex flex-col items-center text-center lg:hidden">
            <Link href="/" className="flex flex-col items-center gap-3 rounded-xl">
              <Logo className="size-14 drop-shadow-[0_10px_24px_rgb(0_0_0/0.35)]" />
              <span className="text-xl font-semibold tracking-tight">{name}</span>
            </Link>
            <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted">{TAGLINE}</p>
            <ul className="mt-4 flex flex-wrap justify-center gap-1.5" aria-label="What you get">
              {POINTS.map(({ icon: Icon, short }) => (
                <li
                  key={short}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface/70 px-2.5 py-1 text-xs font-medium text-muted backdrop-blur"
                >
                  <Icon className="size-3.5 text-text" aria-hidden />
                  {short}
                </li>
              ))}
            </ul>
          </div>
          {card}
        </div>
        <FooterLinks className="relative mt-8 flex flex-wrap justify-center gap-x-5 gap-y-1 text-[13px] text-subtle lg:hidden" />
      </main>
    </div>
  );
}
