import { type ReactNode, useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { type Edge, SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '@/theme';
import { space } from '@/theme/tokens';
import { T } from './Text';

export function useRefresh(run: () => Promise<unknown>): { refreshing: boolean; onRefresh: () => void } {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void run()
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  }, [run]);
  return { refreshing, onRefresh };
}

export function Refresh({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => void }) {
  const c = useColors();
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={c.muted}
      colors={[c.text]}
      progressBackgroundColor={c.raised}
    />
  );
}

/** A scrolling page with safe areas and pull to refresh. */
export function Screen({
  children,
  edges = ['top'],
  refresh,
  keyboard,
  footer,
  style,
  testID,
}: {
  children: ReactNode;
  edges?: Edge[];
  refresh?: () => Promise<unknown>;
  keyboard?: boolean;
  footer?: ReactNode;
  style?: ViewStyle;
  testID?: string;
}) {
  const c = useColors();
  const pull = useRefresh(refresh ?? (async () => undefined));
  const body = (
    <>
      <ScrollView
        testID={testID}
        style={styles.fill}
        contentContainerStyle={[styles.content, style]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={refresh ? <Refresh {...pull} /> : undefined}
      >
        {children}
      </ScrollView>
      {footer && <View style={[styles.footer, { borderTopColor: c.line, backgroundColor: c.bg }]}>{footer}</View>}
    </>
  );
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]} edges={edges}>
      {keyboard ? (
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

export function PageTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={styles.title}>
      <View style={styles.titleText}>
        <T v="display" accessibilityRole="header" numberOfLines={1}>
          {title}
        </T>
        {subtitle && (
          <T v="small" c="muted">
            {subtitle}
          </T>
        )}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: space.lg, paddingBottom: space.xxl, gap: space.md },
  footer: { padding: space.lg, paddingTop: space.md, gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  title: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    marginBottom: space.xs,
  },
  titleText: { flex: 1, minWidth: 0 },
});
