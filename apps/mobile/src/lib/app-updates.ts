import { formatDateTime } from '@signaldesk/domain';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/** How often coming back to the app looks for a new version. The launch check happens on its own. */
const RECHECK_MS = 30 * 60_000;

/**
 * New screens and wording reach the app without a new APK. At launch the app asks its server on its own; this
 * also asks when it returns to the foreground, at most every half hour, and downloads in the background. A new
 * version takes over at the next start, or at once if the person chooses to restart. Release builds only.
 */
export function useUpdateChecks(): void {
  const last = useRef(Date.now());
  useEffect(() => {
    if (!Updates.isEnabled) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || Date.now() - last.current < RECHECK_MS) return;
      last.current = Date.now();
      void (async () => {
        try {
          const found = await Updates.checkForUpdateAsync();
          if (found.isAvailable) await Updates.fetchUpdateAsync();
        } catch {
          // Offline or the server is unreachable: the next check tries again. Nothing on screen depends on it.
        }
      })();
    });
    return () => subscription.remove();
  }, []);
}

/** Whether a downloaded version is waiting, and how to start it now. */
export function useUpdateReady(): { ready: boolean; restart: () => void } {
  const { isUpdatePending } = Updates.useUpdates();
  const restart = useCallback(() => {
    void Updates.reloadAsync().catch(() => undefined);
  }, []);
  return { ready: isUpdatePending, restart };
}

/** "Version 1.0.0", and when the running version was published if it arrived as an update. */
export function versionLabel(version: string): string {
  const base = `Version ${version}`;
  if (!Updates.isEnabled || Updates.isEmbeddedLaunch || !Updates.createdAt) return base;
  return `${base}, updated ${formatDateTime(Updates.createdAt.toISOString())}`;
}
