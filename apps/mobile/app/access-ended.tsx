import { accessEndedCopy } from '@signaldesk/domain';
import * as Clipboard from 'expo-clipboard';
import { View } from 'react-native';
import { useMe, useSession } from '@/lib/session';
import { space } from '@/theme/tokens';
import { AuthFrame, Button, Card, T, useToast } from '@/ui';

/** Nothing private is on this screen, because the server sends nothing private to this account now. */
export default function AccessEnded() {
  const { me } = useSession();
  return me ? <Content /> : null;
}

function Content() {
  const me = useMe();
  const { signOut, refresh } = useSession();
  const toast = useToast();
  const copy = accessEndedCopy(me);
  return (
    <AuthFrame title={copy.title} description={copy.body}>
      {(me.support.renewalInstructions || me.support.contact) && (
        <Card testID="renewal" style={{ gap: space.sm }}>
          {me.support.renewalInstructions ? <T>{me.support.renewalInstructions}</T> : null}
          {me.support.contact ? (
            <View style={{ gap: space.sm }}>
              <T v="small" c="muted">
                Contact
              </T>
              <T v="strong" selectable>
                {me.support.contact}
              </T>
              <Button
                small
                label="Copy"
                icon="copy-outline"
                style={{ alignSelf: 'flex-start' }}
                onPress={() => {
                  void Clipboard.setStringAsync(me.support.contact);
                  toast({ title: 'Copied', tone: 'success' });
                }}
              />
            </View>
          ) : null}
        </Card>
      )}
      <Button
        testID="access-check"
        label="I have renewed, check again"
        variant="primary"
        onPress={() => void refresh()}
      />
      <Button testID="sign-out" label="Sign out" variant="ghost" onPress={() => void signOut()} />
    </AuthFrame>
  );
}
