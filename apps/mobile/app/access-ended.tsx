import { subscriberStatus } from '@signaldesk/domain';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { useMe, useSession } from '@/lib/session';
import { EnquiryActions } from '@/subscriber/EnquiryActions';
import { AuthFrame, Button, Card, ListRow } from '@/ui';

/**
 * What a signed-in person without access sees instead of signals: one short message and one obvious action.
 * Nothing private is here, because the server sends nothing private to this account now. The account is checked
 * again every minute, so a subscription or trial granted meanwhile opens the signals by itself.
 */
export default function AccessEnded() {
  const { me } = useSession();
  return me ? <Content /> : null;
}

function Content() {
  const me = useMe();
  const { signOut } = useSession();
  const [contact, setContact] = useState(false);
  const copy = subscriberStatus(me);
  if (!copy) return null;
  const digits = me.support.whatsapp.replace(/\D/g, '');
  return (
    <AuthFrame title={copy.title} description={copy.body}>
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
        label="Log out"
        variant="ghost"
        style={{ alignSelf: 'center' }}
        onPress={() => void signOut()}
      />
    </AuthFrame>
  );
}
