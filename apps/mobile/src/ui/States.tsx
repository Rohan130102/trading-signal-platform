import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native';
import { ApiError } from '@/lib/api';
import { useColors } from '@/theme';
import { radius, space } from '@/theme/tokens';
import { Button, type IconName } from './Button';
import { T } from './Text';

export function Skeleton({ height = 16, style }: { height?: number; style?: ViewStyle }) {
  const c = useColors();
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View style={[{ height, borderRadius: radius.sm, backgroundColor: c.raised, opacity: pulse }, style]} />
  );
}

export function Loading({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  const c = useColors();
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} style={styles.loading}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={[styles.skeletonCard, { backgroundColor: c.surface, borderColor: c.line }]}>
          <Skeleton height={14} style={{ width: '40%' }} />
          <Skeleton height={22} style={{ width: '70%' }} />
          <Skeleton height={14} />
        </View>
      ))}
    </View>
  );
}

export function EmptyState({
  icon = 'file-tray-outline',
  title,
  children,
}: {
  icon?: IconName;
  title: string;
  children?: string;
}) {
  const c = useColors();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: c.raised }]}>
        <Ionicons name={icon} size={24} color={c.muted} />
      </View>
      <T v="heading" center>
        {title}
      </T>
      {children && (
        <T c="muted" center>
          {children}
        </T>
      )}
    </View>
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
}

export function ErrorState({ error, title, onRetry }: { error: unknown; title?: string; onRetry?: () => void }) {
  const offline = error instanceof ApiError && error.isNetwork;
  return (
    <View style={styles.empty} accessibilityRole="alert">
      <EmptyState
        icon={offline ? 'cloud-offline-outline' : 'alert-circle-outline'}
        title={title ?? (offline ? 'You appear to be offline' : 'That did not load')}
      >
        {errorMessage(error)}
      </EmptyState>
      {onRetry && <Button label="Try again" icon="refresh" onPress={onRetry} testID="retry" />}
    </View>
  );
}

export function FormError({ error }: { error: unknown }) {
  const c = useColors();
  if (!error) return null;
  const issues = error instanceof ApiError ? (error.details?.issues ?? []) : [];
  return (
    <View accessibilityRole="alert" style={[styles.formError, { backgroundColor: c.stopSoft }]} testID="form-error">
      <T v="small" c="stop">
        {issues[0]?.message ?? errorMessage(error)}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { gap: space.md },
  skeletonCard: { gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  empty: { alignItems: 'center', gap: space.md, paddingVertical: space.xxl, paddingHorizontal: space.xl },
  emptyIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  formError: { padding: space.md, borderRadius: radius.md },
});
