'use client';

import { BellRing, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, buttonClass } from '@/components/ui';
import { usePush } from '@/lib/push';

/** Offers alerts on this device once, where it helps: on Signals and Alerts. Dismissed once, gone everywhere. */
export function PushPrompt() {
  const { state, enable, busy } = usePush();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem('sd-push-prompt-dismissed') === '1');
    } catch {
      setDismissed(false);
    }
  }, []);
  if (dismissed || (state !== 'ready' && state !== 'ios-needs-install' && state !== 'denied')) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem('sd-push-prompt-dismissed', '1');
    } catch {
      // It simply reappears next time.
    }
  };
  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-line bg-surface p-3.5">
      <BellRing className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        {state === 'ready' && (
          <>
            <p className="text-sm font-medium">Get alerts on this device</p>
            <p className="text-[13px] text-muted">
              Know about new signals and stop-loss changes without keeping the app open.
            </p>
            <Button size="sm" variant="primary" className="mt-2" loading={busy} onClick={() => void enable()}>
              Turn on notifications
            </Button>
          </>
        )}
        {state === 'ios-needs-install' && (
          <>
            <p className="text-sm font-medium">Want alerts on your iPhone?</p>
            <p className="text-[13px] text-muted">First add this app to your Home Screen.</p>
            <Link href="/app/account#notifications" className={buttonClass('secondary', 'sm', 'mt-2')}>
              Show me how
            </Link>
          </>
        )}
        {state === 'denied' && (
          <>
            <p className="text-sm font-medium">Notifications are blocked on this device</p>
            <p className="text-[13px] text-muted">This feed still updates while the app is open.</p>
            <Link href="/app/account#notifications" className={buttonClass('secondary', 'sm', 'mt-2')}>
              How to fix this
            </Link>
          </>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className="-mr-1 -mt-1 grid size-11 shrink-0 place-items-center rounded-lg text-muted hover:text-text"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
