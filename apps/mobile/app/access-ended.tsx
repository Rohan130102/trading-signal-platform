import { subscriberStatus } from '@signaldesk/domain';
import { useEffect, useState } from 'react';
import { AppState, Linking, View } from 'react-native';
import { useMe, useSession } from '@/lib/session';
import { EnquiryActions } from '@/subscriber/EnquiryActions';
import { AuthFrame, Button, Card, ListRow } from '@/ui';

/**
 * What a signed-in person without access sees instead of signals: one short message and one obvious action.
 * Nothing private is here, because the server sends nothing private to this account now. The account is checked
 * again every minute and on returning to the app, so a subscription or trial granted meanwhile opens the signals.
 */
export default function AccessEnded() {
  const { me } = useSession();
  return me ? <Content /> : null;
}

function Content() {
  const me = useMe();
  const { signOut, refresh } = useSession();
  const [contact, setContact] = useState(false);
  // Coming back to the app checks again at once, so someone told they have been renewed sees it straight away.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);
  const copy = subscriberStatus(me);
  if (!copy) return null;
  const digits = me.support.whatsapp.replace(/\D/g, '');
  return (
    <AuthFrame focused title={copy.title} description={copy.body}>
      {copy.primary && <EnquiryActions me={me} purpose={copy.primary.purpose} primaryLabel={copy.primary.label} />}
      {copy.secondary && (
        <Button
          testID="status-contact"
          label={copy.secondary.label}
          variant="ghost"
          full
          onPress={() => setContact(!contact)}
        />
      )}
      {(contact || !copy.primary) && (
        <Card padded={false} testID="support-contact">
          <ListRow
            icon="logo-whatsapp"
            title={me.support.whatsapp}
            onPress={() => void Linking.openURL(`https://wa.me/${digits}`)}
          />
          <ListRow
            icon="mail-outline"
            title={me.support.email}
            onPress={() => void Linking.openURL(`mailto:${me.support.email}`)}
          />
        </Card>
      )}
      <View style={{ flexGrow: 1 }} />
      <Button
        testID="sign-out"
        label="Sign out"
        variant="ghost"
        style={{ alignSelf: 'center' }}
        onPress={() => void signOut()}
      />
    </AuthFrame>
  );
}
