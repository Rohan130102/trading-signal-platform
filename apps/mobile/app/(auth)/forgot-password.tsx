import { ACTIONS, type ChallengeResponse, maskEmail, passwordResetRequestSchema, TITLES } from '@signaldesk/domain';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { CodeStep } from '@/subscriber/AuthParts';
import { space } from '@/theme/tokens';
import { AuthFrame, Button, Field, FormError, Notice } from '@/ui';

/** Recovery: prove the address, then an administrator issues a temporary password. */
export default function ForgotPassword() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<ChallengeResponse | null>(null);
  const [done, setDone] = useState(false);
  const back = (
    <Button
      testID="reset-back"
      label={`Back to ${ACTIONS.logIn}`}
      variant="ghost"
      full
      onPress={() => router.replace('/login')}
    />
  );

  if (done) {
    return (
      <AuthFrame title={TITLES.passwordResetRequested}>
        <Notice tone="success" icon="checkmark-circle" title="Your request has been sent to our support team.">
          You will receive instructions to access your account.
        </Notice>
        {back}
      </AuthFrame>
    );
  }
  if (challenge) {
    return (
      <AuthFrame
        title={ACTIONS.verifyEmail}
        description={`If ${maskEmail(challenge.email)} has an account, we sent it a code.`}
      >
        <CodeStep
          challenge={challenge}
          resendPath="/auth/password-reset/resend"
          verifyPath="/auth/password-reset/verify"
          onChallenge={setChallenge}
          onVerified={() => setDone(true)}
        />
        {back}
      </AuthFrame>
    );
  }
  const submit = async () => {
    const parsed = passwordResetRequestSchema.safeParse({ email });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Enter a valid email address');
      return;
    }
    setFieldError(undefined);
    setError(null);
    setBusy(true);
    try {
      setChallenge(await api.post<ChallengeResponse>('/auth/password-reset', parsed.data));
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthFrame
      title={ACTIONS.forgotPassword.replace('?', '')}
      description="Enter the email address you registered with."
    >
      <View style={{ gap: space.md }}>
        <Field
          testID="reset-email"
          label="Email address"
          value={email}
          onChangeText={setEmail}
          error={fieldError}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          autoFocus
          returnKeyType="send"
          onSubmitEditing={() => void submit()}
        />
        <FormError error={error} />
        <Button
          testID="reset-send"
          label="Send Code"
          variant="primary"
          large
          full
          loading={busy}
          onPress={() => void submit()}
        />
        {back}
      </View>
    </AuthFrame>
  );
}
