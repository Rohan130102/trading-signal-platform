import { changePasswordSchema } from '@signaldesk/domain';
import { useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { space } from '@/theme/tokens';
import { AuthFrame, Button, Field, FormError } from '@/ui';

export default function SetPassword() {
  const { refresh, signOut, signInPassword } = useSession();
  const [known] = useState(signInPassword);
  const [current, setCurrent] = useState(known ?? '');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [problems, setProblems] = useState<{ next?: string; again?: string }>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const parsed = changePasswordSchema.safeParse({ currentPassword: current, newPassword: next });
    const nextProblem = parsed.success ? undefined : parsed.error.flatten().fieldErrors.newPassword?.[0];
    const againProblem = next !== again ? 'These do not match.' : undefined;
    setProblems({ next: nextProblem, again: againProblem });
    if (!parsed.success || againProblem) return;
    setError(null);
    setBusy(true);
    try {
      await api.post('/auth/change-password', parsed.data);
      await refresh();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      title="Choose your password"
      description="The password you were given only works once. Pick one that only you know."
    >
      <View style={{ gap: space.md }}>
        {(!known || error !== null) && (
          <Field
            testID="current-password"
            label="Temporary password"
            value={current}
            onChangeText={setCurrent}
            secret
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
          />
        )}
        <Field
          testID="new-password"
          label="New password"
          hint="At least 10 characters."
          value={next}
          onChangeText={setNext}
          error={problems.next}
          secret
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
        />
        <Field
          testID="new-password-again"
          label="New password again"
          value={again}
          onChangeText={setAgain}
          error={problems.again}
          secret
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
        />
        <FormError error={error} />
        <Button
          testID="set-password-submit"
          label="Save and continue"
          variant="primary"
          large
          full
          loading={busy}
          onPress={() => void submit()}
        />
        <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
      </View>
    </AuthFrame>
  );
}
