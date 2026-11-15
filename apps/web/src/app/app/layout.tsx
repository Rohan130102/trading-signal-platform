'use client';

import { clsx } from 'clsx';
import { Activity, Bell, History as HistoryIcon, Megaphone, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { ConnectionBanner, LivePill } from '@/components/shell/connection-banner';
import { SessionGate } from '@/components/shell/session-gate';
import { Notices, SubscriptionStatus } from '@/components/subscriber/status';
import { TrialGreeting } from '@/components/subscriber/trial-greeting';
import { Logo } from '@/components/ui';
import { registerServiceWorker } from '@/lib/push';
import { RealtimeProvider, useRealtime, useStartRealtimeFromHead } from '@/lib/realtime';

/** The same five places as the phone app, in the same order. */
const NAV = [
  { href: '/app', label: 'Signals', icon: Activity, badge: false },
  { href: '/app/alerts', label: 'Alerts', icon: Bell, badge: true },
  { href: '/app/news', label: 'News', icon: Megaphone, badge: false },
  { href: '/app/history', label: 'History', icon: HistoryIcon, badge: false },
  { href: '/app/account', label: 'Account', icon: UserRound, badge: false },
];

function Shell({ children, serviceName }: { children: ReactNode; serviceName: string }) {
  const pathname = usePathname();
  const { unread } = useRealtime();
  // Alerts reads the stream from where it left off; every other page starts live from now.
  useStartRealtimeFromHead(pathname !== '/app/alerts');
  const isActive = (item: (typeof NAV)[number]) =>
    item.href === '/app' ? pathname === '/app' || pathname.startsWith('/app/trades') : pathname.startsWith(item.href);
  const unreadBadge = unread > 0 && pathname !== '/app/alerts';

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-text"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-4">
          <Link href="/app" className="flex items-center gap-2 rounded font-semibold">
            <Logo className="size-6" />
            <span className="max-sm:sr-only">{serviceName}</span>
          </Link>
          <nav aria-label="Main" className="ml-3 hidden gap-1 sm:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item) ? 'page' : undefined}
                className={clsx(
                  'relative rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  isActive(item) ? 'bg-raised text-text' : 'text-muted hover:text-text',
                )}
              >
                {item.label}
                {item.badge && unreadBadge && (
                  <span className="num ml-1.5 rounded bg-primary px-1 text-[11px] font-semibold text-primary-text">
                    {unread}
                    <span className="sr-only"> unread</span>
                  </span>
                )}
              </Link>
            ))}
          </nav>
          <span className="ml-auto">
            <LivePill />
          </span>
        </div>
        <ConnectionBanner />
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-5 sm:pb-10">
        <Notices />
        {children}
      </main>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
      >
        <ul className="grid grid-cols-5">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(item) ? 'page' : undefined}
                  className={clsx(
                    'relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
                    isActive(item) ? 'text-text' : 'text-muted',
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                  {item.label}
                  {item.badge && unreadBadge && (
                    <span className="num absolute left-1/2 top-1.5 ml-1.5 rounded bg-primary px-1 text-[10px] font-semibold text-primary-text">
                      {unread}
                      <span className="sr-only"> unread</span>
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

export default function SubscriberLayout({ children }: { children: ReactNode }) {
  useEffect(registerServiceWorker, []);
  return (
    <SessionGate role="ANY">
      {(me) =>
        me.access.allowed ? (
          <RealtimeProvider>
            <Shell serviceName={me.support.serviceName}>{children}</Shell>
            <TrialGreeting me={me} />
          </RealtimeProvider>
        ) : (
          <SubscriptionStatus me={me} />
        )
      }
    </SessionGate>
  );
}
