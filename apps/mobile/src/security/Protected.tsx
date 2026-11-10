import * as ScreenCapture from 'expo-screen-capture';
import { type ReactNode, useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { api } from '@/lib/api';
import { useToast } from '@/ui';

/**
 * Development bundles only: lets automated visual checks take screenshots. `__DEV__` is false in every
 * preview and production build, so there this is always false and protection always applies.
 */
const ALLOW_CAPTURE_FOR_QA = __DEV__ && process.env.EXPO_PUBLIC_E2E_ALLOW_CAPTURE === '1';
const usePrevent: (key: string) => void = ALLOW_CAPTURE_FOR_QA
  ? () => undefined
  : ScreenCapture.usePreventScreenCapture;

/**
 * Protection for screens that show paid signal content.
 *
 * Android: the window is marked secure (FLAG_SECURE), so screenshots, screen recordings and the recent-apps
 * preview show a blank screen. This is enforced by Android itself.
 *
 * iPhone: Apple offers no supported way to block screenshots of an app. Expo's module hides the content
 * from screenshots and recordings on recent iOS versions using the system's secure-text layer, which Apple
 * does not document for this purpose and may change, so it is treated as best effort. On top of it the
 * app-switcher preview is blurred, and a screenshot is noticed (after it was taken) and recorded in the audit
 * log. Nothing is drawn over the content: the owner chose a clean screen over a visible watermark. None of
 * this is described to subscribers as complete protection.
 */
export function useScreenProtection(key: string, screen: string): void {
  usePrevent(key);
  const toast = useToast();
  const lastReport = useRef(0);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    void ScreenCapture.enableAppSwitcherProtectionAsync(0.9).catch(() => undefined);
    // Android would need a storage permission to notice screenshots, and blocks them anyway.
    const subscription = ScreenCapture.addScreenshotListener(() => {
      toast({
        tone: 'warning',
        title: 'Screenshots of signals are not allowed',
        body: 'Signals are for your use only. This screenshot was noted on your account.',
        duration: 6000,
      });
      const now = Date.now();
      if (now - lastReport.current < 5000) return;
      lastReport.current = now;
      void api.post('/me/security-events', { type: 'SCREENSHOT', screen }).catch(() => undefined);
    });
    return () => subscription.remove();
  }, [screen, toast]);
}

export function ProtectedScreen({ id, screen, children }: { id: string; screen: string; children: ReactNode }) {
  useScreenProtection(id, screen);
  return <View style={styles.fill}>{children}</View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
