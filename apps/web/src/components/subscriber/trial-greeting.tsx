'use client';

import { type MeResponse, trialGreetingCopy } from '@signaldesk/domain';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { api } from '@/lib/api';

const PIECES = Array.from({ length: 18 }, (_, i) => i);

/**
 * Welcomes a newly granted trial, once per grant across every device: the server records that it was seen.
 * Light and short; with reduced motion it simply appears.
 */
export function TrialGreeting({ me }: { me: MeResponse }) {
  const client = useQueryClient();
  const grant = me.trialGreeting;
  const [closing, setClosing] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), [grant?.grantId]);
  if (!grant) return null;
  const copy = trialGreetingCopy(grant);
  const close = async () => {
    setClosing(true);
    await api.post(`/me/trial-greeting/${grant.grantId}`).catch(() => undefined);
    await client.invalidateQueries({ queryKey: ['me'] });
    void client.invalidateQueries({ queryKey: ['notices'] });
  };
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 animate-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trial-title"
      aria-describedby="trial-body"
      onKeyDown={(e) => e.key === 'Escape' && void close()}
    >
      <div className="trial-card relative w-full max-w-sm overflow-hidden rounded-3xl border border-line-strong bg-surface px-6 pb-6 pt-10 text-center shadow-float">
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {PIECES.map((i) => (
            <span key={i} className="trial-piece" style={{ ['--i' as string]: i }} />
          ))}
        </div>
        <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">{copy.eyebrow}</p>
        <div className="trial-days mx-auto mt-4 grid size-24 place-items-center rounded-full bg-primary text-primary-text">
          <span className="num text-4xl font-semibold leading-none">{grant.durationDays}</span>
          <span className="-mt-3 text-[11px] font-semibold uppercase tracking-wide">{grant.durationDays === 1 ? 'day' : 'days'}</span>
        </div>
        <h2 id="trial-title" className="mt-5 text-xl font-semibold tracking-tight">
          {copy.title}
        </h2>
        <p id="trial-body" className="mt-2 text-sm text-muted">
          {copy.body}
        </p>
        <Button ref={button} variant="primary" size="lg" className="mt-6 w-full" loading={closing} onClick={() => void close()}>
          {copy.action}
        </Button>
      </div>
    </div>
  );
}
