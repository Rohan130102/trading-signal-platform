import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/** The session token never syncs to a backup or moves to another phone. */
const SECURE = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

const TOKEN_KEY = 'session-token';
const PUSH_TOKEN_KEY = 'push-token';
const COMPOSER_KEY = 'composer';

export const secure = {
  getToken: () => SecureStore.getItemAsync(TOKEN_KEY, SECURE).catch(() => null),
  setToken: (value: string) => SecureStore.setItemAsync(TOKEN_KEY, value, SECURE),
  getPushToken: () => SecureStore.getItemAsync(PUSH_TOKEN_KEY, SECURE).catch(() => null),
  setPushToken: (value: string) => SecureStore.setItemAsync(PUSH_TOKEN_KEY, value, SECURE),
  /** An unpublished signal is sensitive, so work in progress is kept here too. */
  getComposer: () => SecureStore.getItemAsync(COMPOSER_KEY, SECURE).catch(() => null),
  setComposer: (value: string | null) =>
    value === null
      ? SecureStore.deleteItemAsync(COMPOSER_KEY, SECURE).catch(() => undefined)
      : SecureStore.setItemAsync(COMPOSER_KEY, value, SECURE).catch(() => undefined),
  /** Everything tied to the person signing out. */
  async clearSession(): Promise<void> {
    await Promise.all(
      [TOKEN_KEY, PUSH_TOKEN_KEY, COMPOSER_KEY].map((key) =>
        SecureStore.deleteItemAsync(key, SECURE).catch(() => undefined),
      ),
    );
  },
};

/** Conveniences only. If this fails the app still works, it just forgets a preference. */
export const prefs = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await AsyncStorage.getItem(`sd-${key}`);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  async set(key: string, value: unknown): Promise<void> {
    try {
      await AsyncStorage.setItem(`sd-${key}`, JSON.stringify(value));
    } catch {
      // See above.
    }
  },
};
