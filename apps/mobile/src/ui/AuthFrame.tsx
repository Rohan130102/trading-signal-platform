import Ionicons from '@expo/vector-icons/Ionicons';
import type { PublicInfo } from '@signaldesk/domain';
import { useQuery } from '@tanstack/react-query';
import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { api } from '@/lib/api';
import { useColors } from '@/theme';
import { radius, space } from '@/theme/tokens';
import { Logo } from './Logo';
import { Screen } from './Screen';
import { T } from './Text';

const TAGLINE = 'Every signal, and every change to it, in one place.';

const POINTS: { icon: ComponentProps<typeof Ionicons>['name']; label: string }[] = [
  { icon: 'layers-outline', label: 'Clear levels' },
  { icon: 'notifications-outline', label: 'Live alerts' },
  { icon: 'shield-checkmark-outline', label: 'Signals only' },
];

/** The public facts these screens show. Cached with the rest of the app, so it is fetched once. */
export function usePublicInfo() {
  return useQuery({
    queryKey: ['public-info'],
    queryFn: () => api.get<PublicInfo>('/public/info'),
    staleTime: 60_000,
  });
}

/** A soft light behind the brand, in the buy and success colours, as on the website. */
function Glow() {
  const c = useColors();
  return (
    <View pointerEvents="none" style={styles.glow} importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="glow-buy" cx="15%" cy="0%" rx="75%" ry="60%">
            <Stop offset="0" stopColor={c.buy} stopOpacity={0.2} />
            <Stop offset="1" stopColor={c.buy} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="glow-success" cx="100%" cy="8%" rx="65%" ry="55%">
            <Stop offset="0" stopColor={c.success} stopOpacity={0.16} />
            <Stop offset="1" stopColor={c.success} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#glow-buy)" />
        <Rect width="100%" height="100%" fill="url(#glow-success)" />
      </Svg>
    </View>
  );
}

/**
 * Log in, sign up, recovery and the screens straight after: the brand at the top on a soft light, then the form on
 * a card. `focused` (security steps and status screens) keeps only a small brand row, with nothing else to read.
 */
export function AuthFrame({
  title,
  description,
  eyebrow,
  children,
  footer,
  focused = false,
}: {
  title: string;
  description?: string;
  /** Above the title, such as how far through sign-up the person is. */
  eyebrow?: ReactNode;
  children: ReactNode;
  /** Below the card, such as links to About us. */
  footer?: ReactNode;
  focused?: boolean;
}) {
  const c = useColors();
  const info = usePublicInfo();
  const name = info.data?.serviceName ?? 'SignalDesk';
  return (
    <Screen edges={['top', 'bottom']} keyboard style={styles.page}>
      {!focused && <Glow />}
      {focused ? (
        <View style={styles.brandRow}>
          <Logo size={36} />
          <T v="heading" numberOfLines={1} style={styles.shrink}>
            {name}
          </T>
        </View>
      ) : (
        <View style={styles.brand}>
          <Logo size={60} />
          <T v="title" numberOfLines={1} center>
            {name}
          </T>
          <T v="small" c="muted" center>
            {TAGLINE}
          </T>
          <View style={styles.points}>
            {POINTS.map((p) => (
              <View key={p.label} style={[styles.point, { borderColor: c.line, backgroundColor: c.surface }]}>
                <Ionicons name={p.icon} size={13} color={c.text} />
                <T v="caption" c="muted" style={{ fontWeight: '600' }}>
                  {p.label}
                </T>
              </View>
            ))}
          </View>
        </View>
      )}
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }]}>
        {eyebrow}
        <View style={styles.titles}>
          <T v="title" accessibilityRole="header">
            {title}
          </T>
          {description ? <T c="muted">{description}</T> : null}
        </View>
        {children}
      </View>
      {footer ? (
        <>
          <View style={{ flexGrow: 1 }} />
          {footer}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { paddingTop: space.xl, gap: space.lg, flexGrow: 1 },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 420 },
  brand: { alignItems: 'center', gap: space.xs, marginTop: space.sm },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  shrink: { flexShrink: 1 },
  points: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: space.sm },
  point: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  card: {
    borderRadius: radius.lg + 4,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    gap: space.lg,
  },
  titles: { gap: space.xs },
});
