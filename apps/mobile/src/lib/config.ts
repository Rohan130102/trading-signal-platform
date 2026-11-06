import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';

export const VARIANT = String(Constants.expoConfig?.extra?.variant ?? 'development');
export const APP_VERSION = Constants.expoConfig?.version ?? '';
/** Expo Go is a development shell. It cannot receive remote notifications. */
export const IN_EXPO_GO = isRunningInExpoGo();

function fromDevServer(): string | null {
  // Whatever address reached the development server also reaches this computer's API.
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host ? `http://${host}:4000` : null;
}

export interface ApiConfig {
  origin: string | null;
  /** Why the app cannot start. Shown rather than failing later with a vague network error. */
  problem: string | null;
}

export function resolveApiConfig(
  configured: string | undefined = process.env.EXPO_PUBLIC_API_URL,
  variant: string = VARIANT,
  fallback: string | null = fromDevServer(),
): ApiConfig {
  const value = (configured ?? '').trim().replace(/\/+$/, '') || (variant === 'development' ? fallback : null);
  if (!value) {
    return { origin: null, problem: 'This build has no server address. Set EXPO_PUBLIC_API_URL when building it.' };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { origin: null, problem: 'This build has an invalid server address.' };
  }
  if (variant !== 'development' && url.protocol !== 'https:') {
    return { origin: null, problem: 'This build must use a secure (HTTPS) server address.' };
  }
  return { origin: value, problem: null };
}

export const API = resolveApiConfig();

export function socketUrl(origin: string): string {
  return `${origin.replace(/^http/, 'ws')}/ws`;
}
