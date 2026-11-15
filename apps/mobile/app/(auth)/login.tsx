import { ACTIONS, loginSchema } from '@signaldesk/domain';
import { Link, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme';
import { AuthFrame, Button, Field, FormError, type InputHandle, Notice, T, usePublicInfo } from '@/ui';

export default function Login() {
  const { signIn, notice } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [fieldErrors, setFieldErrors] = useState<{ identifier?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);
  const passwordInput = useRef<InputHandle>(null);
  const c = useColors();
  const router = useRouter();
  const info = usePublicInfo();
  // One way to create an account: this button. Hidden only while the Super Admin has paused sign-up.
  const canSignUp = info.data?.signupOpen ?? true;

  const submit = async () => {
    const parsed = loginSchema.safeParse({ identifier, password });
    if (!parsed.success) {
      setFieldErrors({
        identifier: identifier.trim() ? undefined : 'Enter your email or username',
        password: password ? undefined : 'Enter your password',
      });
      return;
    }
    setFieldErrors({});
    setError(null);
    setBusy(true);
    try {
      await signIn(parsed.data.identifier, parsed.data.password);
    } catch (caught) {
      setError(caught);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      title="Welcome back"
      description="Log in to your account."
      footer={
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.lg, flexWrap: 'wrap' }}>
          <Link href="/about" asChild>
            <Pressable accessibilityRole="link" hitSlop={10} testID="login-about">
              <T v="small" c="muted" style={{ textDecorationLine: 'underline' }}>
                About us
              </T>
            </Pressable>
          </Link>
          <Link href="/disclosures" asChild>
            <Pressable accessibilityRole="link" hitSlop={10} testID="login-disclosures">
              <T v="small" c="muted" style={{ textDecorationLine: 'underline' }}>
                Risk disclosure and privacy
              </T>
            </Pressable>
          </Link>
        </View>
      }
    >
      {notice && !error && <Notice tone="neutral">{notice}</Notice>}
      <View style={{ gap: space.md }}>
        <Field
          testID="login-id"
          label="Email or username"
          value={identifier}
          onChangeText={setIdentifier}
          error={fieldErrors.identifier}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          returnKeyType="next"
          onSubmitEditing={() => passwordInput.current?.focus()}
          submitBehavior="submit"
        />
        <Field
          testID="login-password"
          ref={passwordInput}
          label="Password"
          value={password}
          onChangeText={setPassword}
          error={fieldErrors.password}
          secret
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
        />
        <Link href="/forgot-password" asChild>
          <Pressable accessibilityRole="link" hitSlop={10} style={{ alignSelf: 'flex-end' }} testID="login-forgot">
            <T v="small" c="muted" style={{ fontWeight: '600' }}>
              {ACTIONS.forgotPassword}
            </T>
          </Pressable>
        </Link>
        <FormError error={error instanceof ApiError && error.code === 'NOT_CONFIGURED' ? null : error} />
        <Button
          testID="login-submit"
          label={ACTIONS.logIn}
          variant="primary"
          large
          full
          loading={busy}
          onPress={() => void submit()}
        />
      </View>
      {canSignUp && (
        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
            <T v="small" c="subtle">
              New here?
            </T>
            <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
          </View>
          <Button
            testID="login-create"
            label={ACTIONS.createAccount}
            large
            full
            onPress={() => router.push('/signup')}
          />
        </View>
      )}
    </AuthFrame>
  );
}
