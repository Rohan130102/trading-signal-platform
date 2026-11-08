import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * The identifier this installation signs in with, so the server can keep one subscriber per phone.
 *
 * Android: derived from the platform's per-app device identifier, which survives clearing the app's data
 * and reinstalling (it resets on a factory reset). It is hashed, so the raw value never leaves the phone.
 * iPhone: a random value kept in the Keychain on this device only. It survives reinstalling, does not move
 * to a new phone through a backup, and resets if the phone is erased.
 *
 * None of this is a hardware identity, and the server never treats it as proof of one.
 */

const KEY = 'installation-id';
const OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
let cached: Promise<string> | null = null;

async function derive(): Promise<string> {
  if (Platform.OS === 'android') {
    const androidId = Application.getAndroidId();
    if (androidId) {
      const digest = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        `signaldesk:${Application.applicationId ?? ''}:${androidId}`,
      );
      return `a-${digest.slice(0, 48)}`;
    }
  }
  const stored = await SecureStore.getItemAsync(KEY, OPTIONS).catch(() => null);
  if (stored) return stored;
  const created = `${Platform.OS === 'ios' ? 'i' : 'x'}-${Crypto.randomUUID().replace(/-/g, '')}`;
  await SecureStore.setItemAsync(KEY, created, OPTIONS);
  return created;
}

export function installationId(): Promise<string> {
  cached ??= derive().catch((error) => {
    cached = null;
    throw error;
  });
  return cached;
}
