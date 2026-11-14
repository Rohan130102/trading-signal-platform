import { type MeResponse, trialGreetingCopy } from '@signaldesk/domain';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Modal, StyleSheet, View } from 'react-native';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { useSession } from '@/lib/session';
import { useColors } from '@/theme';
import { radius, space } from '@/theme/tokens';
import { Button, T } from '@/ui';

const PIECES = Array.from({ length: 14 }, (_, i) => i);

/**
 * Welcomes a newly granted trial, once per grant on any device: the server records that it was seen. A short
 * entrance and a few falling pieces; with reduced motion it simply appears.
 */
export function TrialGreeting({ me }: { me: MeResponse }) {
  const c = useColors();
  const { refresh } = useSession();
  const grant = me.trialGreeting;
  const [reduced, setReduced] = useState(false);
  const [closing, setClosing] = useState(false);
  const enter = useRef(new Animated.Value(0)).current;
  const fall = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
  }, []);
  useEffect(() => {
    if (!grant) return;
    haptics.notify('success');
    if (reduced) {
      enter.setValue(1);
      return;
    }
    Animated.parallel([
      Animated.spring(enter, { toValue: 1, useNativeDriver: true, damping: 14, stiffness: 160 }),
      Animated.timing(fall, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [enter, fall, grant, reduced]);

  if (!grant) return null;
  const copy = trialGreetingCopy(grant);
  const close = async () => {
    setClosing(true);
    await api.post(`/me/trial-greeting/${grant.grantId}`).catch(() => undefined);
    await refresh();
  };
  const palette = [c.buy, c.success, c.update];
  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => void close()} testID="trial-greeting">
      <View style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.card,
            { backgroundColor: c.surface, borderColor: c.lineStrong },
            {
              opacity: enter,
              transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
            },
          ]}
        >
          {!reduced &&
            PIECES.map((i) => (
              <Animated.View
                key={i}
                pointerEvents="none"
                style={[
                  styles.piece,
                  {
                    left: `${6 + i * 6.5}%`,
                    backgroundColor: palette[i % 3],
                    opacity: fall.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.9, 0] }),
                    transform: [
                      { translateY: fall.interpolate({ inputRange: [0, 1], outputRange: [0, 240 + (i % 4) * 20] }) },
                      { rotate: fall.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${(i % 5) * 70}deg`] }) },
                    ],
                  },
                ]}
              />
            ))}
          <T v="label" c="muted" center style={{ textTransform: 'uppercase', letterSpacing: 1.6 }}>
            {copy.eyebrow}
          </T>
          <View style={[styles.days, { backgroundColor: c.primary }]}>
            <T v="display" c="primaryText" num>
              {grant.durationDays}
            </T>
            <T v="label" c="primaryText" style={{ marginTop: -4, textTransform: 'uppercase' }}>
              {grant.durationDays === 1 ? 'day' : 'days'}
            </T>
          </View>
          <T v="title" center accessibilityRole="header">
            {copy.title}
          </T>
          <T c="muted" center>
            {copy.body}
          </T>
          <Button
            testID="trial-explore"
            label={copy.action}
            variant="primary"
            large
            full
            loading={closing}
            onPress={() => void close()}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: radius.lg * 2,
    borderWidth: 1,
    padding: space.xl,
    paddingTop: space.xxl,
    gap: space.md,
    alignItems: 'stretch',
    overflow: 'hidden',
  },
  days: {
    alignSelf: 'center',
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  piece: { position: 'absolute', top: -10, width: 6, height: 10, borderRadius: 2 },
});
