'use client';

import { type MeResponse, subscriberStatus, type UserNotice, whatsappDigits } from '@signaldesk/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { CalendarX2, Clock, LogOut, Mail, MessageCircle, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Logo } from '@/components/ui';
import { api } from '@/lib/api';
import { signOut } from '@/lib/session';
import { EnquiryActions } from './enquiry';

/** The support contact, read from settings with the account, so a change applies at once. */
export function SupportContact({ me }: { me: MeResponse }) {
  const digits = whatsappDigits(me.support.whatsapp);
  return (
    <div className="flex flex-col gap-2 text-sm">
      {digits && (
        <a
          href={`https://wa.me/${digits}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded hover:underline"
        >
          <MessageCircle className="size-4 text-muted" aria-hidden />
          <span className="num">{me.support.whatsapp}</span>
        </a>
      )}
      <a href={`mailto:${me.support.email}`} className="flex items-center gap-2 rounded hover:underline">
        <Mail className="size-4 text-muted" aria-hidden />
        {me.support.email}
      </a>
    </div>
  );
}

/**
 * What a signed-in person without access sees instead of signals: one short message and one obvious action. It
 * checks again every minute, so a subscription or trial granted meanwhile opens the signals without a reload.
 */
export function SubscriptionStatus({ me }: { me: MeResponse }) {
  const client = useQueryClient();
  const copy = subscriberStatus(me);
  const [showContact, setShowContact] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => void client.invalidateQueries({ queryKey: ['me'] }), 60_000);
    return () => clearInterval(timer);
  }, [client]);
  if (!copy) return null;
  const Icon = copy.tone === 'pending' ? Clock : copy.tone === 'ended' ? CalendarX2 : Sparkles;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Logo className="mb-8 size-8" />
        <div
          className={clsx(
            'mb-4 grid size-11 place-items-center rounded-xl',
            copy.tone === 'ended'
              ? 'bg-stop-soft text-stop'
              : copy.tone === 'pending'
                ? 'bg-update-soft text-update'
                : 'bg-neutral-soft text-muted',
          )}
        >
          <Icon className="size-5" aria-hidden />
        </div>
        <h1 className="text-[22px] font-semibold tracking-tight">{copy.title}</h1>
        <p className="mt-2 text-muted">{copy.body}</p>
        <div className="mt-6">
          {copy.primary && <EnquiryActions purpose={copy.primary.purpose} primaryLabel={copy.primary.label} />}
          {copy.secondary && (
            <Button
              variant="ghost"
              size="lg"
              className="mt-2 w-full"
              onClick={() => setShowContact(!showContact)}
              aria-expanded={showContact}
            >
              {copy.secondary.label}
            </Button>
          )}
          {(showContact || !copy.primary) && (
            <div className="mt-3 rounded-xl border border-line bg-surface p-4">
              <SupportContact me={me} />
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-10 flex items-center gap-2 rounded text-[13px] font-medium text-muted hover:text-text"
        >
          <LogOut className="size-4" aria-hidden />
          Log out
        </button>
      </div>
    </main>
  );
}

/**
 * Messages about the person's own account, shown inside the app until dismissed. Not on the status screen: a
 * message about access that has since ended would only mislead.
 */
export function Notices() {
  const client = useQueryClient();
  const notices = useQuery({
    queryKey: ['notices'],
    queryFn: () => api.get<{ notices: UserNotice[] }>('/me/notices'),
    staleTime: 30_000,
  });
  const unread = (notices.data?.notices ?? []).filter((n) => !n.read).slice(0, 2);
  if (unread.length === 0) return null;
  const dismiss = async () => {
    await api.post('/me/notices/read').catch(() => undefined);
    void client.invalidateQueries({ queryKey: ['notices'] });
  };
  return (
    <section aria-label="Account messages" className="mb-5 flex flex-col gap-2">
      {unread.map((notice) => (
        <div key={notice.id} className="rounded-xl border border-line bg-surface px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">{notice.title}</p>
              <p className="mt-0.5 whitespace-pre-line text-[13px] text-muted">{notice.body}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => void dismiss()} aria-label="Dismiss account messages">
              OK
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}
