import * as ScreenCapture from 'expo-screen-capture';
import { type ReactNode, useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useColors } from '@/theme';
import { T, useToast } from '@/ui';

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
 * app-switcher preview is blurred, a screenshot is noticed (after it was taken) and recorded in the audit
 * log, and every protected screen carries a faint watermark with the subscriber's login ID, so a capture
 * that does get out can be traced. None of this is described to subscribers as complete protection.
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

/** A faint, repeating watermark with the subscriber's login ID. Invisible to screen readers and to touch. */
export function Watermark() {
  const { me } = useSession();
  const c = useColors();
  if (!me || me.role !== 'SUBSCRIBER') return null;
  const label = `${me.loginId} · SignalDesk`;
  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={StyleSheet.absoluteFill}
      testID="watermark"
    >
      {Array.from({ length: 7 }, (_, row) => (
        <View key={row} style={[styles.row, { top: `${row * 15 + 4}%` }]}>
          {Array.from({ length: 2 }, (_, column) => (
            <T
              key={column}
              v="caption"
              style={[styles.mark, { color: c.text, opacity: c.scheme === 'dark' ? 0.05 : 0.06 }]}
              numberOfLines={1}
              allowFontScaling={false}
            >
              {label}
            </T>
          ))}
        </View>
      ))}
    </View>
  );
}

export function ProtectedScreen({ id, screen, children }: { id: string; screen: string; children: ReactNode }) {
  useScreenProtection(id, screen);
  return (
    <View style={styles.fill}>
      {children}
      <Watermark />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: {
    position: 'absolute',
    left: '-10%',
    right: '-10%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    transform: [{ rotate: '-24deg' }],
  },
  mark: { fontSize: 13, fontWeight: '600', letterSpacing: 1 },
});
