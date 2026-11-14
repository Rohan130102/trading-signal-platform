import { ACTIONS, type ChallengeResponse, OTP_LENGTH } from '@signaldesk/domain';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { space } from '@/theme/tokens';
import { Button, Field, FormError, Segmented, T } from '@/ui';

/** Two clearly separate ways in. */
export function AuthTabs({ current }: { current: 'login' | 'signup' }) {
  const router = useRouter();
  return (
    <Segmented<'login' | 'signup'>
      label="Account"
      value={current}
      onChange={(v) => v !== current && router.replace(v === 'login' ? '/login' : '/signup')}
      options={[
        { value: 'login', label: ACTIONS.logIn, testID: 'tab-login' },
        { value: 'signup', label: ACTIONS.signUp, testID: 'tab-signup' },
      ]}
    />
  );
}

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
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const wait = Math.max(0, Math.ceil((Date.parse(challenge.resendAvailableAt) - now) / 1000));
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
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <T v="small" c="muted">
          Expires in 5 minutes.
        </T>
        <Button
          testID="otp-resend"
          small
          variant="ghost"
          label={wait > 0 ? `${ACTIONS.resendCode} in ${wait}s` : ACTIONS.resendCode}
          disabled={wait > 0}
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
