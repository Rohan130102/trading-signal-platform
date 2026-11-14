import {
  ACTIONS,
  type EnquiryOutcome,
  type EnquiryPurpose,
  enquiryMessage,
  type MeResponse,
  whatsappAppLink,
} from '@signaldesk/domain';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { api } from '@/lib/api';
import { newKey } from '@/lib/ids';
import { space } from '@/theme/tokens';
import { Button, FormError, Notice, T } from '@/ui';

interface EnquiryResult {
  id: string;
  outcome: EnquiryOutcome;
}

/** The message and the app link are built from the account and the support number the server sent. */
export function whatsappLinkFor(me: MeResponse, purpose: EnquiryPurpose): string | null {
  if (!me.profile) return null;
  return whatsappAppLink(me.support.whatsapp, enquiryMessage(me.profile, me.support.serviceName, purpose));
}

/**
 * The enquiry, from the phone. WhatsApp is opened directly; if the system reports that it cannot open it, WhatsApp
 * is not installed, so the enquiry is emailed to support from the server instead, after this same tap. Opening
 * WhatsApp is never reported as a message sent.
 */
export function EnquiryActions({
  me,
  purpose,
  primaryLabel,
}: {
  me: MeResponse;
  purpose: EnquiryPurpose;
  primaryLabel: string;
}) {
  const client = useQueryClient();
  const keys = useRef({ WHATSAPP: newKey(), EMAIL: newKey() });
  const [busy, setBusy] = useState<'WHATSAPP' | 'EMAIL' | null>(null);
  const [opened, setOpened] = useState(false);
  const [email, setEmail] = useState<(EnquiryResult & { fallback: boolean }) | null>(null);
  const [error, setError] = useState<unknown>(null);

  const sendEmail = async (fallback: boolean) => {
    const result = await api.post<EnquiryResult>('/me/enquiries', {
      channel: 'EMAIL',
      purpose,
      whatsappUnavailable: fallback,
      idempotencyKey: keys.current.EMAIL,
    });
    setEmail({ ...result, fallback });
  };

  const openWhatsapp = async () => {
    setBusy('WHATSAPP');
    setError(null);
    try {
      const link = whatsappLinkFor(me, purpose);
      let launched = false;
      if (link) {
        try {
          await Linking.openURL(link);
          launched = true;
        } catch {
          launched = false;
        }
      }
      if (launched) {
        await api.post('/me/enquiries', { channel: 'WHATSAPP', purpose, idempotencyKey: keys.current.WHATSAPP });
        keys.current.WHATSAPP = newKey();
        setOpened(true);
      } else {
        await sendEmail(true);
      }
      void client.invalidateQueries({ queryKey: ['me'] });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  };

  const emailInstead = async () => {
    setBusy('EMAIL');
    setError(null);
    try {
      await sendEmail(false);
      void client.invalidateQueries({ queryKey: ['me'] });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  };

  // Follows the email until the provider accepted it or it failed.
  useEffect(() => {
    if (!email || email.outcome !== 'EMAIL_QUEUED') return;
    const timer = setTimeout(() => {
      void api
        .get<EnquiryResult>(`/me/enquiries/${email.id}`)
        .then((next) => setEmail((prev) => (prev ? { ...prev, ...next } : prev)))
        .catch(() => undefined);
    }, 2000);
    return () => clearTimeout(timer);
  }, [email]);

  return (
    <View style={{ gap: space.sm }}>
      <Button
        testID="enquiry-whatsapp"
        label={primaryLabel}
        icon="logo-whatsapp"
        variant="primary"
        large
        full
        loading={busy === 'WHATSAPP'}
        disabled={busy !== null}
        onPress={() => void openWhatsapp()}
      />
      {opened && (
        <T v="small" c="muted" accessibilityLiveRegion="polite">
          WhatsApp opened. Send the message there to reach support.
        </T>
      )}
      <Button
        testID="enquiry-email"
        label={ACTIONS.emailSupportInstead}
        icon="mail-outline"
        large
        full
        loading={busy === 'EMAIL'}
        disabled={busy !== null || (email !== null && email.outcome !== 'EMAIL_FAILED')}
        onPress={() => void emailInstead()}
      />
      {email && (
        <View accessibilityLiveRegion="polite">
          {email.outcome === 'EMAIL_SENT' ? (
            <Notice tone="success" icon="checkmark-circle">
              {email.fallback
                ? 'WhatsApp is not on this phone, so your enquiry was emailed to support.'
                : 'Your enquiry was emailed to support.'}
            </Notice>
          ) : email.outcome === 'EMAIL_FAILED' ? (
            <Notice tone="stop">The email could not be sent. Try again, or contact support directly.</Notice>
          ) : (
            <T v="small" c="muted">
              Sending your enquiry…
            </T>
          )}
        </View>
      )}
      <FormError error={error} />
    </View>
  );
}
