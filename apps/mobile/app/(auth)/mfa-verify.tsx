import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { space } from '@/theme/tokens';
import { AuthFrame, Button, Field, FormError } from '@/ui';

export default function MfaVerify() {
  const { refresh, signOut } = useSession();
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const verify = useMutation({
    mutationFn: () => api.post('/auth/mfa/verify', { code: code.trim() }),
    onSuccess: () => refresh(),
    onError: () => setCode(''),
  });
  const ready = useRecovery ? code.trim().length >= 6 : code.length === 6;
  return (
    <AuthFrame
      title="Enter your code"
      description={
        useRecovery ? 'Each recovery code works once.' : 'Open your authenticator app and type the six digits it shows.'
      }
    >
      <View style={{ gap: space.md }}>
        <Field
          testID="mfa-code"
          label={useRecovery ? 'Recovery code' : 'Six-digit code'}
          big={!useRecovery}
          num
          value={code}
          onChangeText={(value) => setCode(useRecovery ? value : value.replace(/\D/g, '').slice(0, 6))}
          keyboardType={useRecovery ? 'default' : 'number-pad'}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          returnKeyType="go"
          onSubmitEditing={() => ready && verify.mutate()}
          autoFocus
        />
        <FormError error={verify.error} />
        <Button
          testID="mfa-verify"
          label="Continue"
          variant="primary"
          large
          disabled={!ready}
          loading={verify.isPending}
          onPress={() => verify.mutate()}
        />
        <Button
          testID="mfa-use-recovery"
          label={useRecovery ? 'Use my authenticator app' : 'Use a recovery code'}
          variant="ghost"
          onPress={() => {
            setCode('');
            setUseRecovery((v) => !v);
          }}
        />
        <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
      </View>
    </AuthFrame>
  );
}
