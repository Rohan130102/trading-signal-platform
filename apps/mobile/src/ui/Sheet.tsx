import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useColors, useTheme } from '@/theme';
import { space } from '@/theme/tokens';
import { KeyboardArea } from './KeyboardArea';
import { T } from './Text';

/**
 * A native modal: the system's page sheet on iPhone, a sliding full screen on Android. Back and
 * swipe-down both close it.
 */
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
  testID,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  testID?: string;
}) {
  const c = useColors();
  const { colors } = useTheme();
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={[styles.fill, { backgroundColor: colors.bg }]} edges={['top', 'bottom']} testID={testID}>
          <View style={[styles.header, { borderBottomColor: c.line }]}>
            <View style={styles.titles}>
              <T v="heading" accessibilityRole="header" numberOfLines={2}>
                {title}
              </T>
              {subtitle ? (
                <T v="small" c="muted" num>
                  {subtitle}
                </T>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              testID="sheet-close"
              onPress={onClose}
              hitSlop={8}
              style={[styles.close, { backgroundColor: c.raised }]}
            >
              <Ionicons name="close" size={20} color={c.text} />
            </Pressable>
          </View>
          <KeyboardArea style={styles.fill}>
            <ScrollView
              style={styles.fill}
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              {children}
            </ScrollView>
            {footer && <View style={[styles.footer, { borderTopColor: c.line }]}>{footer}</View>}
          </KeyboardArea>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titles: { flex: 1, minWidth: 0 },
  close: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  body: { padding: space.lg, gap: space.lg, paddingBottom: space.xl },
  footer: { padding: space.lg, gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
});
