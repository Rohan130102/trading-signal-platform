'use client';

import { ACTIONS, type EnquiryOutcome, type EnquiryPurpose } from '@signaldesk/domain';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Mail, MessageCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, FormError } from '@/components/ui';
import { api } from '@/lib/api';

interface EnquiryResult {
  id: string;
  outcome: EnquiryOutcome;
  whatsappLink: string | null;
}

/**
 * The enquiry, from a browser. A browser cannot tell whether WhatsApp is installed or whether the message was sent,
 * so this only says that WhatsApp was opened, and always offers email alongside. The email goes from the server.
 */
export function EnquiryActions({
  purpose,
  primaryLabel,
  hideEmail = false,
}: {
  purpose: EnquiryPurpose;
  primaryLabel: string;
  hideEmail?: boolean;
}) {
  const client = useQueryClient();
  const [opened, setOpened] = useState(false);
  const [email, setEmail] = useState<EnquiryResult | null>(null);
  const [busy, setBusy] = useState<'WHATSAPP' | 'EMAIL' | null>(null);
  const [error, setError] = useState<unknown>(null);
  // One key per tap sequence: a double tap or a retry is the same enquiry.
  const keys = useRef({ WHATSAPP: crypto.randomUUID(), EMAIL: crypto.randomUUID() });

  const send = async (channel: 'WHATSAPP' | 'EMAIL') => {
    setBusy(channel);
    setError(null);
    // Opened before the request so the browser does not treat it as an unrequested pop-up.
    const popup = channel === 'WHATSAPP' ? window.open('about:blank', '_blank') : null;
    try {
      const result = await api.post<EnquiryResult>('/me/enquiries', {
        channel,
        purpose,
        idempotencyKey: keys.current[channel],
      });
      if (channel === 'WHATSAPP' && result.whatsappLink) {
        if (popup) popup.location.href = result.whatsappLink;
        else window.location.href = result.whatsappLink;
        setOpened(true);
        keys.current.WHATSAPP = crypto.randomUUID();
      } else {
        popup?.close();
        setEmail(result);
      }
      void client.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      popup?.close();
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  // Follows the email until the provider has accepted it or it has failed.
  useEffect(() => {
    if (!email || email.outcome !== 'EMAIL_QUEUED') return;
    const timer = setTimeout(() => {
      void api.get<EnquiryResult>(`/me/enquiries/${email.id}`).then(setEmail).catch(() => undefined);
    }, 2000);
    return () => clearTimeout(timer);
  }, [email]);

  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        loading={busy === 'WHATSAPP'}
        disabled={busy !== null}
        onClick={() => void send('WHATSAPP')}
      >
        <MessageCircle className="size-4" aria-hidden />
        {primaryLabel}
      </Button>
      {opened && (
        <p className="text-[13px] text-muted" role="status">
          WhatsApp opened in a new tab. Send the message there to reach support.
        </p>
      )}
      {!hideEmail && (
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          loading={busy === 'EMAIL'}
          disabled={busy !== null || (email !== null && email.outcome !== 'EMAIL_FAILED')}
          onClick={() => void send('EMAIL')}
        >
          <Mail className="size-4" aria-hidden />
          {ACTIONS.emailSupportInstead}
        </Button>
      )}
      {email && (
        <p className="flex items-center gap-2 text-[13px]" role="status">
          {email.outcome === 'EMAIL_SENT' ? (
            <>
              <CheckCircle2 className="size-4 text-success" aria-hidden />
              <span>Your enquiry was emailed to support.</span>
            </>
          ) : email.outcome === 'EMAIL_FAILED' ? (
            <span className="text-stop">The email could not be sent. Try again, or use WhatsApp.</span>
          ) : (
            <span className="text-muted">Sending your enquiry…</span>
          )}
        </p>
      )}
      <FormError error={error} />
    </div>
  );
}
