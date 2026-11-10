import type { EventCategory, EventType, Priority } from './status.js';

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

/** Events that change what a subscriber holding the trade should do: a new signal, the stop, the exit. */
const ACTIONABLE: readonly EventType[] = [
  'SIGNAL_PUBLISHED',
  'STOP_MOVED',
  'TRADE_CLOSED',
  'TRADE_CANCELLED',
  'URGENT_INSTRUCTION',
];

export type IosInterruptionLevel = 'passive' | 'active' | 'time-sensitive';

export interface PushPresentation {
  androidChannel: AndroidChannelId;
  /** Delivered at high priority on Android, so it is not held back while the phone dozes. */
  urgent: boolean;
  /**
   * iPhone: time-sensitive alerts may show during a Focus the person allowed it for. Used only for events
   * that change what to do about a trade. Critical alerts, which override silent mode, are never used.
   */
  interruptionLevel: IosInterruptionLevel;
}

/** Announcement categories that are informational only, delivered quietly on iPhone. */
const QUIET_ANNOUNCEMENTS: readonly string[] = ['EDUCATIONAL'];

/**
 * How a notification should present, from what happened. One table for the worker, tested on its own.
 * Actionable events and priority messages are time-sensitive; routine updates and ordinary announcements
 * alert normally; learning notes arrive quietly (no sound, no screen wake).
 */
export function pushPresentation(
  type: EventType,
  category: EventCategory,
  priority: Priority,
  announcementCategory?: string | null,
): PushPresentation {
  const actionable = ACTIONABLE.includes(type) || priority === 'PRIORITY';
  const quiet = category === 'ANNOUNCEMENT' && QUIET_ANNOUNCEMENTS.includes(announcementCategory ?? '');
  return {
    androidChannel: androidChannelFor(category, priority),
    urgent: actionable,
    interruptionLevel: actionable ? 'time-sensitive' : quiet ? 'passive' : 'active',
  };
}

/** Where tapping a notification should land inside the native app. */
export function mobileDeepLinkPath(tradeId: string | null, category?: EventCategory): string {
  if (tradeId) return `/trades/${tradeId}`;
  return category === 'ANNOUNCEMENT' ? '/news' : '/feed';
}

const TRADE_LINK = /^\/trades\/[0-9a-fA-F-]{36}$/;
const PLACES = new Set(['/feed', '/account', '/news', '/alerts', '/history']);

/** A notification's data comes through outside systems, so only these places can be opened from one. */
export function isSafeDeepLink(path: unknown): path is string {
  return typeof path === 'string' && (PLACES.has(path) || TRADE_LINK.test(path));
}

/** App icon badges stop being informative past this, and the platforms truncate them anyway. */
export const BADGE_CAP = 99;
