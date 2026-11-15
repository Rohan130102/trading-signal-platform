import { ACTIONS, TITLES } from '@signaldesk/domain';
import { useRouter } from 'expo-router';
import { useMe, useSession } from '@/lib/session';
import { EnquiryActions } from '@/subscriber/EnquiryActions';
import { space } from '@/theme/tokens';
import { AuthFrame, Button, Card, T } from '@/ui';

/** Straight after sign-up: the account works, there is no subscription yet, and one clear next step. */
export default function Welcome() {
  const { me } = useSession();
  return me ? <Content /> : null;
}

function Content() {
  const me = useMe();
  const router = useRouter();
  return (
    <AuthFrame title={TITLES.accountCreated} description="Your account is ready.">
      <Card style={{ gap: space.xs }}>
        <T v="strong">No Active Subscription</T>
        <T v="small" c="muted">
          Contact our support team to explore subscription options.
        </T>
      </Card>
      <EnquiryActions me={me} purpose="SUBSCRIPTION" primaryLabel={ACTIONS.sendEnquiry} />
      <Button
        testID="welcome-later"
        label={ACTIONS.doLater}
        variant="ghost"
        full
        onPress={() => router.replace('/access-ended')}
      />
    </AuthFrame>
  );
}
