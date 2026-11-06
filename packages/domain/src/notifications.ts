import type { EventCategory, Priority } from './status.js';

/**
 * Android notification channels. The app creates them and the server names one per message, so a
 * subscriber can silence routine updates in system settings while still hearing new signals.
 */
export const ANDROID_CHANNELS = [
  { id: 'signals', name: 'New signals and urgent instructions', importance: 'max' },
  { id: 'updates', name: 'Trade updates', importance: 'high' },
  { id: 'announcements', name: 'Announcements', importance: 'default' },
] as const;

export type AndroidChannelId = (typeof ANDROID_CHANNELS)[number]['id'];

export function androidChannelFor(category: EventCategory, priority: Priority): AndroidChannelId {
  if (priority === 'PRIORITY' || category === 'NEW_SIGNAL') return 'signals';
  return category === 'ANNOUNCEMENT' ? 'announcements' : 'updates';
}

/** Where tapping a notification should land inside the native app. */
export function mobileDeepLinkPath(tradeId: string | null): string {
  return tradeId ? `/trades/${tradeId}` : '/feed';
}

const TRADE_LINK = /^\/trades\/[0-9a-fA-F-]{36}$/;

/** A notification's data comes through outside systems, so only these places can be opened from one. */
export function isSafeDeepLink(path: unknown): path is string {
  return typeof path === 'string' && (path === '/feed' || path === '/account' || TRADE_LINK.test(path));
}
