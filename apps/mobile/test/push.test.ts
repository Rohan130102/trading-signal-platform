import {
  disablePush,
  enablePush,
  listenForNotifications,
  readPushStatus,
  setAppBadge,
  syncPushToken,
  unregisterThisDevice,
} from '@/lib/push';

// A real notification cannot reach an emulator here, so the app's decisions are tested against the
// library's documented interface. The server's side of this is tested for real in apps/api/test/mobile.test.ts.
const mockN = {
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  setNotificationHandler: jest.fn(),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  setBadgeCountAsync: jest.fn(async () => true),
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
};
jest.mock('expo-notifications', () => mockN);

const mockDevice = { isDevice: true, modelName: 'Test Phone', osVersion: '17' };
jest.mock('expo-device', () => ({
  get isDevice() {
    return mockDevice.isDevice;
  },
  get modelName() {
    return mockDevice.modelName;
  },
}));

const mockConstants = { expoConfig: { extra: { eas: { projectId: 'project-1' } } } as { extra: unknown } };
jest.mock('expo-constants', () => ({
  __esModule: true,
  get default() {
    return mockConstants;
  },
}));

const mockConfig = { IN_EXPO_GO: false };
jest.mock('@/lib/config', () => ({
  get IN_EXPO_GO() {
    return mockConfig.IN_EXPO_GO;
  },
}));

const mockApi = { get: jest.fn(), post: jest.fn(), delete: jest.fn() };
jest.mock('@/lib/api', () => ({
  get api() {
    return mockApi;
  },
}));

const mockStore = new Map<string, unknown>();
jest.mock('@/lib/storage', () => ({
  secure: {
    getPushToken: async () => (mockStore.get('token') as string | undefined) ?? null,
    setPushToken: async (value: string) => void mockStore.set('token', value),
  },
  prefs: {
    get: async (key: string) => mockStore.get(key) ?? null,
    set: async (key: string, value: unknown) => void mockStore.set(key, value),
  },
}));

const TOKEN = 'ExponentPushToken[abcdefgh12345678]';

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockConfig.IN_EXPO_GO = false;
  mockDevice.isDevice = true;
  mockConstants.expoConfig = { extra: { eas: { projectId: 'project-1' } } };
  mockApi.get.mockResolvedValue({ nativeAvailable: true });
  mockApi.post.mockResolvedValue({ id: 'device' });
  mockApi.delete.mockResolvedValue({ ok: true });
  mockN.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
  mockN.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
  mockN.getExpoPushTokenAsync.mockResolvedValue({ data: TOKEN });
});

describe('where notifications stand on this phone', () => {
  it('says plainly when they cannot work here, without touching the library', async () => {
    mockConfig.IN_EXPO_GO = true;
    expect(await readPushStatus()).toBe('needs-real-build');
    expect(await enablePush()).toBe('needs-real-build');
    expect(mockN.getPermissionsAsync).not.toHaveBeenCalled();
    mockConfig.IN_EXPO_GO = false;
    mockDevice.isDevice = false;
    expect(await readPushStatus()).toBe('needs-real-build');
  });

  it('says when the build has no notification project', async () => {
    mockConstants.expoConfig = { extra: {} };
    expect(await readPushStatus()).toBe('not-configured');
    expect(await enablePush()).toBe('not-configured');
  });

  it('says when the server is not sending', async () => {
    mockApi.get.mockResolvedValue({ nativeAvailable: false });
    expect(await readPushStatus()).toBe('server-off');
  });

  it('reflects the permission and whether this phone is registered', async () => {
    expect(await readPushStatus()).toBe('ready');
    mockN.getPermissionsAsync.mockResolvedValue({ status: 'denied' });
    expect(await readPushStatus()).toBe('denied');
    mockN.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    expect(await readPushStatus()).toBe('ready');
    mockStore.set('token', TOKEN);
    expect(await readPushStatus()).toBe('on');
  });
});

describe('turning notifications on', () => {
  it('asks, then registers the token', async () => {
    expect(await enablePush()).toBe('on');
    expect(mockN.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockApi.post).toHaveBeenCalledWith(
      '/push/devices',
      expect.objectContaining({ token: TOKEN, platform: 'ios' }),
    );
    expect(mockStore.get('token')).toBe(TOKEN);
  });

  it('does not ask again when already allowed', async () => {
    mockN.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    await enablePush();
    expect(mockN.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('respects a refusal, and sends nothing', async () => {
    mockN.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });
    expect(await enablePush()).toBe('denied');
    expect(mockN.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(mockApi.post).not.toHaveBeenCalled();
  });
});

describe('staying registered', () => {
  it('re-registers after a session ended, so alerts do not silently stop', async () => {
    mockN.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    await syncPushToken();
    expect(mockApi.post).toHaveBeenCalledWith('/push/devices', expect.objectContaining({ token: TOKEN }));
  });

  it('never asks for permission by itself', async () => {
    await syncPushToken();
    expect(mockN.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('respects a choice to turn alerts off, until turned on again', async () => {
    mockN.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockStore.set('token', TOKEN);
    await disablePush();
    expect(mockApi.delete).toHaveBeenCalledWith('/push/devices', { token: TOKEN });
    expect(await readPushStatus()).toBe('ready');
    await syncPushToken();
    expect(mockApi.post).not.toHaveBeenCalled();
    await enablePush();
    expect(mockApi.post).toHaveBeenCalledTimes(1);
    mockApi.post.mockClear();
    await syncPushToken();
    expect(mockApi.post).toHaveBeenCalledTimes(1);
  });

  it('signing out removes this device while the session can still prove who is asking', async () => {
    mockStore.set('token', TOKEN);
    await unregisterThisDevice();
    expect(mockApi.delete).toHaveBeenCalledWith('/push/devices', { token: TOKEN });
  });

  it('a failed removal does not stop signing out', async () => {
    mockStore.set('token', TOKEN);
    mockApi.delete.mockRejectedValue(new Error('offline'));
    await expect(unregisterThisDevice()).resolves.toBeUndefined();
  });
});

describe('tapping a notification', () => {
  const tap = async (data: unknown) => {
    const open = jest.fn();
    const stop = listenForNotifications(open, jest.fn());
    const handler = (
      mockN.addNotificationResponseReceivedListener.mock.calls as unknown as [[(r: unknown) => void]]
    )[0][0];
    handler({ notification: { request: { content: { data } } } });
    stop();
    return open;
  };
  const id = '8f14e45f-ceea-467f-a8f1-6f9d3b1c2a10';

  it('opens the trade', async () => {
    expect(await tap({ path: `/trades/${id}` })).toHaveBeenCalledWith(`/trades/${id}`);
  });

  it('ignores anything that is not a known place', async () => {
    for (const path of [
      'https://evil.example',
      '//evil.example',
      '/admin/subscribers',
      '/trades/../admin',
      7,
      undefined,
    ]) {
      expect(await tap({ path })).not.toHaveBeenCalled();
      jest.clearAllMocks();
      mockN.getLastNotificationResponseAsync.mockResolvedValue(null);
      mockN.addNotificationResponseReceivedListener.mockReturnValue({ remove: jest.fn() });
      mockN.addNotificationReceivedListener.mockReturnValue({ remove: jest.fn() });
      mockN.addPushTokenListener.mockReturnValue({ remove: jest.fn() });
    }
  });

  it('opens what launched the app, when a tap started it', async () => {
    mockN.getLastNotificationResponseAsync.mockResolvedValue({
      notification: { request: { content: { data: { path: '/feed' } } } },
    } as never);
    const open = jest.fn();
    const stop = listenForNotifications(open, jest.fn());
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop();
    expect(open).toHaveBeenCalledWith('/feed');
  });

  it('never shows the system banner while the app is open: the app shows its own, once', async () => {
    listenForNotifications(jest.fn(), jest.fn())();
    const [options] = mockN.setNotificationHandler.mock.calls[0] as unknown as [
      {
        handleNotification: () => Promise<{
          shouldShowBanner: boolean;
          shouldShowList: boolean;
          shouldPlaySound: boolean;
        }>;
      },
    ];
    const decision = await options.handleNotification();
    expect(decision.shouldShowBanner).toBe(false);
    expect(decision.shouldPlaySound).toBe(false);
    expect(decision.shouldShowList).toBe(true);
  });

  it('hands a push that arrives while open to the app, with only checked fields', async () => {
    const onForeground = jest.fn();
    const stop = listenForNotifications(jest.fn(), onForeground);
    const received = (mockN.addNotificationReceivedListener.mock.calls as unknown as [[(n: unknown) => void]])[0][0];
    received({
      request: {
        content: {
          title: 'Stop-loss moved',
          body: 'XAU/USD',
          data: { eventId: id, path: `/trades/${id}`, tradeId: id, seq: 42, category: 'UPDATE', priority: 'PRIORITY' },
        },
      },
    });
    received({ request: { content: { title: 'x', body: 'y', data: { path: 'https://evil.example' } } } });
    stop();
    expect(onForeground).toHaveBeenCalledTimes(1);
    expect(onForeground).toHaveBeenCalledWith({
      eventId: id,
      title: 'Stop-loss moved',
      body: 'XAU/USD',
      path: `/trades/${id}`,
      tradeId: id,
      seq: 42,
      category: 'UPDATE',
      priority: 'PRIORITY',
    });
  });

  it('reports an opened notification once, so the desk can see real opens', async () => {
    mockApi.post.mockResolvedValue({});
    const stop = listenForNotifications(jest.fn(), jest.fn());
    const handler = (
      mockN.addNotificationResponseReceivedListener.mock.calls as unknown as [[(r: unknown) => void]]
    )[0][0];
    const response = { notification: { request: { content: { data: { eventId: id, path: `/trades/${id}` } } } } };
    handler(response);
    handler(response);
    stop();
    expect(mockApi.post).toHaveBeenCalledTimes(1);
    expect(mockApi.post).toHaveBeenCalledWith('/push/opened', { eventId: id });
  });

  it('keeps the app icon badge within what the platforms show', () => {
    setAppBadge(250);
    setAppBadge(-3);
    expect(mockN.setBadgeCountAsync).toHaveBeenNthCalledWith(1, 99);
    expect(mockN.setBadgeCountAsync).toHaveBeenNthCalledWith(2, 0);
  });
});
