import { ANDROID_CHANNELS, isSafeDeepLink, type PushConfig } from '@signaldesk/domain';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Linking, Platform } from 'react-native';
import { api } from './api';
import { IN_EXPO_GO } from './config';
import { prefs, secure } from './storage';

export type PushStatus =
  /** Ready to ask for permission. */
  | 'ready'
  | 'on'
  | 'denied'
  /** Expo Go, or a simulator. A development build on a real phone is required. */
  | 'needs-real-build'
  /** This build has no Expo project id, so no token can be issued. */
  | 'not-configured'
  /** The server cannot send to native devices. */
  | 'server-off'
  | 'checking';

type NotificationsModule = typeof import('expo-notifications');

/** Loaded on demand: importing this inside Expo Go reports an error, because Expo Go has no remote push. */
function notifications(): NotificationsModule | null {
  if (IN_EXPO_GO) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-notifications') as NotificationsModule;
}

const OPTED_OUT = 'push-opted-out';

function projectId(): string | undefined {
  return (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId;
}

export async function setUpAndroidChannels(): Promise<void> {
  const N = notifications();
  if (!N || Platform.OS !== 'android') return;
  await Promise.all(
    ANDROID_CHANNELS.map((channel) =>
      N.setNotificationChannelAsync(channel.id, {
        name: channel.name,
        importance: {
          max: N.AndroidImportance.MAX,
          high: N.AndroidImportance.HIGH,
          default: N.AndroidImportance.DEFAULT,
        }[channel.importance],
        vibrationPattern: channel.importance === 'default' ? [0, 120] : [0, 200, 120, 200],
        // Hidden on a locked screen until unlocked: these can contain paid signal details.
        lockscreenVisibility: N.AndroidNotificationVisibility.PRIVATE,
      }),
    ),
  );
}

export async function readPushStatus(): Promise<PushStatus> {
  const N = notifications();
  if (!N || !Device.isDevice) return 'needs-real-build';
  if (!projectId()) return 'not-configured';
  const config = await api.get<PushConfig>('/push/config');
  if (!config.nativeAvailable) return 'server-off';
  const { status } = await N.getPermissionsAsync();
  if (status === 'denied') return 'denied';
  if (status !== 'granted') return 'ready';
  return (await secure.getPushToken()) ? 'on' : 'ready';
}

async function sendTokenToServer(token: string): Promise<void> {
  await api.post('/push/devices', {
    token,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    deviceLabel: [Device.modelName, Platform.OS === 'ios' ? 'iOS' : 'Android'].filter(Boolean).join(', '),
  });
  await secure.setPushToken(token);
}

/** Asks only when the person chose to, and returns where that left things. */
export async function enablePush(): Promise<PushStatus> {
  const N = notifications();
  if (!N || !Device.isDevice) return 'needs-real-build';
  const id = projectId();
  if (!id) return 'not-configured';
  await setUpAndroidChannels();
  const current = await N.getPermissionsAsync();
  const asked = current.status === 'granted' ? current : await N.requestPermissionsAsync();
  if (asked.status !== 'granted') return 'denied';
  await prefs.set(OPTED_OUT, false);
  const { data } = await N.getExpoPushTokenAsync({ projectId: id });
  await sendTokenToServer(data);
  return 'on';
}

/**
 * Runs on every start and sign-in. Tokens can change, and a session that ended takes its device
 * registration with it, so without this a person would silently stop getting alerts. It respects both
 * the phone's permission and a choice to turn alerts off here. Repeating it is safe.
 */
export async function syncPushToken(): Promise<void> {
  const N = notifications();
  const id = projectId();
  if (!N || !Device.isDevice || !id) return;
  if (await prefs.get<boolean>(OPTED_OUT)) return;
  const { status } = await N.getPermissionsAsync();
  if (status !== 'granted') return;
  const { data } = await N.getExpoPushTokenAsync({ projectId: id });
  await sendTokenToServer(data);
}

/** Runs before signing out, while the session can still prove who is asking. */
export async function unregisterThisDevice(): Promise<void> {
  const token = await secure.getPushToken();
  if (token) await api.delete('/push/devices', { token }).catch(() => undefined);
}

export async function disablePush(): Promise<void> {
  await prefs.set(OPTED_OUT, true);
  await unregisterThisDevice();
  await secure.setPushToken('');
}

export function openSystemSettings(): void {
  void Linking.openSettings();
}

/** What a notification carries for the app, as the server sends it. Every field is checked before use. */
export interface PushArrival {
  eventId: string;
  title: string;
  body: string;
  path: string | null;
  tradeId: string | null;
  seq: number | null;
  category: string | null;
  priority: 'NORMAL' | 'PRIORITY';
}

function readArrival(content: {
  title?: string | null;
  body?: string | null;
  data?: Record<string, unknown> | null;
}): PushArrival | null {
  const data = content.data ?? {};
  const eventId = typeof data.eventId === 'string' ? data.eventId : null;
  if (!eventId) return null;
  return {
    eventId,
    title: content.title ?? '',
    body: content.body ?? '',
    path: isSafeDeepLink(data.path) ? data.path : null,
    tradeId: typeof data.tradeId === 'string' ? data.tradeId : null,
    seq: typeof data.seq === 'number' ? data.seq : null,
    category: typeof data.category === 'string' ? data.category : null,
    priority: data.priority === 'PRIORITY' ? 'PRIORITY' : 'NORMAL',
  };
}

/** Matches the app icon to the unread count. Does nothing where badges are unavailable. */
export function setAppBadge(count: number): void {
  const N = notifications();
  if (!N) return;
  void N.setBadgeCountAsync(Math.max(0, Math.min(99, count))).catch(() => undefined);
}

/**
 * Runs once at startup. A tap on a notification may be what launched the app, before anything else has
 * loaded: the path is held until the person is signed in (see the root layout), and the trade is always
 * fetched fresh on arrival, so an old notification can never show old levels as current.
 *
 * While the app is open, the system banner is not shown: the app shows its own, once, whether the
 * event came over the live connection or as a push (see RealtimeProvider).
 */
export function listenForNotifications(
  open: (path: string) => void,
  onForeground: (arrival: PushArrival) => void,
): () => void {
  const N = notifications();
  if (!N) return () => undefined;
  N.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  void setUpAndroidChannels().catch(() => undefined);
  const tappedOnce = new Set<string>();
  const handleTap = (response: { notification: { request: { content: Parameters<typeof readArrival>[0] } } }) => {
    const arrival = readArrival(response.notification.request.content);
    const path = arrival?.path ?? response.notification.request.content.data?.path;
    if (isSafeDeepLink(path)) open(path);
    if (arrival && !tappedOnce.has(arrival.eventId)) {
      tappedOnce.add(arrival.eventId);
      // The one delivery signal a phone can give. Fails quietly if the session is not ready yet.
      void api.post('/push/opened', { eventId: arrival.eventId }).catch(() => undefined);
    }
  };
  void N.getLastNotificationResponseAsync().then((response) => {
    if (response) handleTap(response);
  });
  const tapped = N.addNotificationResponseReceivedListener(handleTap);
  const received = N.addNotificationReceivedListener((notification) => {
    const arrival = readArrival(notification.request.content);
    if (arrival) onForeground(arrival);
  });
  const rotated = N.addPushTokenListener(() => void syncPushToken().catch(() => undefined));
  return () => {
    tapped.remove();
    received.remove();
    rotated.remove();
  };
}
