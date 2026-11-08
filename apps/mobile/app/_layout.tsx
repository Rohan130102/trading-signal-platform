import { isSafeDeepLink } from '@signaldesk/domain';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, ThemeProvider as NavigationThemeProvider, usePathname, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { API } from '@/lib/config';
import { listenForNotifications, syncPushToken } from '@/lib/push';
import { connectQueryToDevice, createQueryClient } from '@/lib/query';
import { RealtimeProvider, useRealtime } from '@/lib/realtime';
import { gateRedirect, resolveDeepLink } from '@/lib/routing';
import { SessionProvider, useSession } from '@/lib/session';
import { ThemeProvider, useColors, useTheme } from '@/theme';
import { space } from '@/theme/tokens';
import { Button, EmptyState, Loading, Logo, T, ToastProvider, useToast } from '@/ui';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const client = createQueryClient();

export default function RootLayout() {
  useEffect(() => connectQueryToDevice(), []);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <ToastProvider>
            <SessionProvider>
              <App />
            </SessionProvider>
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function App() {
  const { colors, navigation } = useTheme();
  const { state, me, holdRoute } = useSession();
  const router = useRouter();
  const segments = useSegments();
  const redirect = holdRoute ? null : gateRedirect(state, segments);
  const [pending, setPending] = useState<string | null>(null);
  const settled = state.phase === 'signed-in' && !redirect;

  useEffect(() => {
    if (state.phase !== 'starting') void SplashScreen.hideAsync().catch(() => undefined);
  }, [state.phase]);

  useEffect(() => {
    if (!redirect) return;
    // Opening a link while signed out still leads there after signing in.
    const wanted = `/${segments.join('/')}`;
    if (state.phase === 'signed-out' && isSafeDeepLink(wanted)) setPending(wanted);
    router.replace(redirect as never);
  }, [redirect, router, segments, state.phase]);

  useEffect(() => {
    if (!settled || !pending || !me || me.next) return;
    setPending(null);
    const target = resolveDeepLink(me, pending);
    if (target) router.push(target as never);
  }, [me, pending, router, settled]);

  const signedInFully = state.phase === 'signed-in' && !state.me.next;
  const canSeeSignals = signedInFully && (state.me.role === 'ADMIN' || state.me.access.allowed);
  useEffect(() => {
    if (canSeeSignals) void syncPushToken().catch(() => undefined);
  }, [canSeeSignals]);

  // The first-use tour, once, after the first full sign-in. A notification being opened goes first, and it
  // waits until the subscriber's tabs are on screen: pushed during a redirect it would be replaced at once.
  // Remembered per person, so someone signing in after another on the same phone still gets their tour.
  const touredFor = useRef<string | null>(null);
  const onTabs = segments[0] === '(subscriber)';
  useEffect(() => {
    if (!settled || !onTabs || pending || !me || me.role !== 'SUBSCRIBER' || !me.access.allowed) return;
    if (me.onboardedAt || touredFor.current === me.id) return;
    // A moment's wait lets a screen that navigates on success (setting a password) finish first; if the
    // route changes again meanwhile, this is cancelled and scheduled afresh.
    const timer = setTimeout(() => {
      touredFor.current = me.id;
      router.push('/onboarding' as never);
    }, 900);
    return () => clearTimeout(timer);
  }, [me, onTabs, pending, router, settled]);

  return (
    <NavigationThemeProvider value={navigation}>
      <RealtimeProvider enabled={canSeeSignals}>
        <StatusBar style={colors.scheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerShadowVisible: false,
            headerBackButtonDisplayMode: 'minimal',
            headerTitleStyle: { fontWeight: '600', fontSize: 17 },
            contentStyle: { backgroundColor: colors.bg },
            animation: 'default',
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false, animation: 'none' }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false, animation: 'fade' }} />
          <Stack.Screen name="(subscriber)" options={{ headerShown: false, animation: 'fade' }} />
          <Stack.Screen name="(admin)" options={{ headerShown: false, animation: 'fade' }} />
          <Stack.Screen name="access-ended" options={{ headerShown: false, animation: 'fade' }} />
          <Stack.Screen name="compose" options={{ presentation: 'fullScreenModal', headerShown: false }} />
          <Stack.Screen name="disclosures" options={{ title: 'Risk and privacy' }} />
          <Stack.Screen name="trades/[id]" options={{ title: '' }} />
          <Stack.Screen name="admin/trades/[id]" options={{ title: '' }} />
          <Stack.Screen name="admin/subscribers/[id]" options={{ title: '' }} />
          <Stack.Screen name="admin/subscribers/new" options={{ title: 'New subscriber', presentation: 'modal' }} />
          <Stack.Screen name="admin/announcement" options={{ title: 'Announcement', presentation: 'modal' }} />
          <Stack.Screen name="admin/performance" options={{ title: 'Performance' }} />
          <Stack.Screen name="admin/health" options={{ title: 'Notification health' }} />
          <Stack.Screen name="admin/account" options={{ title: 'Account' }} />
          <Stack.Screen name="admin/drafts" options={{ title: 'Drafts', presentation: 'modal' }} />
          <Stack.Screen name="admin/instruments" options={{ title: 'Instruments' }} />
          <Stack.Screen name="admin/instrument" options={{ title: 'Instrument', presentation: 'modal' }} />
          <Stack.Screen name="admin/announcements" options={{ title: 'Announcements' }} />
          <Stack.Screen name="admin/history" options={{ title: 'History' }} />
          <Stack.Screen
            name="onboarding"
            options={{ presentation: 'fullScreenModal', headerShown: false, animation: 'fade' }}
          />
        </Stack>
        <NotificationBridge onOpen={setPending} />
        <LiveAlerts adminLink={me?.role === 'ADMIN'} />
        {API.problem && <Blocking title="This build cannot start" body={API.problem} />}
        {!API.problem && (state.phase === 'loading' || state.phase === 'starting') && <Starting />}
        {!API.problem && state.phase === 'unreachable' && <Unreachable />}
      </RealtimeProvider>
    </NavigationThemeProvider>
  );
}

/** Pushes that arrive while the app is open join the same in-app banner as live events. */
function NotificationBridge({ onOpen }: { onOpen: (path: string) => void }) {
  const { pushArrived } = useRealtime();
  const arrived = useRef(pushArrived);
  arrived.current = pushArrived;
  useEffect(() => listenForNotifications(onOpen, (arrival) => arrived.current(arrival)), [onOpen]);
  return null;
}

/**
 * One banner per alert while the app is open, below the status bar and notch. It disappears by itself,
 * never blocks navigation, and tapping it opens the trade.
 */
function LiveAlerts({ adminLink }: { adminLink: boolean }) {
  const { latest, clearLatest } = useRealtime();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const here = useRef(pathname);
  here.current = pathname;
  useEffect(() => {
    if (!latest) return;
    clearLatest();
    // No alert about what is already on screen, or about what this person has just done here.
    const onThisTrade =
      latest.tradeId !== null &&
      (here.current === `/trades/${latest.tradeId}` || here.current === `/admin/trades/${latest.tradeId}`);
    if (here.current === '/compose' || here.current === '/onboarding') return;
    // On Signals the new card is the alert, and on Alerts the new row is. Priority still interrupts.
    if ((here.current === '/feed' || here.current === '/alerts' || onThisTrade) && latest.priority !== 'PRIORITY')
      return;
    const isNew = latest.category === 'NEW_SIGNAL';
    const tradeId = latest.tradeId;
    toast({
      title: latest.title,
      body: latest.body,
      tone:
        latest.priority === 'PRIORITY'
          ? 'warning'
          : isNew && latest.direction
            ? latest.direction === 'BUY'
              ? 'buy'
              : 'sell'
            : 'info',
      duration: latest.priority === 'PRIORITY' ? 10_000 : 5000,
      onPress: tradeId
        ? () => router.push((adminLink ? `/admin/trades/${tradeId}` : `/trades/${tradeId}`) as never)
        : undefined,
    });
  }, [adminLink, clearLatest, latest, router, toast]);
  return null;
}

function Cover({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return <View style={[StyleSheet.absoluteFill, styles.cover, { backgroundColor: c.bg }]}>{children}</View>;
}

function Starting() {
  return (
    <Cover>
      <Logo size={56} />
      <View style={{ alignSelf: 'stretch' }}>
        <Loading rows={2} label="Loading your account" />
      </View>
    </Cover>
  );
}

function Blocking({ title, body }: { title: string; body: string }) {
  return (
    <Cover>
      <EmptyState icon="construct-outline" title={title}>
        {body}
      </EmptyState>
    </Cover>
  );
}

function Unreachable() {
  const { retry, signOut } = useSession();
  return (
    <Cover>
      <EmptyState icon="cloud-offline-outline" title="Cannot reach the server">
        Check your connection. Your account and signals are safe, and nothing was changed.
      </EmptyState>
      <Button label="Try again" variant="primary" icon="refresh" onPress={retry} testID="retry" />
      <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
      {__DEV__ && (
        <T v="caption" c="subtle" center>
          {API.origin}
        </T>
      )}
    </Cover>
  );
}

const styles = StyleSheet.create({
  cover: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    gap: space.xl,
    zIndex: 50,
    elevation: 50,
  },
});
