import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import { haptics } from '@/lib/haptics';
import { useRealtime, useStartRealtimeFromHead } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { ProtectedScreen } from '@/security/Protected';
import { TrialGreeting } from '@/subscriber/TrialGreeting';
import { useColors } from '@/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const icon =
  (name: IconName) =>
  ({ color, size }: { color: unknown; size: number }) => <Ionicons name={name} color={color as string} size={size} />;

/**
 * Five places at most: the signals themselves, what was sent, news from the desk, the record, and the
 * account. Every one of them shows paid content, so the whole group is screen-protected.
 */
export default function SubscriberTabs() {
  const c = useColors();
  const { unread } = useRealtime();
  const { me } = useSession();
  useStartRealtimeFromHead(true);
  return (
    <ProtectedScreen id="subscriber" screen="tabs">
      <Tabs
        screenListeners={{ tabPress: () => haptics.selection() }}
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: c.text,
          tabBarInactiveTintColor: c.subtle,
          tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.line },
          tabBarLabelStyle: { fontWeight: '600', fontSize: 11 },
          // The bar has a fixed height, and its icons already say the same thing.
          tabBarAllowFontScaling: false,
        }}
      >
        <Tabs.Screen
          name="feed"
          options={{ title: 'Signals', tabBarButtonTestID: 'tab-feed', tabBarIcon: icon('pulse') }}
        />
        <Tabs.Screen
          name="alerts"
          options={{
            title: 'Alerts',
            tabBarButtonTestID: 'tab-alerts',
            tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
            tabBarBadgeStyle: { backgroundColor: c.stop, color: '#fff', fontSize: 11 },
            tabBarIcon: icon('notifications-outline'),
          }}
        />
        <Tabs.Screen
          name="news"
          options={{ title: 'News', tabBarButtonTestID: 'tab-news', tabBarIcon: icon('megaphone-outline') }}
        />
        <Tabs.Screen
          name="history"
          options={{ title: 'History', tabBarButtonTestID: 'tab-history', tabBarIcon: icon('time-outline') }}
        />
        <Tabs.Screen
          name="account"
          options={{ title: 'Account', tabBarButtonTestID: 'tab-account', tabBarIcon: icon('person-circle-outline') }}
        />
      </Tabs>
      {me && <TrialGreeting me={me} />}
    </ProtectedScreen>
  );
}
