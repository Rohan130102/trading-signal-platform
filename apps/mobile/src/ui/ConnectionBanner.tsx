import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRealtime } from '@/lib/realtime';
import { useColors } from '@/theme';
import { radius, space } from '@/theme/tokens';
import { T } from './Text';

/** A trader needs to know when numbers on screen may be stale. Brief blips are not worth a warning. */
export function ConnectionBanner() {
  const c = useColors();
  const { state } = useRealtime();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (state === 'live') {
      setShow(false);
      return;
    }
    const timer = setTimeout(() => setShow(true), state === 'offline' ? 0 : 4000);
    return () => clearTimeout(timer);
  }, [state]);
  if (!show) return null;
  const offline = state === 'offline';
  return (
    <View
      accessibilityRole="alert"
      testID="connection-banner"
      style={[styles.banner, { backgroundColor: c.updateSoft }]}
    >
      <Ionicons name={offline ? 'cloud-offline-outline' : 'sync-outline'} size={16} color={c.update} />
      <T v="small" c="update" style={{ flex: 1 }}>
        {offline
          ? 'You are offline. What you see may be out of date.'
          : 'Reconnecting. Anything you missed appears once this is back.'}
      </T>
    </View>
  );
}

export function LivePill() {
  const c = useColors();
  const { state } = useRealtime();
  const live = state === 'live';
  const color = live ? c.success : state === 'offline' ? c.stop : c.update;
  const label = live ? 'Live' : state === 'offline' ? 'Offline' : 'Connecting';
  return (
    <View
      accessibilityLabel={`Connection: ${label}`}
      testID={`live-${state}`}
      style={[styles.pill, { backgroundColor: c.raised }]}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <T v="caption" c="muted" style={{ fontWeight: '600' }}>
        {label}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
