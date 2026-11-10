import type { FeedEvent, MeResponse, SignalCard as Card } from '@signaldesk/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { Platform, Pressable, Text, Vibration } from 'react-native';
import OnboardingScreen from '../app/onboarding';
import { LiveAlertBanner, UPDATE_BANNER_MS } from '@/alerts/LiveAlertBanner';
import { FilterBar } from '@/filters';
import { ALERT_PATTERNS, haptics, setHapticsEnabled } from '@/lib/haptics';
import { alertWeight, type LiveAlert } from '@/lib/realtime';
import { gateRedirect } from '@/lib/routing';
import { ProtectedScreen } from '@/security/Protected';
import { SignalCard } from '@/trade/SignalCard';
import { ThemeProvider } from '@/theme';
import { ToastProvider, useToast } from '@/ui';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = {};
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/lib/config', () => ({ API: { origin: 'https://api.test', problem: null }, IN_EXPO_GO: true }));
jest.mock('@/lib/api', () => ({
  api: { get: jest.fn(), post: jest.fn(async () => ({})), put: jest.fn(), delete: jest.fn() },
  queryString: () => '',
}));
const mockApi = (jest.requireMock('@/lib/api') as { api: { post: jest.Mock } }).api;
jest.mock('expo-screen-capture', () => ({
  usePreventScreenCapture: jest.fn(),
  enableAppSwitcherProtectionAsync: jest.fn(async () => undefined),
  addScreenshotListener: jest.fn(() => ({ remove: jest.fn() })),
}));
let mockMe: Partial<MeResponse> | null = null;
jest.mock('@/lib/session', () => ({ useSession: () => ({ me: mockMe }) }));
jest.mock('@/lib/push', () => ({
  readPushStatus: jest.fn(async () => 'needs-real-build'),
  enablePush: jest.fn(async () => 'on'),
}));

const wrap = (node: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ThemeProvider>
        <ToastProvider>{node}</ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );

const update = (seq: number, overrides: Partial<FeedEvent> = {}): FeedEvent => ({
  seq,
  id: `e${seq}`,
  tradeId: 't1',
  tradeVersion: seq,
  type: 'STOP_MOVED',
  category: 'UPDATE',
  tone: 'UPDATE',
  priority: 'NORMAL',
  title: `Update ${seq}`,
  body: '',
  tradeStatus: 'ACTIVE',
  createdAt: new Date().toISOString(),
  payload: { symbol: 'XAU/USD', pricePrecision: 2, previousStop: '3100', newStop: '3150', stopKind: 'MANUAL' },
  ...overrides,
});

const card: Card = {
  id: 't1',
  ref: 'T-7',
  symbol: 'XAU/USD',
  displayName: 'Gold',
  pricePrecision: 2,
  quoteCurrency: 'USD',
  unitLabel: 'oz',
  pointSize: '1',
  direction: 'SELL',
  entryType: 'SINGLE',
  entryLow: '3300',
  entryHigh: '3300',
  stopLoss: '3150',
  originalStopLoss: '3100',
  targets: [{ index: 1, price: '3200', status: 'OPEN' } as Card['targets'][number]],
  status: 'ACTIVE',
  priority: 'NORMAL',
  closedFraction: '0',
  version: 4,
  publishedAt: new Date().toISOString(),
  activatedAt: null,
  closedAt: null,
  entryExpiresAt: null,
  commentary: null,
  lastEventAt: null,
  lastEventTitle: null,
  updatesCount: 6,
  recentUpdates: [
    update(9),
    update(8, { type: 'TARGETS_MODIFIED', title: 'Targets changed' }),
    update(7, { title: 'Activated', type: 'ENTRY_ACTIVATED' }),
  ],
  unread: true,
  activitySeq: 9,
  outcome: null,
};

describe('a grouped signal card', () => {
  it('shows direction, instrument, status, current levels and the latest change first', async () => {
    await wrap(<SignalCard card={card} onMenu={jest.fn()} />);
    expect(screen.getByText('SELL')).toBeTruthy();
    expect(screen.getByText('XAU/USD')).toBeTruthy();
    expect(screen.getByTestId('latest-update')).toBeTruthy();
    // Once as the current stop-loss, once as what it was moved to.
    expect(screen.getAllByText('3,150.00').length).toBe(2);
    expect(screen.getByText('3,100.00')).toBeTruthy();
    expect(screen.getByTestId('unread-dot')).toBeTruthy();
    expect(screen.queryByText('Targets changed')).toBeNull();
  });

  it('folds earlier updates away until asked, and points to the full timeline', async () => {
    await wrap(<SignalCard card={card} onMenu={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('signal-expand-T-7'));
    expect(screen.getByText('Targets changed')).toBeTruthy();
    expect(screen.getByText('Activated')).toBeTruthy();
    expect(screen.getByText('Open the trade to see all 6 updates.')).toBeTruthy();
  });

  it('opens the trade on tap and the menu from its own 44-point button', async () => {
    const onMenu = jest.fn();
    await wrap(<SignalCard card={card} onMenu={onMenu} />);
    await fireEvent.press(screen.getByTestId('signal-T-7'));
    expect(mockPush).toHaveBeenCalledWith('/trades/t1');
    const menu = screen.getByTestId('signal-menu-T-7');
    await fireEvent.press(menu);
    expect(onMenu).toHaveBeenCalledWith(card);
  });

  it('shows nothing extra for a trade with no updates yet', async () => {
    await wrap(<SignalCard card={{ ...card, recentUpdates: [], updatesCount: 0 }} onMenu={jest.fn()} />);
    expect(screen.queryByTestId('latest-update')).toBeNull();
    expect(screen.queryByText(/No updates yet/)).toBeNull();
    expect(screen.getByTestId('card-stop').props.accessibilityLabel).toBe('Stop-loss (now): 3,150.00');
    expect(screen.getByTestId('card-targets').props.accessibilityLabel).toBe('Target 1 3,200.00');
  });

  it('outlines a signal that just arrived and labels it New', async () => {
    await wrap(<SignalCard card={card} onMenu={jest.fn()} fresh />);
    expect(screen.getByTestId('fresh-badge')).toBeTruthy();
    expect(screen.queryByTestId('unread-dot')).toBeNull();
  });
});

describe('the filter bar', () => {
  const instruments = [
    { symbol: 'XAU/USD', displayName: 'Gold', assetClass: 'COMMODITY', exchange: null, archived: false },
    { symbol: 'BTC/USD', displayName: 'Bitcoin', assetClass: 'CRYPTO', exchange: null, archived: false },
  ];

  it('says what is on, and each chip removes its own filter', async () => {
    const onChange = jest.fn();
    await wrap(
      <FilterBar
        value={{ symbols: ['XAU/USD', 'BTC/USD'], direction: 'SELL', status: 'OPEN' }}
        onChange={onChange}
        instruments={instruments}
      />,
    );
    expect(screen.getByText('2 instruments')).toBeTruthy();
    expect(screen.getByLabelText('Filters, 3 on')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Sell'));
    expect(onChange).toHaveBeenCalledWith({ symbols: ['XAU/USD', 'BTC/USD'], direction: null, status: 'OPEN' });
  });

  it('opens a searchable instrument list with a clear selected state', async () => {
    const onChange = jest.fn();
    await wrap(
      <FilterBar
        value={{ symbols: [], direction: null, status: 'ALL' }}
        onChange={onChange}
        instruments={instruments}
      />,
    );
    expect(screen.getByText('All instruments')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('instrument-button'));
    await fireEvent.changeText(screen.getByTestId('instrument-search'), 'bit');
    expect(screen.queryByTestId('instrument-XAU/USD')).toBeNull();
    await fireEvent.press(screen.getByTestId('instrument-BTC/USD'));
    expect(screen.getByTestId('instrument-BTC/USD').props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.changeText(screen.getByTestId('instrument-search'), 'zzz');
    expect(screen.getByText('No instrument matches “zzz”.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('instrument-apply'));
    expect(onChange).toHaveBeenCalledWith({ symbols: ['BTC/USD'], direction: null, status: 'ALL' });
  });
});

describe('screen protection', () => {
  it('blocks capture on a subscriber screen without drawing anything over it', async () => {
    const capture = jest.requireMock('expo-screen-capture') as { usePreventScreenCapture: jest.Mock };
    capture.usePreventScreenCapture.mockClear();
    mockMe = { role: 'SUBSCRIBER', loginId: 'jane.doe' };
    await wrap(
      <ProtectedScreen id="feed" screen="feed">
        <Text>Signals</Text>
      </ProtectedScreen>,
    );
    expect(capture.usePreventScreenCapture).toHaveBeenCalledWith('feed');
    expect(screen.getByText('Signals')).toBeTruthy();
    expect(screen.queryByTestId('watermark', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryAllByText(/jane\.doe|SignalDesk/, { includeHiddenElements: true })).toHaveLength(0);
  });
});

describe('the in-app alert', () => {
  const alert = (overrides: Partial<LiveAlert> = {}): LiveAlert => ({
    eventId: 'e1',
    title: 'BUY XAU/USD',
    body: 'Entry 3,300.00, stop-loss 3,150.00',
    tradeId: 't1',
    category: 'NEW_SIGNAL',
    priority: 'NORMAL',
    direction: 'BUY',
    ...overrides,
  });

  afterEach(() => jest.useRealTimers());

  it('keeps a new signal on screen until it is opened or dismissed', async () => {
    jest.useFakeTimers();
    const onOpen = jest.fn();
    const onDismiss = jest.fn();
    await wrap(
      <LiveAlertBanner
        shown={{ key: 1, alert: alert(), more: 0, sticky: true, important: true }}
        onOpen={onOpen}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText('New signal')).toBeTruthy();
    expect(screen.getByText('BUY XAU/USD')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(UPDATE_BANNER_MS * 3);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('live-alert-open'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('live-alert-close'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('lets an ordinary update go by itself, and offers the others that arrived', async () => {
    jest.useFakeTimers();
    const onDismiss = jest.fn();
    const onSeeAll = jest.fn();
    await wrap(
      <LiveAlertBanner
        shown={{
          key: 2,
          alert: alert({ category: 'UPDATE', title: 'Stop-loss moved', direction: null }),
          more: 2,
          sticky: false,
          important: false,
        }}
        onOpen={jest.fn()}
        onDismiss={onDismiss}
        onSeeAll={onSeeAll}
      />,
    );
    expect(screen.getByText('Signal update')).toBeTruthy();
    expect(screen.getByText('View trade')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('live-alert-more'));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(UPDATE_BANNER_MS + 1000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('weighs a new signal and a priority alert above an update', () => {
    expect(alertWeight({ category: 'NEW_SIGNAL', priority: 'NORMAL' })).toBe('signal');
    expect(alertWeight({ category: 'UPDATE', priority: 'PRIORITY' })).toBe('priority');
    expect(alertWeight({ category: 'CLOSURE', priority: 'NORMAL' })).toBe('update');
  });

  it('vibrates in a pattern per kind on Android, and not at all when haptics are off', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    const vibrate = jest.spyOn(Vibration, 'vibrate').mockImplementation(() => undefined);
    haptics.alert('signal');
    expect(vibrate).toHaveBeenLastCalledWith([...ALERT_PATTERNS.signal]);
    haptics.alert('priority');
    expect(vibrate).toHaveBeenLastCalledWith([...ALERT_PATTERNS.priority]);
    await setHapticsEnabled(false);
    vibrate.mockClear();
    haptics.alert('signal');
    expect(vibrate).not.toHaveBeenCalled();
    await setHapticsEnabled(true);
    vibrate.mockRestore();
    os.restore();
  });
});

describe('the first-use tour', () => {
  const Tour = () => <OnboardingScreen />;

  beforeEach(() => {
    mockApi.post.mockClear();
    mockBack.mockClear();
  });

  it('walks through five steps and records completion once', async () => {
    mockParams = {};
    await wrap(<Tour />);
    expect(screen.getByText('Welcome to SignalDesk')).toBeTruthy();
    for (const title of ['Reading a signal', 'Updates stay with their trade', 'Alerts', 'Your list, your way']) {
      await fireEvent.press(screen.getByTestId('tour-next'));
      expect(screen.getByText(title)).toBeTruthy();
    }
    await fireEvent.press(screen.getByTestId('tour-done'));
    expect(mockApi.post).toHaveBeenCalledTimes(1);
    expect(mockApi.post).toHaveBeenCalledWith('/me/onboarding');
    expect(mockBack).toHaveBeenCalled();
  });

  it('lets someone skip at once, and a replay records nothing', async () => {
    mockParams = { replay: '1' };
    await wrap(<Tour />);
    await fireEvent.press(screen.getByTestId('tour-skip'));
    expect(mockApi.post).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalled();
  });
});

describe('small pieces', () => {
  it('lets the tour through the route guard for subscribers only', () => {
    const me = { role: 'SUBSCRIBER', next: null, access: { allowed: true, reason: null } } as unknown as MeResponse;
    expect(gateRedirect({ phase: 'signed-in', me }, ['onboarding'])).toBeNull();
    expect(gateRedirect({ phase: 'signed-in', me: { ...me, role: 'ADMIN' } }, ['onboarding'])).toBe('/dashboard');
  });

  it('switches haptics off everywhere at once', async () => {
    await setHapticsEnabled(false);
    jest.mocked(Haptics.selectionAsync).mockClear();
    jest.mocked(Haptics.notificationAsync).mockClear();
    haptics.selection();
    haptics.notify('success');
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    await setHapticsEnabled(true);
    haptics.selection();
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it('offers Undo on a banner, and Undo closes it', async () => {
    const undo = jest.fn();
    function Show() {
      const toast = useToast();
      return (
        <ShowButton
          onPress={() => toast({ title: 'Hidden', tone: 'info', action: { label: 'Undo', onPress: undo } })}
        />
      );
    }
    await wrap(<Show />);
    await fireEvent.press(screen.getByTestId('show'));
    await fireEvent.press(screen.getByTestId('toast-action'));
    expect(undo).toHaveBeenCalledTimes(1);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('identifies an Android installation by a hash, never the raw identifier', async () => {
    jest.resetModules();
    jest.doMock('expo-application', () => ({
      getAndroidId: () => 'raw-android-id',
      applicationId: 'com.signaldesk.app',
    }));
    jest.doMock('expo-crypto', () => ({
      CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
      digestStringAsync: jest.fn(async (_a: string, value: string) =>
        `digest-of-${value.length}-chars-`.padEnd(64, 'f'),
      ),
      randomUUID: () => '11111111-2222-4333-8444-555555555555',
    }));
    jest.replaceProperty(Platform, 'OS', 'android');
    // A fresh copy of the module, so its cached identifier and the mocks above both start clean.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { installationId } = require('@/lib/installation') as typeof import('@/lib/installation');
    const id = await installationId();
    expect(id).toMatch(/^a-[A-Za-z0-9-]{20,}$/);
    expect(id).not.toContain('raw-android-id');
    expect(await installationId()).toBe(id);
  });
});

function ShowButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable testID="show" onPress={onPress}>
      <Text>Show</Text>
    </Pressable>
  );
}
