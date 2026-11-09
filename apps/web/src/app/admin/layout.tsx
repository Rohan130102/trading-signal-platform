'use client';

import { clsx } from 'clsx';
import {
  Activity,
  BarChart3,
  Bell,
  CandlestickChart,
  FileText,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Plus,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { ConnectionBanner, LivePill } from '@/components/shell/connection-banner';
import { SessionGate } from '@/components/shell/session-gate';
import { buttonClass, Dialog, Logo } from '@/components/ui';
import { registerServiceWorker } from '@/lib/push';
import { RealtimeProvider, useStartRealtimeFromHead } from '@/lib/realtime';
import { signOut } from '@/lib/session';

const PRIMARY = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/admin/trades', label: 'Trades', icon: Activity },
  { href: '/admin/announcements', label: 'Announcements', icon: Megaphone },
  { href: '/admin/subscribers', label: 'Subscribers', icon: Users },
  { href: '/admin/performance', label: 'Performance', icon: BarChart3 },
];
const SECONDARY = [
  { href: '/admin/notifications', label: 'Delivery health', icon: Bell },
  { href: '/admin/instruments', label: 'Instruments', icon: CandlestickChart },
  { href: '/admin/templates', label: 'Templates', icon: FileText },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];
/** The Master Admin's own pages. The API enforces this; the link is only hidden for everyone else. */
const MASTER = [{ href: '/admin/admins', label: 'Administrators', icon: ShieldCheck }];

function Shell({ children, name, master }: { children: ReactNode; name: string; master: boolean }) {
  const secondary = master ? [...SECONDARY, ...MASTER] : SECONDARY;
  const pathname = usePathname();
  const [more, setMore] = useState(false);
  useStartRealtimeFromHead(true);
  useEffect(() => setMore(false), [pathname]);
  const active = (item: { href: string; exact?: boolean }) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);
  const link = (item: (typeof PRIMARY)[number] & { exact?: boolean }) => {
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active(item) ? 'page' : undefined}
        className={clsx(
          'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors max-lg:min-h-11',
          active(item) ? 'bg-raised text-text' : 'text-muted hover:text-text',
        )}
      >
        <Icon className="size-4" aria-hidden />
        {item.label}
      </Link>
    );
  };
  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-text"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-line p-3 lg:flex">
        <Link href="/admin" className="mb-4 flex items-center gap-2 rounded px-2 py-1.5 font-semibold">
          <Logo className="size-6" /> {name}
        </Link>
        <Link href="/admin/compose" className={buttonClass('primary', 'md', 'mb-4 w-full')}>
          <Plus className="size-4" aria-hidden /> New signal
        </Link>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5">
          {PRIMARY.map(link)}
          <div className="my-2 border-t border-line" />
          {secondary.map(link)}
        </nav>
        <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
          <LivePill />
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-muted hover:text-text"
          >
            <LogOut className="size-3.5" aria-hidden /> Sign out
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur lg:hidden">
          <div className="flex h-14 items-center gap-3 px-4">
            <Link href="/admin" className="flex items-center gap-2 rounded font-semibold">
              <Logo className="size-6" /> <span>Admin</span>
            </Link>
            <span className="ml-auto">
              <LivePill />
            </span>
          </div>
        </header>
        <div className="sticky top-0 z-20 max-lg:top-14">
          <ConnectionBanner />
        </div>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-5 lg:px-8 lg:pb-10 lg:pt-7">
          {children}
        </main>
      </div>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <ul className="grid grid-cols-5">
          {[PRIMARY[0], PRIMARY[1]].map((item) => {
            const it = item as (typeof PRIMARY)[number];
            const Icon = it.icon;
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  aria-current={active(it) ? 'page' : undefined}
                  className={clsx(
                    'flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
                    active(it) ? 'text-text' : 'text-muted',
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                  {it.label}
                </Link>
              </li>
            );
          })}
          <li className="grid place-items-center">
            <Link
              href="/admin/compose"
              aria-label="New signal"
              className="grid size-11 place-items-center rounded-full bg-primary text-primary-text"
            >
              <Plus className="size-6" aria-hidden />
            </Link>
          </li>
          <li>
            <Link
              href="/admin/subscribers"
              aria-current={active(PRIMARY[3] as (typeof PRIMARY)[number]) ? 'page' : undefined}
              className={clsx(
                'flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
                active(PRIMARY[3] as (typeof PRIMARY)[number]) ? 'text-text' : 'text-muted',
              )}
            >
              <Users className="size-5" aria-hidden />
              Subscribers
            </Link>
          </li>
          <li>
            <button
              type="button"
              onClick={() => setMore(true)}
              className="flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted"
            >
              <Menu className="size-5" aria-hidden />
              More
            </button>
          </li>
        </ul>
      </nav>
      <Dialog open={more} onOpenChange={setMore} title="More">
        <nav aria-label="More" className="flex flex-col gap-0.5">
          {link(PRIMARY[2] as (typeof PRIMARY)[number])}
          {link(PRIMARY[4] as (typeof PRIMARY)[number])}
          {secondary.map(link)}
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted hover:text-text"
          >
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </nav>
      </Dialog>
    </div>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  useEffect(registerServiceWorker, []);
  return (
    <SessionGate role="ADMIN">
      {(me) => (
        <RealtimeProvider>
          <Shell name={me.support.serviceName} master={me.isMasterAdmin}>
            {children}
          </Shell>
        </RealtimeProvider>
      )}
    </SessionGate>
  );
}
