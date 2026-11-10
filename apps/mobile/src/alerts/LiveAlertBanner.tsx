import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LiveAlert } from '@/lib/realtime';
import { useColors } from '@/theme';
import { radius, space } from '@/theme/tokens';
import { Button, type IconName, T } from '@/ui';

/** What is on screen: the alert, how many others arrived while it was up, and whether it waits for a tap. */
export interface ShownAlert {
  key: number;
  alert: LiveAlert;
  more: number;
  /** Stays until the person opens or dismisses it. New signals and priority alerts, for subscribers. */
  sticky: boolean;
  important: boolean;
}

/** How long an ordinary update stays before it slides away by itself. */
export const UPDATE_BANNER_MS = 8000;

export function alertKind(alert: Pick<LiveAlert, 'category' | 'priority'>): string {
  if (alert.priority === 'PRIORITY') return 'Priority alert';
  switch (alert.category) {
    case 'NEW_SIGNAL':
      return 'New signal';
    case 'CLOSURE':
      return 'Trade closed';
    case 'ANNOUNCEMENT':
      return 'Announcement';
    default:
      return 'Signal update';
  }
}

/**
 * The in-app alert, on every screen including Signals. A new signal is shown large, in its direction's
 * colour, and stays until it is opened or dismissed, so it is not missed while the app is open. Updates
 * slide away after a few seconds. It sits below the status bar and notch and never blocks navigation.
 */
export function LiveAlertBanner({
  shown,
  onOpen,
  onDismiss,
  onSeeAll,
}: {
  shown: ShownAlert;
  onOpen: () => void;
  onDismiss: () => void;
  onSeeAll?: () => void;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  const dismissed = useRef(onDismiss);
  dismissed.current = onDismiss;
  const { alert, more, sticky } = shown;
  const isNew = alert.category === 'NEW_SIGNAL';
  const priority = alert.priority === 'PRIORITY';
  const kind = alertKind(alert);

  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, damping: 16, stiffness: 240 }).start();
    AccessibilityInfo.announceForAccessibility(`${kind}. ${alert.title}`);
  }, [alert.title, anim, kind]);

  useEffect(() => {
    if (sticky) return;
    const timer = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => dismissed.current());
    }, UPDATE_BANNER_MS);
    return () => clearTimeout(timer);
  }, [anim, sticky, shown.key]);

  const color = priority
    ? c.update
    : isNew
      ? alert.direction === 'SELL'
        ? c.sell
        : alert.direction === 'BUY'
          ? c.buy
          : c.text
      : alert.category === 'CLOSURE'
        ? c.muted
        : alert.category === 'ANNOUNCEMENT'
          ? c.text
          : c.update;
  const icon: IconName = priority
    ? 'warning'
    : isNew
      ? alert.direction === 'SELL'
        ? 'trending-down'
        : 'trending-up'
      : alert.category === 'ANNOUNCEMENT'
        ? 'megaphone-outline'
        : alert.category === 'CLOSURE'
          ? 'flag-outline'
          : 'git-commit-outline';
  const canOpen = alert.tradeId !== null || alert.category === 'ANNOUNCEMENT';
  const openLabel = isNew ? 'View signal' : alert.category === 'ANNOUNCEMENT' ? 'Read' : 'View trade';
  const openVariant =
    isNew && alert.direction === 'BUY' ? 'buy' : isNew && alert.direction === 'SELL' ? 'sell' : 'primary';

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          top: insets.top + space.sm,
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }],
        },
      ]}
    >
      <View
        testID="live-alert"
        accessibilityRole="alert"
        accessibilityLiveRegion={sticky ? 'assertive' : 'polite'}
        style={[
          styles.card,
          { backgroundColor: c.raised, borderColor: sticky ? color : c.lineStrong },
          sticky && styles.important,
        ]}
      >
        <View style={[styles.accent, { backgroundColor: color }]} />
        <View style={styles.head}>
          <Ionicons name={icon} size={16} color={color} />
          <T v="label" style={[styles.kind, { color }]} numberOfLines={1}>
            {kind}
          </T>
          <T v="caption" c="subtle">
            · just now
          </T>
          <View style={styles.spacer} />
          <Pressable
            testID="live-alert-close"
            accessibilityRole="button"
            accessibilityLabel="Dismiss alert"
            onPress={onDismiss}
            style={({ pressed }) => [styles.close, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Ionicons name="close" size={20} color={c.muted} />
          </Pressable>
        </View>
        <Pressable
          disabled={!canOpen}
          onPress={onOpen}
          accessibilityRole={canOpen ? 'button' : 'text'}
          accessibilityLabel={`${alert.title}. ${alert.body}`}
          style={styles.text}
        >
          <T v={sticky ? 'heading' : 'strong'} numberOfLines={2}>
            {alert.title}
          </T>
          {alert.body ? (
            <T v="small" c="muted" numberOfLines={2}>
              {alert.body}
            </T>
          ) : null}
        </Pressable>
        {(canOpen || (more > 0 && onSeeAll)) && (
          <View style={styles.actions}>
            {canOpen && (
              <Button label={openLabel} variant={openVariant} small onPress={onOpen} testID="live-alert-open" />
            )}
            {more > 0 && onSeeAll && (
              <Button label={`+${more} more`} variant="ghost" small onPress={onSeeAll} testID="live-alert-more" />
            )}
          </View>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.md, right: space.md, zIndex: 110, elevation: 110 },
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: space.xs,
    paddingBottom: space.md,
    paddingLeft: space.lg + 2,
    paddingRight: space.sm,
    gap: space.xs,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  important: { borderWidth: 1.5 },
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kind: { textTransform: 'uppercase', flexShrink: 1 },
  spacer: { flex: 1 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  text: { gap: 2, paddingRight: space.sm, marginTop: -space.xs },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
});
