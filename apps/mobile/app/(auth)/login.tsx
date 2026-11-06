import { loginSchema } from '@signaldesk/domain';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { space } from '@/theme/tokens';
import { AuthFrame, Button, Field, FormError, type InputHandle, Notice, T } from '@/ui';

export interface PublicInfo {
  serviceName: string;
  serviceDescription: string;
  legalEntityName: string;
  regulatoryStatement: string;
  riskDisclosure: string;
  privacyNotice: string;
  supportContact: string;
}

export default function Login() {
  const { signIn, notice } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [fieldErrors, setFieldErrors] = useState<{ identifier?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);
  const passwordInput = useRef<InputHandle>(null);
  const info = useQuery({
    queryKey: ['public-info'],
    queryFn: () => api.get<PublicInfo>('/public/info'),
    staleTime: 3_600_000,
    retry: false,
  });

  const submit = async () => {
    const parsed = loginSchema.safeParse({ identifier, password });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setFieldErrors({ identifier: flat.identifier?.[0], password: flat.password?.[0] });
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
      title={`Sign in to ${info.data?.serviceName ?? 'SignalDesk'}`}
      description="Use the login ID and password your administrator gave you."
    >
      {notice && !error && <Notice tone="neutral">{notice}</Notice>}
      <View style={{ gap: space.md }}>
        <Field
          testID="login-id"
          label="Login ID"
          value={identifier}
          onChangeText={setIdentifier}
          error={fieldErrors.identifier}
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
        <FormError error={error instanceof ApiError && error.code === 'NOT_CONFIGURED' ? null : error} />
        <Button
          testID="login-submit"
          label="Sign in"
          variant="primary"
          large
          full
          loading={busy}
          onPress={() => void submit()}
        />
      </View>
      <View style={{ flexGrow: 1 }} />
      <View style={{ gap: space.sm, alignItems: 'center' }}>
        <T v="caption" c="subtle" center>
          Forgot your password? Your administrator can reset it.
        </T>
        <Link href="/disclosures" asChild>
          <Pressable accessibilityRole="link" hitSlop={10} testID="login-disclosures">
            <T v="small" c="muted" style={{ textDecorationLine: 'underline' }}>
              Risk disclosure and privacy
            </T>
          </Pressable>
        </Link>
      </View>
    </AuthFrame>
  );
}
