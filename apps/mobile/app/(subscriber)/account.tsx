import { AccountSections, SubscriptionCard } from '@/account';
import { PageTitle, Screen } from '@/ui';

export default function Account() {
  return (
    <Screen testID="account">
      <PageTitle title="Account" />
      <SubscriptionCard />
      <AccountSections />
    </Screen>
  );
}
