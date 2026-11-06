'use client';

import { WifiOff } from 'lucide-react';
import { useRealtime } from '@/lib/realtime';

/** Only speaks up when something is wrong: a calm app is one that is working. */
export function ConnectionBanner() {
  const { state } = useRealtime();
  const show = state === 'reconnecting' || state === 'offline';
  return (
    <div aria-live="polite">
      {show && (
        <div className="flex items-center justify-center gap-2 bg-update-soft px-4 py-2 text-[13px] font-medium text-update">
          <WifiOff className="size-4 shrink-0" aria-hidden />
          {state === 'offline'
            ? 'You are offline. Anything you miss will appear when you reconnect.'
            : 'Reconnecting. Prices and updates here may be out of date.'}
        </div>
      )}
    </div>
  );
}

export function LivePill() {
  const { state } = useRealtime();
  const label =
    state === 'live'
      ? 'Live'
      : state === 'connecting'
        ? 'Connecting'
        : state === 'offline'
          ? 'Offline'
          : 'Reconnecting';
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted"
      title={state === 'live' ? 'Updates arrive here without refreshing' : 'Waiting for the connection'}
    >
      <span className={`size-1.5 rounded-full ${state === 'live' ? 'bg-success' : 'bg-update'}`} aria-hidden />
      {label}
    </span>
  );
}
