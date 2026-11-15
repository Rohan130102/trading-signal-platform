import { useMutation } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Linking, Share, StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useColors } from '@/theme';
import { radius, space } from '@/theme/tokens';
import { AuthFrame, Button, Card, Field, FormError, Loading, Notice, T, useToast } from '@/ui';

interface Setup {
  secret: string;
  uri: string;
  qrSvg: string;
}

export default function MfaSetup() {
  const c = useColors();
  const { refresh, signOut, setHoldRoute } = useSession();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const setup = useMutation({ mutationFn: () => api.post<Setup>('/auth/mfa/setup') });
  const enable = useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code }),
    onSuccess: (data) => {
      // These appear once. Two-step is now on, so the next account refresh would move on from this
      // screen, for example on coming back from pasting them somewhere safe.
      setHoldRoute(true);
      setRecovery(data.recoveryCodes);
    },
  });
  const started = useRef(false);
  const beginSetup = setup.mutate;
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    beginSetup();
  }, [beginSetup]);

  if (recovery) {
    const text = recovery.join('\n');
    return (
      <AuthFrame
        focused
        title="Save your recovery codes"
        description="If you lose your phone, each of these lets you sign in once. They will not be shown again."
      >
        <Card testID="recovery-codes" style={styles.codes}>
          {recovery.map((value) => (
            <T key={value} num style={styles.code} selectable>
              {value}
            </T>
          ))}
        </Card>
        <Button
          label="Copy codes"
          icon="copy-outline"
          onPress={() => {
            void Clipboard.setStringAsync(text);
            toast({ title: 'Copied', body: 'Paste them somewhere safe, then clear your clipboard.', tone: 'success' });
          }}
        />
        <Button
          label="Save with another app"
          icon="share-outline"
          onPress={() => void Share.share({ message: text })}
        />
        <Button
          testID="recovery-saved"
          label="I have saved them"
          variant="primary"
          large
          onPress={() => {
            setHoldRoute(false);
            void refresh();
          }}
        />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      focused
      title="Set up two-step verification"
      description="Administrator accounts need a code from an authenticator app, such as Google Authenticator or 1Password."
    >
      <FormError error={setup.error} />
      {!setup.data && !setup.error && <Loading rows={1} label="Preparing" />}
      {setup.data && (
        <View style={{ gap: space.lg }}>
          <Button
            testID="mfa-open-app"
            label="Add to my authenticator app"
            icon="open-outline"
            variant="primary"
            onPress={() =>
              void Linking.openURL(setup.data.uri).catch(() =>
                toast({
                  title: 'No authenticator app found',
                  body: 'Install one, or use the code below.',
                  tone: 'warning',
                }),
              )
            }
          />
          <View style={styles.or}>
            <T v="small" c="muted" center>
              Or scan this from another device
            </T>
            <View
              accessibilityRole="image"
              accessibilityLabel="QR code for your authenticator app"
              style={[styles.qr, { borderColor: c.line }]}
            >
              <SvgXml xml={setup.data.qrSvg} width="100%" height="100%" />
            </View>
          </View>
          <Card>
            <T v="small" c="muted">
              Or enter this key manually
            </T>
            <T testID="mfa-secret" num selectable style={{ marginTop: 4 }}>
              {setup.data.secret}
            </T>
            <Button
              label="Copy key"
              small
              icon="copy-outline"
              style={{ marginTop: space.md, alignSelf: 'flex-start' }}
              onPress={() => {
                void Clipboard.setStringAsync(setup.data.secret);
                toast({ title: 'Key copied', tone: 'success' });
              }}
            />
          </Card>
          <Field
            testID="mfa-code"
            label="Then type the six digits it shows"
            big
            value={code}
            onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
          />
          <FormError error={enable.error} />
          <Button
            testID="mfa-enable"
            label="Turn on"
            variant="primary"
            large
            disabled={code.length !== 6}
            loading={enable.isPending}
            onPress={() => enable.mutate()}
          />
          <Notice tone="neutral">Signing in on a new phone later will need one of these codes.</Notice>
          <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
        </View>
      )}
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  codes: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.sm },
  code: { width: '50%', fontWeight: '600' },
  or: { gap: space.sm, alignItems: 'center' },
  qr: {
    width: 208,
    height: 208,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
