import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { enablePush, type PushStatus, readPushStatus } from '@/lib/push';
import { DirectionBadge, Levels, StatusBadge } from '@/trade';
import { useColors } from '@/theme';
import { radius, space } from '@/theme/tokens';
import { Badge, Button, ModalFrame, T } from '@/ui';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function Example({ children }: { children: ReactNode }) {
  const c = useColors();
  return (
    <View style={[styles.example, { backgroundColor: c.surface, borderColor: c.line }]} accessibilityLabel="Example">
      <T v="label" c="subtle" style={styles.caps}>
        Example, not a real signal
      </T>
      {children}
    </View>
  );
}

function Step({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  const c = useColors();
  return (
    <View style={{ gap: space.lg }}>
      <View style={[styles.iconWrap, { backgroundColor: c.raised }]}>
        <Ionicons name={icon} size={30} color={c.text} />
      </View>
      <T v="display" accessibilityRole="header">
        {title}
      </T>
      {children}
    </View>
  );
}

/**
 * Five short steps, shown once after the first sign-in and again only when asked for from Account. The
 * alerts step asks for notification permission only if the person chooses to, after explaining why.
 */
function Onboarding() {
  const c = useColors();
  const router = useRouter();
  const client = useQueryClient();
  const { replay } = useLocalSearchParams<{ replay?: string }>();
  const [step, setStep] = useState(0);
  const [push, setPush] = useState<PushStatus>('checking');
  const [asking, setAsking] = useState(false);
  const finished = useRef(false);

  useEffect(() => {
    void readPushStatus()
      .then(setPush)
      .catch(() => setPush('needs-real-build'));
  }, []);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    if (!replay) {
      void api
        .post('/me/onboarding')
        .then(() => client.invalidateQueries({ queryKey: ['me'] }))
        .catch(() => undefined);
    }
  }, [client, replay]);

  // Leaving by the back gesture counts as skipping, so the tour is not shown again.
  useEffect(() => () => finish(), [finish]);

  const close = () => {
    finish();
    if (router.canGoBack()) router.back();
    else router.replace('/feed');
  };

  const steps: ReactNode[] = [
    <Step key="welcome" icon="pulse" title="Welcome to SignalDesk">
      <T c="muted">
        The desk publishes trade signals here, and every change to them. You decide whether to act: SignalDesk never
        places trades for you.
      </T>
      <T c="muted">This takes a minute. You can skip it and replay it any time from Account.</T>
    </Step>,
    <Step key="signal" icon="reader-outline" title="Reading a signal">
      <Example>
        <View style={styles.row}>
          <DirectionBadge direction="BUY" large />
          <T v="heading" style={{ fontWeight: '700' }}>
            GOLD
          </T>
          <StatusBadge status="ACTIVE" />
        </View>
        <Levels
          precision={2}
          entryLow="100.00"
          entryHigh="100.00"
          entryType="SINGLE"
          stopLoss="96.00"
          targets={[{ index: 1, price: '108.00', status: 'OPEN' }]}
        />
      </Example>
      <T c="muted">
        Each card shows the instrument, BUY or SELL, its status, and the entry, stop-loss and targets. Blue is buy and
        pink is sell, written out every time. Red is kept for stop-losses and green for targets reached, so direction is
        never confused with a result.
      </T>
    </Step>,
    <Step key="updates" icon="git-branch-outline" title="Updates stay with their trade">
      <Example>
        <T v="label" c="muted" style={styles.caps}>
          Latest update
        </T>
        <View style={styles.row}>
          <T c="muted">Stop-loss</T>
          <T c="muted" strike num>
            96.00
          </T>
          <Ionicons name="arrow-forward" size={14} color={c.subtle} />
          <T v="price" c="stop">
            100.00
          </T>
        </View>
      </Example>
      <T c="muted">
        A moved stop-loss, a target reached or a close is added to the original signal, never shown as a new one. The
        card always shows the current levels and the newest change. Tap it for the full timeline.
      </T>
    </Step>,
    <Step key="alerts" icon="notifications-outline" title="Alerts">
      <T c="muted">
        Alerts tell you about new signals and changes while the app is closed. Phones and networks can delay or drop
        them, so open the app before acting on anything.
      </T>
      {push === 'ready' && (
        <Button
          label="Turn on alerts"
          variant="primary"
          icon="notifications"
          loading={asking}
          testID="tour-enable-alerts"
          onPress={() => {
            setAsking(true);
            void enablePush()
              .then((status) => {
                setPush(status);
                if (status === 'on') haptics.notify('success');
              })
              .catch(() => undefined)
              .finally(() => setAsking(false));
          }}
        />
      )}
      {push === 'on' && (
        <Badge tone="success" icon="checkmark-circle">
          Alerts are on for this phone
        </Badge>
      )}
      {push === 'denied' && (
        <T v="small" c="muted">
          Alerts are switched off in your phone’s settings. You can turn them on there, or from Account.
        </T>
      )}
      {(push === 'needs-real-build' || push === 'not-configured' || push === 'server-off') && (
        <T v="small" c="muted">
          This version of the app cannot receive alerts. The Alerts tab still lists everything that was sent.
        </T>
      )}
    </Step>,
    <Step key="filters" icon="options-outline" title="Your list, your way">
      <T c="muted">
        Use Instruments and Filters at the top of Signals to choose what you see. Your choice is remembered.
      </T>
      <T c="muted">
        Finished with a trade? Tap ⋯ on its card and hide it. It is hidden only for you, stays in History, and you can
        show it again.
      </T>
    </Step>,
  ];
  const last = step === steps.length - 1;

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]} edges={['top', 'bottom']} testID="onboarding">
      <View style={styles.top}>
        <View style={styles.dots} accessibilityLabel={`Step ${step + 1} of ${steps.length}`}>
          {steps.map((_, index) => (
            <View
              key={index}
              style={[
                styles.dot,
                { backgroundColor: index === step ? c.text : c.lineStrong, width: index === step ? 18 : 6 },
              ]}
            />
          ))}
        </View>
        <Pressable
          testID="tour-skip"
          accessibilityRole="button"
          accessibilityLabel={last ? 'Close' : 'Skip the tour'}
          onPress={close}
          style={({ pressed }) => [styles.skip, { opacity: pressed ? 0.6 : 1 }]}
        >
          <T v="strong" c="muted">
            {last ? 'Close' : 'Skip'}
          </T>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body} testID={`tour-step-${step}`}>
        {steps[step]}
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: c.line }]}>
        {step > 0 && <Button label="Back" variant="ghost" testID="tour-back" onPress={() => setStep((s) => s - 1)} />}
        <Button
          label={last ? 'Start using SignalDesk' : 'Next'}
          variant="primary"
          testID={last ? 'tour-done' : 'tour-next'}
          style={styles.fill}
          onPress={() => {
            haptics.selection();
            if (last) close();
            else setStep((s) => s + 1);
          }}
        />
      </View>
    </SafeAreaView>
  );
}

export default function OnboardingScreen() {
  return (
    <ModalFrame>
      <Onboarding />
    </ModalFrame>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg },
  dots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: { height: 6, borderRadius: 3 },
  skip: { minHeight: 44, minWidth: 64, alignItems: 'flex-end', justifyContent: 'center' },
  body: { padding: space.xl, paddingTop: space.lg, gap: space.lg, flexGrow: 1 },
  iconWrap: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  example: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  caps: { textTransform: 'uppercase' },
  footer: { flexDirection: 'row', gap: space.sm, padding: space.lg, borderTopWidth: StyleSheet.hairlineWidth },
});
