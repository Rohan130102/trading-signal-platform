import Ionicons from '@expo/vector-icons/Ionicons';
import { haptics } from '@/lib/haptics';
import { useRouter } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, View } from 'react-native';
import { useStartRealtimeFromHead } from '@/lib/realtime';
import { useColors } from '@/theme';

/** Publishing is the job that cannot wait, so it is one tap from every tab. */
function NewSignalButton() {
  const c = useColors();
  const router = useRouter();
  return (
    <View style={styles.newWrap}>
      <Pressable
        testID="tab-new-signal"
        accessibilityRole="button"
        accessibilityLabel="New signal"
        onPress={() => {
          haptics.impact('medium');
          router.push('/compose');
        }}
        style={({ pressed }) => [styles.newButton, { backgroundColor: c.primary, opacity: pressed ? 0.8 : 1 }]}
      >
        <Ionicons name="add" size={28} color={c.primaryText} />
      </Pressable>
    </View>
  );
}

export default function AdminTabs() {
  const c = useColors();
  useStartRealtimeFromHead(true);
  return (
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
        name="dashboard"
        options={{
          title: 'Desk',
          tabBarButtonTestID: 'tab-dashboard',
          tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="desk"
        options={{
          title: 'Trades',
          tabBarButtonTestID: 'tab-trades',
          tabBarIcon: ({ color, size }) => <Ionicons name="trending-up" color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen name="new" options={{ title: 'New', tabBarButton: () => <NewSignalButton /> }} />
      <Tabs.Screen
        name="subscribers"
        options={{
          title: 'Subscribers',
          tabBarButtonTestID: 'tab-subscribers',
          tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarButtonTestID: 'tab-more',
          tabBarIcon: ({ color, size }) => <Ionicons name="ellipsis-horizontal" color={color as string} size={size} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  newWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  newButton: { width: 48, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
