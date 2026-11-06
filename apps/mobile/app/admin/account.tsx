import { AccountSections } from '@/account';
import { useSession } from '@/lib/session';
import { Card, Screen, T } from '@/ui';

export default function AdminAccount() {
  // Sign-out clears the session a moment before this screen goes away.
  const { me } = useSession();
  if (!me) return null;
  return (
    <Screen edges={['bottom']} testID="account">
      <Card>
        <T v="heading">{me.name}</T>
        <T v="small" c="muted" num>
          {me.loginId} · Administrator · Two-step verification {me.mfaEnabled ? 'on' : 'off'}
        </T>
      </Card>
      <AccountSections />
    </Screen>
  );
}
