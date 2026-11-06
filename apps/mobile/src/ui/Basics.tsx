import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View, type ViewProps, type ViewStyle } from 'react-native';
import { useColors } from '@/theme';
import { radius, space, TOUCH } from '@/theme/tokens';
import type { IconName } from './Button';
import { T } from './Text';

export function Card({ style, padded = true, ...rest }: ViewProps & { padded?: boolean }) {
  const c = useColors();
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: c.surface,
          borderColor: c.line,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.lg,
        },
        padded && { padding: space.lg },
        style,
      ]}
    />
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <T v="label" c="muted" accessibilityRole="header" style={{ textTransform: 'uppercase' }}>
        {children}
      </T>
      {action}
    </View>
  );
}

export type Tone = 'neutral' | 'buy' | 'sell' | 'update' | 'success' | 'stop';

export function Badge({ tone = 'neutral', icon, children }: { tone?: Tone; icon?: IconName; children: ReactNode }) {
  const c = useColors();
  const look = {
    neutral: { bg: c.neutralSoft, fg: c.muted },
    buy: { bg: c.buySoft, fg: c.buy },
    sell: { bg: c.sellSoft, fg: c.sell },
    update: { bg: c.updateSoft, fg: c.update },
    success: { bg: c.successSoft, fg: c.success },
    stop: { bg: c.stopSoft, fg: c.stop },
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: look.bg }]}>
      {icon && <Ionicons name={icon} size={12} color={look.fg} />}
      <T v="caption" style={{ color: look.fg, fontWeight: '600' }} numberOfLines={1}>
        {children}
      </T>
    </View>
  );
}

export function Divider({ style }: { style?: ViewStyle }) {
  const c = useColors();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: c.line }, style]} />;
}

export function Segmented<V extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: V; label: string; testID?: string }[];
  value: V;
  onChange: (value: V) => void;
  label?: string;
}) {
  const c = useColors();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[styles.segmented, { backgroundColor: c.raised }]}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            testID={option.testID}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={option.label}
            onPress={() => {
              void Haptics.selectionAsync().catch(() => undefined);
              onChange(option.value);
            }}
            style={[styles.segment, on && { backgroundColor: c.surface, borderColor: c.lineStrong }]}
          >
            <T v="small" style={{ fontWeight: '600' }} c={on ? 'text' : 'muted'} numberOfLines={1}>
              {option.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({
  label,
  on,
  onPress,
  testID,
  icon,
}: {
  label: string;
  on?: boolean;
  onPress: () => void;
  testID?: string;
  icon?: IconName;
}) {
  const c = useColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(on) }}
      accessibilityLabel={label}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: on ? c.primary : c.raised,
          borderColor: on ? c.primary : c.line,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      {icon && <Ionicons name={icon} size={14} color={on ? c.primaryText : c.muted} />}
      <T v="small" style={{ fontWeight: '600', color: on ? c.primaryText : c.text }} num numberOfLines={1}>
        {label}
      </T>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.chipRow}
      style={styles.chipScroll}
    >
      {children}
    </ScrollView>
  );
}

export function ToggleRow({
  label,
  hint,
  value,
  onChange,
  disabled,
  testID,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const c = useColors();
  return (
    <View style={styles.toggle}>
      <View style={styles.flex}>
        <T>{label}</T>
        {hint && (
          <T v="small" c="muted">
            {hint}
          </T>
        )}
      </View>
      <Switch
        testID={testID}
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: c.success, false: c.lineStrong }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  icon,
  right,
  onPress,
  testID,
  danger,
  chevron = true,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  right?: ReactNode;
  onPress?: () => void;
  testID?: string;
  danger?: boolean;
  chevron?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.listRow, { opacity: pressed ? 0.65 : 1 }]}
    >
      {icon && <Ionicons name={icon} size={20} color={danger ? c.stop : c.muted} />}
      <View style={styles.flex}>
        <T c={danger ? 'stop' : 'text'} numberOfLines={1}>
          {title}
        </T>
        {subtitle && (
          <T v="small" c="muted" numberOfLines={2}>
            {subtitle}
          </T>
        )}
      </View>
      {right}
      {onPress && chevron && <Ionicons name="chevron-forward" size={16} color={c.subtle} />}
    </Pressable>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'stop' | 'success' | 'update';
}) {
  return (
    <View style={styles.stat}>
      <T v="caption" c="muted">
        {label}
      </T>
      <T v="price" c={tone ?? 'text'} numberOfLines={2}>
        {value}
      </T>
      {hint && (
        <T v="caption" c="subtle">
          {hint}
        </T>
      )}
    </View>
  );
}

export function Notice({
  tone = 'update',
  title,
  children,
  icon,
}: {
  tone?: 'update' | 'stop' | 'neutral' | 'success';
  title?: string;
  children?: ReactNode;
  icon?: IconName;
}) {
  const c = useColors();
  const look = {
    update: { bg: c.updateSoft, fg: 'update' as const },
    stop: { bg: c.stopSoft, fg: 'stop' as const },
    success: { bg: c.successSoft, fg: 'success' as const },
    neutral: { bg: c.neutralSoft, fg: 'muted' as const },
  }[tone];
  return (
    <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: look.bg }]}>
      {icon && <Ionicons name={icon} size={18} color={c[look.fg]} />}
      <View style={styles.flex}>
        {title && (
          <T v="strong" c={look.fg}>
            {title}
          </T>
        )}
        {children !== undefined && (
          <T v="small" c={look.fg === 'muted' ? 'muted' : look.fg}>
            {children}
          </T>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.lg,
    marginBottom: space.sm,
    paddingHorizontal: space.xs,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 3, gap: 3 },
  segment: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    paddingHorizontal: space.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipRow: { gap: space.sm, paddingHorizontal: space.lg, alignItems: 'center' },
  chipScroll: { flexGrow: 0, marginHorizontal: -space.lg },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH, paddingVertical: 6 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingVertical: 8 },
  stat: { flexBasis: '46%', flexGrow: 1, gap: 2 },
  notice: { flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.md },
});
