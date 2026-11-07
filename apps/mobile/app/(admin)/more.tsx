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
          title="Send an announcement"
          onPress={() => router.push('/admin/announcement')}
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
          Instruments, message templates, service settings, compliance approvals and the audit log are managed in the
          web admin. They are set rarely and are easier to check on a large screen.
        </T>
      </Card>
    </Screen>
  );
}
