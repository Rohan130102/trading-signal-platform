import { AccountSections } from '@/account';
import { useMe } from '@/lib/session';
import { Card, Screen, T } from '@/ui';

export default function AdminAccount() {
  const me = useMe();
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
