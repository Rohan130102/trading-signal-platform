import { ACTIONS, type ChallengeResponse, OTP_LENGTH, OTP_RESEND_SECONDS } from '@signaldesk/domain';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { space } from '@/theme/tokens';
import { Button, Field, FormError, T } from '@/ui';

/** Field messages from the server's validation, keyed by field name. */
export function issuesByField(error: unknown): Record<string, string> {
  const issues = (error as { details?: { issues?: { field: string; message: string }[] } } | null)?.details?.issues;
  const out: Record<string, string> = {};
  for (const issue of issues ?? []) out[issue.field.split('.')[0] as string] ??= issue.message;
  return out;
}

/** The code, a resend with its wait, and the server's own messages. Shared by sign-up and recovery. */
export function CodeStep({
  challenge,
  resendPath,
  verifyPath,
  onVerified,
  onChallenge,
}: {
  challenge: ChallengeResponse;
  resendPath: string;
  verifyPath: string;
  onVerified: (result: unknown) => void;
  onChallenge: (challenge: ChallengeResponse) => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (code.length !== OTP_LENGTH) {
      setError(new Error(`Enter the ${OTP_LENGTH}-digit code.`));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onVerified(await api.post(verifyPath, { challengeId: challenge.challengeId, code }));
    } catch (caught) {
      setError(caught);
      setCode('');
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: space.md }}>
      <Field
        testID="otp-code"
        label="Verification code"
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, OTP_LENGTH))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={OTP_LENGTH}
        autoFocus
        big
        style={{ textAlign: 'center', letterSpacing: 8 }}
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />
      <FormError error={error} />
      <Button
        testID="otp-verify"
        label={ACTIONS.verifyEmail}
        variant="primary"
        large
        full
        loading={busy}
        onPress={() => void submit()}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
        <T v="small" c="muted" style={{ flexShrink: 1 }}>
          Expires in 5 minutes.
        </T>
        <ResendButton
          key={challenge.resendAvailableAt}
          onPress={() => {
            setError(null);
            api
              .post<ChallengeResponse>(resendPath, { challengeId: challenge.challengeId })
              .then(onChallenge)
              .catch(setError);
          }}
        />
      </View>
    </View>
  );
}

/**
 * Counts down from when this code arrived (remounted for each code), so a phone whose clock is off still shows the
 * right wait. The server enforces the same wait in any case. While waiting it is plain text in the regular weight:
 * nothing to press yet, and Android measures it exactly (a semi-bold label could lose its last line).
 */
function ResendButton({ onPress }: { onPress: () => void }) {
  const [arrivedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const wait = Math.max(0, Math.ceil(OTP_RESEND_SECONDS - (now - arrivedAt) / 1000));
  useEffect(() => {
    if (wait === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [wait]);
  if (wait > 0) {
    return (
      <T v="small" c="subtle" num testID="otp-resend" style={{ flexShrink: 0, paddingHorizontal: space.md }}>
        {`${ACTIONS.resendCode} in ${wait}s`}
      </T>
    );
  }
  return <Button testID="otp-resend" small variant="ghost" label={ACTIONS.resendCode} onPress={onPress} />;
}
