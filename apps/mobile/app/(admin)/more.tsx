import type { AdminInbox } from '@signaldesk/domain';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { space } from '@/theme/tokens';
import { Badge, Card, Divider, ListRow, PageTitle, Screen, SectionTitle, T } from '@/ui';

export default function More() {
  const router = useRouter();
  const master = useSession().me?.isMasterAdmin === true;
  const inbox = useQuery({
    queryKey: ['admin', 'inbox'],
    queryFn: () => api.get<AdminInbox>('/admin/inbox'),
    refetchInterval: 30_000,
  });
  const count = (n: number | undefined) => (n ? <Badge tone="buy">{String(n)}</Badge> : undefined);
  return (
    <Screen testID="more">
      <PageTitle title="More" />
      <Card padded={false} style={{ paddingHorizontal: space.lg }}>
        <ListRow
          testID="more-registrations"
          icon="person-add-outline"
          title="New Registrations"
          subtitle="People who signed themselves up"
          right={count(inbox.data?.newRegistrations)}
          onPress={() => router.push('/admin/registrations')}
        />
        <Divider />
        <ListRow
          testID="more-password-resets"
          icon="key-outline"
          title="Password Resets"
          subtitle="Requests from verified email addresses"
          right={count(inbox.data?.openPasswordResets)}
          onPress={() => router.push('/admin/password-resets')}
        />
      </Card>
      <Card padded={false} style={{ paddingHorizontal: space.lg }}>
        <ListRow
          testID="more-announcement"
          icon="megaphone-outline"
          title="New announcement"
          onPress={() => router.push('/admin/announcement')}
        />
        <Divider />
        <ListRow
          testID="more-announcements"
          icon="albums-outline"
          title="Announcements"
          subtitle="Live, scheduled, drafts, archive and bin"
          onPress={() => router.push('/admin/announcements')}
        />
        <Divider />
        <ListRow
          testID="more-instruments"
          icon="layers-outline"
          title="Instruments"
          subtitle="Add, edit, switch off or archive"
          onPress={() => router.push('/admin/instruments')}
        />
        <Divider />
        <ListRow
          testID="more-history"
          icon="archive-outline"
          title="Manage history"
          subtitle="Archive finished trades"
          onPress={() => router.push('/admin/history')}
        />
        <Divider />
        <ListRow
          testID="more-drafts"
          icon="document-outline"
          title="Drafts"
          onPress={() => router.push('/admin/drafts')}
        />
        <Divider />
        <ListRow
          testID="more-performance"
          icon="bar-chart-outline"
          title="Performance"
          subtitle="Internal only"
          onPress={() => router.push('/admin/performance')}
        />
        <Divider />
        <ListRow
          testID="more-health"
          icon="pulse-outline"
          title="Notification health"
          onPress={() => router.push('/admin/health')}
        />
      </Card>
      <SectionTitle>{master ? 'Master Admin' : 'Platform'}</SectionTitle>
      <Card padded={false} style={{ paddingHorizontal: space.lg }}>
        <ListRow
          testID="more-settings"
          icon="options-outline"
          title="Platform settings"
          subtitle={master ? 'Signal start, entry window, history, screenshots' : 'See the rules in force'}
          onPress={() => router.push('/admin/settings')}
        />
        {master && (
          <>
            <Divider />
            <ListRow
              testID="more-admins"
              icon="shield-checkmark-outline"
              title="Administrators"
              subtitle="Register, suspend, reset, Master Admin"
              onPress={() => router.push('/admin/admins')}
            />
          </>
        )}
      </Card>
      <SectionTitle>You</SectionTitle>
      <Card padded={false} style={{ paddingHorizontal: space.lg }}>
        <ListRow
          testID="more-account"
          icon="person-circle-outline"
          title="Account and notifications"
          onPress={() => router.push('/admin/account')}
        />
      </Card>
      <SectionTitle>On the web</SectionTitle>
      <Card>
        <T v="small" c="muted">
          Message templates, service texts, compliance approvals and the audit log are managed in the web admin. They
          are set rarely and are easier to check on a large screen.
        </T>
      </Card>
    </Screen>
  );
}
