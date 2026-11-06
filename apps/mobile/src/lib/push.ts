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

/** While a live connection is delivering, the feed already shows the event, so skip the system banner. */
let liveConnected = false;
export function setLiveConnected(value: boolean): void {
  liveConnected = value;
}

/** Runs once at startup. A tap on a notification may be what launched the app. */
export function listenForNotifications(open: (path: string) => void): () => void {
  const N = notifications();
  if (!N) return () => undefined;
  N.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: !liveConnected,
      shouldShowList: true,
      shouldPlaySound: !liveConnected,
      shouldSetBadge: false,
    }),
  });
  void setUpAndroidChannels().catch(() => undefined);
  const route = (data: Record<string, unknown> | undefined) => {
    const path = data?.path;
    if (isSafeDeepLink(path)) open(path);
  };
  void N.getLastNotificationResponseAsync().then((response) => {
    if (response) route(response.notification.request.content.data);
  });
  const tapped = N.addNotificationResponseReceivedListener((response) => {
    route(response.notification.request.content.data);
  });
  const rotated = N.addPushTokenListener(() => void syncPushToken().catch(() => undefined));
  return () => {
    tapped.remove();
    rotated.remove();
  };
}
