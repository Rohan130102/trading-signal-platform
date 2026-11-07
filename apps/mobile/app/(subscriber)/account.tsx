import { AccountSections, SubscriptionCard } from '@/account';
import { useSession } from '@/lib/session';
import { PageTitle, Screen } from '@/ui';

export default function Account() {
  // Sign-out clears the session a moment before this screen goes away.
  const { me } = useSession();
  if (!me) return null;
  return (
    <Screen testID="account">
      <PageTitle title="Account" />
      <SubscriptionCard />
      <AccountSections />
    </Screen>
  );
}
