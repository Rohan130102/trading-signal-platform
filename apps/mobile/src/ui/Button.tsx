import Ionicons from '@expo/vector-icons/Ionicons';
import { haptics } from '@/lib/haptics';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, type PressableProps, StyleSheet, View, type ViewStyle } from 'react-native';
import { useColors } from '@/theme';
import { radius, space, TOUCH } from '@/theme/tokens';
import { T } from './Text';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'buy' | 'sell';

interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  large?: boolean;
  small?: boolean;
  full?: boolean;
  style?: ViewStyle;
  /** A firmer tap for actions that send something. */
  heavy?: boolean;
  left?: ReactNode;
}

export function Button({
  label,
  variant = 'secondary',
  icon,
  loading,
  large,
  small,
  full,
  style,
  heavy,
  disabled,
  onPress,
  left,
  ...rest
}: ButtonProps) {
  const c = useColors();
  const look = {
    primary: { bg: c.primary, fg: c.primaryText, border: 'transparent' },
    secondary: { bg: c.raised, fg: c.text, border: c.line },
    danger: { bg: c.stopSoft, fg: c.stop, border: 'transparent' },
    ghost: { bg: 'transparent', fg: c.muted, border: 'transparent' },
    buy: { bg: c.buy, fg: c.bg, border: 'transparent' },
    sell: { bg: c.sell, fg: c.bg, border: 'transparent' },
  }[variant];
  const off = Boolean(disabled || loading);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, busy: Boolean(loading) }}
      disabled={off}
      onPress={(event) => {
        haptics.impact(heavy ? 'medium' : 'light');
        onPress?.(event);
      }}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: look.bg,
          borderColor: look.border,
          minHeight: large ? 54 : small ? 44 : TOUCH,
          // A short label such as "OK" still leaves a target as wide as it is tall.
          minWidth: large ? 54 : small ? 44 : TOUCH,
          paddingHorizontal: small ? space.md : space.lg,
          opacity: off && !loading ? 0.45 : pressed ? 0.8 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
        full && styles.full,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={look.fg} size="small" />
      ) : (
        <View style={styles.row}>
          {left}
          {icon && <Ionicons name={icon} size={small ? 16 : 18} color={look.fg} />}
          <T
            v={large ? 'heading' : small ? 'small' : 'strong'}
            style={{ color: look.fg, fontWeight: '600', flexShrink: 1 }}
            numberOfLines={2}
            center
          >
            {label}
          </T>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  full: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
