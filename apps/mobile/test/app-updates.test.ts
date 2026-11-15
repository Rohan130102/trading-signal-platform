import { act, renderHook } from '@testing-library/react-native';
import * as Updates from 'expo-updates';
import { AppState, type AppStateStatus } from 'react-native';
import { useUpdateChecks, useUpdateReady, versionLabel } from '@/lib/app-updates';

// The library's documented interface stands in for a release build here. The server's side is tested for real
// in apps/api/test/app-updates.test.ts, and an update reaching an installed APK is checked on an emulator.
jest.mock('expo-updates', () => ({
  __esModule: true,
  isEnabled: true,
  isEmbeddedLaunch: true,
  createdAt: null,
  useUpdates: jest.fn(() => ({ isUpdatePending: false })),
  checkForUpdateAsync: jest.fn(async () => ({ isAvailable: true })),
  fetchUpdateAsync: jest.fn(async () => ({ isNew: true })),
  reloadAsync: jest.fn(async () => undefined),
}));

/** The same module object the app code reads, so a test can change what it reports. */
const mockUpdates = Updates as unknown as {
  isEnabled: boolean;
  isEmbeddedLaunch: boolean;
  createdAt: Date | null;
  useUpdates: jest.Mock;
  checkForUpdateAsync: jest.Mock;
  fetchUpdateAsync: jest.Mock;
  reloadAsync: jest.Mock;
};

let changeListener: ((state: AppStateStatus) => void) | null = null;
const remove = jest.fn();
let now = Date.parse('2026-11-15T12:00:00Z');
const setTime = (iso: string) => {
  now = Date.parse(iso);
};

beforeEach(() => {
  setTime('2026-11-15T12:00:00Z');
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  mockUpdates.isEnabled = true;
  mockUpdates.isEmbeddedLaunch = true;
  mockUpdates.createdAt = null;
  mockUpdates.checkForUpdateAsync.mockClear();
  mockUpdates.fetchUpdateAsync.mockClear();
  mockUpdates.reloadAsync.mockClear();
  mockUpdates.useUpdates.mockReturnValue({ isUpdatePending: false });
  changeListener = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    changeListener = listener as (state: AppStateStatus) => void;
    return { remove };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function comeBack() {
  changeListener?.('active');
  // Let the background check and download settle.
  await new Promise<void>((r) => setImmediate(() => r()));
}

describe('looking for a new version', () => {
  it('asks again when the app comes back after half an hour, and downloads what it finds', async () => {
    await renderHook(() => useUpdateChecks());
    await comeBack();
    expect(mockUpdates.checkForUpdateAsync).not.toHaveBeenCalled();

    setTime('2026-11-15T12:31:00Z');
    await comeBack();
    expect(mockUpdates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
    expect(mockUpdates.fetchUpdateAsync).toHaveBeenCalledTimes(1);

    // Not again straight away.
    await comeBack();
    expect(mockUpdates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
  });

  it('downloads nothing when there is nothing new, and shrugs off a failed check', async () => {
    await renderHook(() => useUpdateChecks());
    mockUpdates.checkForUpdateAsync.mockResolvedValueOnce({ isAvailable: false });
    setTime('2026-11-15T13:00:00Z');
    await comeBack();
    expect(mockUpdates.fetchUpdateAsync).not.toHaveBeenCalled();

    mockUpdates.checkForUpdateAsync.mockRejectedValueOnce(new Error('offline'));
    setTime('2026-11-15T14:00:00Z');
    await comeBack();
    expect(mockUpdates.fetchUpdateAsync).not.toHaveBeenCalled();
  });

  it('does nothing in a build without updates', async () => {
    mockUpdates.isEnabled = false;
    await renderHook(() => useUpdateChecks());
    expect(changeListener).toBeNull();
  });
});

describe('a downloaded version', () => {
  it('is reported as ready, and restarting is the person’s choice', async () => {
    mockUpdates.useUpdates.mockReturnValue({ isUpdatePending: true });
    const { result } = await renderHook(() => useUpdateReady());
    expect(result.current.ready).toBe(true);
    expect(mockUpdates.reloadAsync).not.toHaveBeenCalled();
    await act(async () => result.current.restart());
    expect(mockUpdates.reloadAsync).toHaveBeenCalledTimes(1);
  });
});

describe('the version shown on the account screen', () => {
  it('is the APK’s own version until an update is running', () => {
    expect(versionLabel('1.0.0')).toBe('Version 1.0.0');
    mockUpdates.isEmbeddedLaunch = false;
    mockUpdates.createdAt = new Date('2026-11-15T18:00:00Z');
    expect(versionLabel('1.0.0')).toMatch(/^Version 1\.0\.0, updated \S/);
  });
});
