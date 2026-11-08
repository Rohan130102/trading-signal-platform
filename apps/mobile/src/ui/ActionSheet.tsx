import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/theme';
import { radius, space } from '@/theme/tokens';
import type { IconName } from './Button';
import { T } from './Text';

export interface SheetAction {
  label: string;
  icon: IconName;
  onPress: () => void;
  danger?: boolean;
  hint?: string;
  testID?: string;
}

/**
 * A short list of actions that slides up from the bottom, above the home indicator. Tapping outside,
 * Cancel, or the system back gesture all close it, so nobody gets stuck in it.
 */
export function ActionSheet({
  visible,
  title,
  subtitle,
  actions,
  onClose,
}: {
  visible: boolean;
  title: string;
  subtitle?: ReactNode;
  actions: SheetAction[];
  onClose: () => void;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]}
        onPress={onClose}
        testID="action-sheet-backdrop"
      />
      <View
        style={[
          styles.sheet,
          { backgroundColor: c.surface, borderColor: c.line, paddingBottom: insets.bottom + space.sm },
        ]}
        accessibilityViewIsModal
        testID="action-sheet"
      >
        <View style={[styles.grabber, { backgroundColor: c.lineStrong }]} />
        <View style={styles.header}>
          <T v="heading" numberOfLines={2} accessibilityRole="header">
            {title}
          </T>
          {subtitle ? (
            <T v="small" c="muted">
              {subtitle}
            </T>
          ) : null}
        </View>
        {actions.map((action) => (
          <Pressable
            key={action.label}
            testID={action.testID}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityHint={action.hint}
            onPress={() => {
              onClose();
              action.onPress();
            }}
            style={({ pressed }) => [styles.row, { borderTopColor: c.line, opacity: pressed ? 0.6 : 1 }]}
          >
            <Ionicons name={action.icon} size={20} color={action.danger ? c.stop : c.text} />
            <View style={styles.flex}>
              <T c={action.danger ? 'stop' : 'text'}>{action.label}</T>
              {action.hint ? (
                <T v="small" c="muted">
                  {action.hint}
                </T>
              ) : null}
            </View>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          testID="action-sheet-cancel"
          onPress={onClose}
          style={({ pressed }) => [styles.cancel, { backgroundColor: c.raised, opacity: pressed ? 0.7 : 1 }]}
        >
          <T v="strong">Cancel</T>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginTop: space.sm },
  header: { paddingVertical: space.md, gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1, minWidth: 0 },
  cancel: {
    minHeight: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.sm,
  },
});
