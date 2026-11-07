import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Tabs } from 'expo-router/js-tabs';
import { useRealtime, useStartRealtimeFromHead } from '@/lib/realtime';
import { useColors } from '@/theme';

export default function SubscriberTabs() {
  const c = useColors();
  const { unread } = useRealtime();
  useStartRealtimeFromHead(true);
  return (
    <Tabs
      screenListeners={{ tabPress: () => void Haptics.selectionAsync().catch(() => undefined) }}
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
        options={{
          title: 'Feed',
          tabBarButtonTestID: 'tab-feed',
          tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
          tabBarBadgeStyle: { backgroundColor: c.stop, color: '#fff', fontSize: 11 },
          tabBarIcon: ({ color, size }) => <Ionicons name="pulse" color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="active"
        options={{
          title: 'Active',
          tabBarButtonTestID: 'tab-active',
          tabBarIcon: ({ color, size }) => <Ionicons name="trending-up" color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarButtonTestID: 'tab-history',
          tabBarIcon: ({ color, size }) => <Ionicons name="time-outline" color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarButtonTestID: 'tab-account',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle-outline" color={color as string} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
