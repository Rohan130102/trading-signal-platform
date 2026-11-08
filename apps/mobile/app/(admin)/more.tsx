import { useRouter } from 'expo-router';
import { space } from '@/theme/tokens';
import { Card, Divider, ListRow, PageTitle, Screen, SectionTitle, T } from '@/ui';

export default function More() {
  const router = useRouter();
  return (
    <Screen testID="more">
      <PageTitle title="More" />
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
          Message templates, service settings, compliance approvals and the audit log are managed in the web admin.
          They are set rarely and are easier to check on a large screen.
        </T>
      </Card>
    </Screen>
  );
}
