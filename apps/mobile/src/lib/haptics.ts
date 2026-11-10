import * as Haptics from 'expo-haptics';
import { Platform, Vibration } from 'react-native';
import { prefs } from './storage';

/**
 * Android patterns for alerts that arrive while the app is open: wait, buzz, pause, buzz (milliseconds).
 * A new signal is two firm pulses, a priority alert three, an update one short one, so they can be told
 * apart without looking.
 */
export const ALERT_PATTERNS = {
  signal: [0, 220, 110, 220],
  priority: [0, 300, 100, 300, 100, 300],
  update: [0, 120],
} as const;

/**
 * The only way the app vibrates. Haptics confirm; they never carry information on their own, and they can
 * be switched off in Account. The phone's own settings (silent mode, system haptics) still apply on top,
 * and an unsupported device simply does nothing.
 */

const KEY = 'haptics-off';
let off = false;
/** A choice made in this session wins over the saved one, even if the saved one loads later. */
let chosen = false;
const listeners = new Set<(enabled: boolean) => void>();

void prefs.get<boolean>(KEY).then((value) => {
  if (chosen) return;
  off = value === true;
  for (const notify of listeners) notify(!off);
});

const run = (feedback: () => Promise<void>) => {
  if (off) return;
  void feedback().catch(() => undefined);
};

export const haptics = {
  /** A choice changed: a tab, a chip, a switch. */
  selection: () => run(() => Haptics.selectionAsync()),
  /** A press that does something. Medium for sending or publishing. */
  impact: (weight: 'light' | 'medium' = 'light') =>
    run(() =>
      Haptics.impactAsync(weight === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light),
    ),
  /** An outcome: something arrived, succeeded, needs care, or failed. */
  notify: (kind: 'success' | 'warning' | 'error') =>
    run(() =>
      Haptics.notificationAsync(
        {
          success: Haptics.NotificationFeedbackType.Success,
          warning: Haptics.NotificationFeedbackType.Warning,
          error: Haptics.NotificationFeedbackType.Error,
        }[kind],
      ),
    ),
  /**
   * An alert arrived while the app is open. Stronger than a confirmation, so a new signal is felt even with
   * the phone on the desk. Android vibrates in a pattern per kind; iPhone plays the system's notification
   * haptic, followed by a firm tap for a new signal or a priority alert.
   */
  alert: (kind: keyof typeof ALERT_PATTERNS) => {
    if (off) return;
    if (Platform.OS === 'android') {
      Vibration.vibrate([...ALERT_PATTERNS[kind]]);
      return;
    }
    run(() =>
      Haptics.notificationAsync(
        kind === 'priority' ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success,
      ),
    );
    if (kind !== 'update') setTimeout(() => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)), 180);
  },
};

export function hapticsEnabled(): boolean {
  return !off;
}

export async function setHapticsEnabled(enabled: boolean): Promise<void> {
  chosen = true;
  off = !enabled;
  await prefs.set(KEY, off);
  for (const notify of listeners) notify(enabled);
}

export function onHapticsChange(listener: (enabled: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
